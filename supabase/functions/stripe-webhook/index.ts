// Receives Stripe's payment notifications. Two things this must never skip:
//   1. Verify the signature — otherwise anyone could POST a fake "paid" event.
//   2. Hand off to confirm_payment(), which is the only place that's allowed to mark an order
//      paid and issue tickets, and which is itself idempotent (safe if Stripe retries delivery).
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Signature invalide: ${(err as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;

    if (!orderId) {
      console.error("checkout.session.completed without order_id metadata", event.id);
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // event.id is Stripe's own notification id: calling confirm_payment twice with the same
    // one (Stripe redelivering) is a guaranteed no-op, never a second batch of tickets.
    const { data, error } = await supabase
      .rpc("confirm_payment", {
        p_provider_event_id: event.id,
        p_order_id: orderId,
        p_payload: event,
      })
      .single<{
        result_order_id: string;
        status: string;
        refund_needed: boolean;
        payment_intent_id: string | null;
      }>();

    if (error) {
      console.error("confirm_payment failed", error);
      return new Response("confirm_payment failed", { status: 500 });
    }

    // The hold expired before payment arrived and the seat is gone: the card was charged but
    // no ticket can be honored, so refund it automatically instead of leaving the buyer paid
    // for nothing.
    if (data?.refund_needed && data.payment_intent_id) {
      try {
        await stripe.refunds.create({ payment_intent: data.payment_intent_id });
        await supabase.rpc("mark_order_refunded", { p_order_id: orderId });
      } catch (err) {
        console.error("auto-refund failed", err);
        return new Response("refund failed", { status: 500 });
      }
    } else if (data?.status === "paid") {
      // Fire-and-forget (lot Mohammed) : un échec d'envoi d'email ne doit jamais faire échouer
      // le webhook Stripe lui-même, sinon Stripe le redélivre alors que le paiement est déjà bon.
      supabase.functions.invoke("send-ticket-email", { body: { order_id: orderId } }).catch((err) => {
        console.error("send-ticket-email failed", err);
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

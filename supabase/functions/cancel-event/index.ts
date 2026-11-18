// Annule un événement entier (pas une commande) : appelle cancel_event() avec le jeton de L'ORGANISATEUR LUI-MÊME
// (pas la clé de service), pour que la vérification d'appartenance au collectif se fasse dans Postgres — puis
// rembourse via Stripe chaque commande payée par carte que cancel_event() a identifiée.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "missing_authorization" }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { event_id } = await req.json();
  if (!event_id) {
    return new Response(JSON.stringify({ error: "event_id is required" }), { status: 400, headers: corsHeaders });
  }

  const { data: toRefund, error } = await supabase.rpc("cancel_event", { p_event_id: event_id });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }

  const refunded: string[] = [];
  const failed: { order_id: string; error: string }[] = [];

  for (const row of (toRefund ?? []) as { order_id: string; payment_intent_id: string | null; refund_amount_cents: number }[]) {
    if (!row.payment_intent_id || row.refund_amount_cents <= 0) continue;
    try {
      await stripe.refunds.create({ payment_intent: row.payment_intent_id, amount: row.refund_amount_cents });
      const { error: finalizeError } = await supabase.rpc("refund_order", {
        p_order_id: row.order_id,
        p_amount_cents: row.refund_amount_cents,
      });
      if (finalizeError) throw finalizeError;
      refunded.push(row.order_id);
    } catch (err) {
      failed.push({ order_id: row.order_id, error: (err as Error).message });
    }
  }

  return new Response(JSON.stringify({ refunded, failed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

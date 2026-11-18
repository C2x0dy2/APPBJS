// Annulation acheteur sans compte : l'access_token du lien personnel est la seule
// autorisation (même principe que get_order_by_token). Appelle cancel_order_by_token(), puis
// déclenche le remboursement Stripe si la commande était payée par carte.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!
);

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

  const { access_token } = await req.json();
  if (!access_token) {
    return new Response(JSON.stringify({ error: "access_token is required" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data, error } = await supabase
    .rpc("cancel_order_by_token", { p_access_token: access_token })
    .single<{
      result_order_id: string;
      new_status: string;
      refund_amount_cents: number;
      requires_stripe_call: boolean;
      payment_intent_id: string | null;
    }>();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  if (data.requires_stripe_call && data.payment_intent_id) {
    try {
      await stripe.refunds.create({
        payment_intent: data.payment_intent_id,
        amount: data.refund_amount_cents,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `stripe_refund_failed: ${(err as Error).message}` }),
        { status: 500, headers: corsHeaders }
      );
    }
  }

  return new Response(
    JSON.stringify({ status: data.new_status, refunded_cents: data.refund_amount_cents }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

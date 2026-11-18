// Lets a logged-in organizer refund an order (full or partial) from a future dashboard.
// Calls refund_order() with the CALLER'S OWN auth token (not the service role key) so that
// auth.uid() inside that function resolves to them — the organizer check happens in Postgres,
// not here.
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
    return new Response(JSON.stringify({ error: "missing_authorization" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { order_id, amount_cents } = await req.json();
  if (!order_id) {
    return new Response(JSON.stringify({ error: "order_id is required" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data, error } = await supabase
    .rpc("refund_order", { p_order_id: order_id, p_amount_cents: amount_cents ?? null })
    .single<{
      refund_amount_cents: number;
      requires_stripe_call: boolean;
      payment_intent_id: string | null;
      new_status: string;
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
    JSON.stringify({ refunded_cents: data.refund_amount_cents, status: data.new_status }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

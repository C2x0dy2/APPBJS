// Creates a Stripe Checkout Session for an existing pending card order, and returns its URL.
// Called by the app right after reserve_seats() succeeds, so the buyer can pay.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Edge Functions don't set CORS headers on their own — without these, the browser blocks the
// app's request before it ever reaches this code (the app and the function are different origins).
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

  const { order_id, success_url, cancel_url } = await req.json();
  if (!order_id) {
    return new Response(JSON.stringify({ error: "order_id is required" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, total_cents, currency, buyer_email, payment_method")
    .eq("id", order_id)
    .single();

  if (error || !order) {
    return new Response(JSON.stringify({ error: "order_not_found" }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  // Only a pending card order can be paid this way — a transfer order has no Checkout Session,
  // and an order that's already paid/expired must not be re-charged.
  if (order.status !== "pending" || order.payment_method !== "card") {
    return new Response(JSON.stringify({ error: "order_not_payable" }), {
      status: 409,
      headers: corsHeaders,
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: order.buyer_email,
    line_items: [
      {
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: order.total_cents,
          product_data: { name: "Billet" },
        },
        quantity: 1,
      },
    ],
    // order_id travels in metadata so the webhook can find the order again without trusting
    // anything else the client sent.
    metadata: { order_id: order.id },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Stripe's own minimum is 30 min
    success_url: success_url ?? "https://example.com/success",
    cancel_url: cancel_url ?? "https://example.com/cancel",
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// Email de confirmation après paiement (lot Mohammed) : explique l'achat et donne le lien
// personnel (access_token) vers l'écran "Mes billets", où le vrai QR est affiché — on n'essaie
// pas de générer l'image du QR dans l'email lui-même, ce serait fragile selon les clients mail.
// Appelée par stripe-webhook juste après confirm_payment(), jamais par l'app directement.
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_FROM = Deno.env.get("TICKET_EMAIL_FROM") ?? "billetterie@example.com";
// Doit pointer vers l'écran "Mes billets" de l'app (deep link ou page web), avec l'access_token
// en query param pour retrouver la commande sans compte.
const TICKET_LINK_BASE_URL = Deno.env.get("TICKET_LINK_BASE_URL") ?? "https://example.com/mes-billets";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
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

  const { order_id } = await req.json();
  if (!order_id) {
    return new Response(JSON.stringify({ error: "order_id is required" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, access_token, buyer_email, total_cents, currency, status, events(name, starts_at, venue), order_items(quantity, ticket_types(name))"
    )
    .eq("id", order_id)
    .single();

  if (error || !order) {
    return new Response(JSON.stringify({ error: "order_not_found" }), {
      status: 404,
      headers: corsHeaders,
    });
  }

  // Évite d'expliquer une commande comme payée si confirm_payment a en fait déclenché un
  // remboursement automatique juste après (place reprise, cf. stripe-webhook) : cet appel-ci
  // n'a lieu que sur le chemin "payée pour de vrai", mais on revérifie par sécurité.
  if (order.status !== "paid") {
    return new Response(JSON.stringify({ error: "order_not_paid" }), {
      status: 409,
      headers: corsHeaders,
    });
  }

  const event = Array.isArray(order.events) ? order.events[0] : order.events;
  const ticketLink = `${TICKET_LINK_BASE_URL}?token=${order.access_token}`;
  const quantity = (order.order_items ?? []).reduce(
    (sum: number, item: { quantity: number }) => sum + item.quantity,
    0
  );

  const amount = (order.total_cents / 100).toFixed(2);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: order.buyer_email,
      subject: `Confirmation — ${event?.name ?? "votre billet"}`,
      html: `
        <p>Bonjour,</p>
        <p>Votre paiement de <strong>${amount} ${order.currency}</strong> pour
        <strong>${event?.name ?? "l'événement"}</strong> (${quantity} billet${quantity > 1 ? "s" : ""})
        a bien été confirmé.</p>
        <p><a href="${ticketLink}">Voir mon billet (QR code à présenter à l'entrée)</a></p>
        <p>Gardez ce lien précieusement : il permet de retrouver votre billet sans compte.</p>
      `,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return new Response(JSON.stringify({ error: `resend_failed: ${detail}` }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ sent: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

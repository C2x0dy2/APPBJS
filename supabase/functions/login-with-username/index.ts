// Connexion par nom d'utilisateur : résout le nom en e-mail côté serveur (table profiles), vérifie le mot de passe
// via Supabase Auth, et ne renvoie que la session obtenue — l'e-mail associé ne quitte jamais ce serveur.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anon = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const { username, password } = await req.json();
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return new Response(JSON.stringify({ error: "invalid_credentials", message: "Nom d'utilisateur et mot de passe requis." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username.trim().toLowerCase())
    .maybeSingle();

  // Même réponse que l'identifiant existe ou non, pour ne jamais révéler quels noms d'utilisateur sont pris.
  const invalid = () =>
    new Response(JSON.stringify({ error: "invalid_credentials", message: "Nom d'utilisateur ou mot de passe incorrect." }), {
      status: 401,
      headers: corsHeaders,
    });

  if (profileError || !profile) return invalid();

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
  if (userError || !userData.user?.email) return invalid();

  const { data: session, error: signInError } = await anon.auth.signInWithPassword({
    email: userData.user.email,
    password,
  });
  if (signInError || !session.session) return invalid();

  return new Response(
    JSON.stringify({
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

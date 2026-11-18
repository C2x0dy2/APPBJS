import { supabase } from "../lib/supabase";
import { CollectiveRole, Role, User } from "../types/user";
import { RegisterForm } from "../utils/validate-auth";
import { ApiError, mapSupabaseError } from "./api";

// La connexion, l'inscription, la vérification de l'e-mail et le mot de passe oublié passent par Supabase Auth.
// La connexion se fait par NOM D'UTILISATEUR (pas par e-mail) : supabase.auth ne sait authentifier que par e-mail,
// donc la résolution nom -> e-mail est faite côté serveur par l'Edge Function login-with-username, qui ne renvoie
// que la session obtenue — l'e-mail du compte ne transite jamais jusqu'ici.

export interface Credentials {
  username: string;
  password: string;
}

// Reconstruit le User affiché par l'app à partir de la session Supabase en cours : son profil (nom d'utilisateur)
// et ses adhésions à des collectifs (vide pour un simple acheteur).
async function buildUser(): Promise<User> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, "not_authenticated", "Connecte-toi pour continuer.");

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    supabase.from("collective_members").select("collective_id, role, collectives(name)").eq("user_id", user.id),
  ]);

  const collectives = (memberships ?? []).map((m) => ({
    id: m.collective_id as string,
    name: ((m.collectives as unknown as { name: string } | null)?.name ?? "") as string,
    role: m.role as CollectiveRole,
  }));

  const username = profile?.username ?? user.email?.split("@")[0] ?? "";
  const name = (user.user_metadata?.name as string | undefined) || username;
  const role: Role = collectives.length > 0 ? "organizer" : "buyer";

  return {
    id: user.id,
    name,
    username,
    email: user.email ?? "",
    role,
    collectiveId: collectives[0]?.id,
    collectives,
    emailVerified: !!user.email_confirmed_at,
  };
}

export async function login({ username, password }: Credentials): Promise<User> {
  const { data, error } = await supabase.functions.invoke<{ access_token: string; refresh_token: string }>(
    "login-with-username",
    { body: { username: username.trim(), password } }
  );
  if (error || !data) throw new ApiError(401, "invalid_credentials", "Nom d'utilisateur ou mot de passe incorrect.");

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw mapSupabaseError(sessionError);
  return buildUser();
}

export async function register(form: RegisterForm): Promise<User> {
  const { data, error } = await supabase.auth.signUp({
    email: form.email.trim(),
    password: form.password,
    options: {
      data: {
        name: form.username.trim(),
        accepted_terms_at: new Date().toISOString(),
        newsletter: form.newsletter,
      },
    },
  });
  if (error || !data.user) throw mapSupabaseError(error ?? new Error("registration_failed"));

  const { error: profileError } = await supabase.rpc("create_profile", {
    p_user_id: data.user.id,
    p_username: form.username.trim(),
  });
  if (profileError) throw mapSupabaseError(profileError);

  // Si le projet Supabase exige une confirmation d'e-mail, signUp() ne renvoie aucune session active : on se
  // connecte explicitement pour que l'app continue (la vérification elle-même reste à faire ensuite).
  if (!data.session) return login({ username: form.username, password: form.password });
  return buildUser();
}

export function fetchMe(): Promise<User> {
  return buildUser();
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

// Même réponse que l'adresse existe ou non (Supabase ne le révèle pas non plus).
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  if (error) throw mapSupabaseError(error);
}

// Le lien reçu par e-mail établit déjà une session de récupération à l'ouverture de la page (Supabase la détecte
// dans l'URL, voir lib/supabase.ts) : uid/token ne sont plus utilisés, gardés seulement pour que l'écran existant
// n'ait pas besoin de changer sa signature d'appel.
export async function confirmPasswordReset(_uid: string, _token: string, password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw mapSupabaseError(error);
}

export async function verifyEmail(token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "email" });
  if (error) throw mapSupabaseError(error);
}

export async function resendVerification(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new ApiError(401, "not_authenticated", "Connecte-toi pour continuer.");
  const { error } = await supabase.auth.resend({ type: "signup", email: user.email });
  if (error) throw mapSupabaseError(error);
}

import { supabase } from "../lib/supabase";

// Les services parlent directement à Supabase (table + RLS, ou fonctions RPC pour tout ce qui doit rester
// atomique côté serveur : réservation, annulation, chiffres organisateur…). Ce fichier ne garde que ce qui est
// commun à tous : la forme des erreurs, et leur traduction depuis ce que Postgres/Supabase renvoie.

// Une erreur à expliquer à la personne. `code` est lisible par le programme ("sold_out", "not_authenticated"…),
// `fields` une erreur par champ de formulaire quand Supabase la fournit (rare : la plupart des validations de
// formulaire restent côté app, voir utils/validate-*).
export class ApiError extends Error {
  status: number; // 0 = aucune réponse du serveur (réseau), sinon un code HTTP approximatif pour l'affichage
  code: string;
  fields: Record<string, string>;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, details: Record<string, unknown> = {}) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype); // garde `instanceof` fiable quel que soit le moteur JavaScript
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

export function errorMessage(error: unknown, fallback = "Une erreur est survenue. Réessaie dans un instant."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Les exceptions Postgres (`raise exception 'code'` ou `'code: détail'`) arrivent dans `error.message` telles
// quelles : on reconnaît celles que les fonctions SQL (Bintou) peuvent lever, pour un message français cohérent
// partout dans l'app plutôt que le texte brut de la base.
const KNOWN_CODES: Record<string, string> = {
  sold_out: "Plus assez de places disponibles.",
  not_authenticated: "Connecte-toi pour continuer.",
  not_authorized: "Tu n'as pas accès à cette ressource.",
  event_not_on_sale: "Cet événement n'est plus en vente.",
  event_over: "Cet événement est déjà commencé ou terminé.",
  invalid_quantity: "Quantité invalide.",
  ticket_type_not_found: "Ce type de billet n'existe pas.",
  ticket_already_used: "Ce billet a déjà été scanné.",
  cancellation_deadline_passed: "La date limite d'annulation est dépassée.",
  order_not_found: "Commande introuvable.",
  order_not_cancellable: "Cette commande ne peut plus être annulée.",
  transfer_not_available_this_close: "Le virement n'est plus disponible si proche de l'événement.",
  too_many_pending: "Tu as déjà plusieurs réservations en attente de paiement.",
};

// Transforme n'importe quelle erreur Supabase (RPC, lecture de table, Auth) en ApiError, pour que tous les écrans
// gèrent les refus de la même façon (voir ApiError ci-dessus).
export function mapSupabaseError(error: unknown, fallback = "La demande a échoué."): ApiError {
  if (error instanceof ApiError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const [, code] = raw.match(/^([a-z_]+)(?::|$)/) ?? [];
  if (code && KNOWN_CODES[code]) return new ApiError(409, code, KNOWN_CODES[code]);
  return new ApiError(0, "server_error", fallback);
}

// Appelé quand Supabase révoque la session en cours de route (jeton expiré, déconnexion depuis un autre appareil,
// rafraîchissement impossible) : l'application revient à l'état « déconnecté ».
const expiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
    if (event === "SIGNED_OUT") expiredListeners.forEach((listener) => listener());
  }
});

// Un identifiant inconnu (ou qui n'est pas le nôtre) donne toujours "introuvable" : pour une lecture, c'est ça,
// pas une panne. PGRST116 = "no rows" (lecture .single() sans résultat).
export async function orNotFound<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    const err = error as { code?: string; status?: number };
    if (err?.code === "PGRST116" || err?.status === 404) return null;
    throw error;
  }
}

import { supabase } from "../lib/supabase";
import { LegalPage, SiteInfo } from "../types/site";
import { mapSupabaseError, orNotFound } from "./api";

// Ce que l'administrateur règle côté serveur : contact, pages légales, règles de réservation par défaut.
// `site_settings` est une ligne unique (voir supabase/migrations/0014_accounts_and_stats.sql) ; les pages légales
// (CGV, confidentialité) sont cherchées par leur identifiant conventionnel ("cgv", "confidentialite").

export async function getSiteInfo(): Promise<SiteInfo> {
  const { data: settings, error } = await supabase.from("site_settings").select("*").eq("id", 1).single();
  if (error) throw mapSupabaseError(error);

  const { data: pages } = await supabase
    .from("legal_pages")
    .select("slug, title")
    .in("slug", ["cgv", "confidentialite"])
    .eq("published", true);
  const terms = pages?.find((p) => p.slug === "cgv");
  const privacy = pages?.find((p) => p.slug === "confidentialite");

  return {
    name: settings.name,
    contactEmail: settings.contact_email,
    contactPhone: settings.contact_phone,
    termsPage: terms ? { slug: terms.slug, title: terms.title } : null,
    privacyPage: privacy ? { slug: privacy.slug, title: privacy.title } : null,
    maxTicketsPerOrder: settings.max_tickets_per_order,
    defaultCurrency: settings.default_currency,
    defaultTimezone: settings.default_timezone,
  };
}

export function getLegalPage(slug: string): Promise<LegalPage | null> {
  return orNotFound(
    (async () => {
      const { data, error } = await supabase
        .from("legal_pages")
        .select("slug, title, content, updated_at")
        .eq("slug", slug)
        .eq("published", true)
        .single();
      if (error) throw mapSupabaseError(error);
      return { slug: data.slug, title: data.title, content: data.content, updatedAt: data.updated_at };
    })()
  );
}

import { createContext, ReactNode, useContext, useEffect, useState } from "react";

import { getSiteInfo } from "../services/siteservices";
import { SiteInfo } from "../types/site";
import { useAuth } from "./auth";

// Les réglages du site (contact, pages légales, règles de réservation), lus une seule fois sur le serveur.
// undefined tant qu'ils ne sont pas arrivés (ou si le serveur ne répond pas) : les écrans prévoient ce cas et n'inventent rien.
const SiteContext = createContext<SiteInfo | undefined>(undefined);

export function SiteProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [site, setSite] = useState<SiteInfo | undefined>();

  // On attend que le lancement soit terminé : avant, le serveur n'a peut-être pas encore répondu du tout.
  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    getSiteInfo().then(
      (info) => {
        if (active) setSite(info);
      },
      () => undefined // pas grave : chaque écran fonctionne sans ces réglages
    );
    return () => {
      active = false;
    };
  }, [status]);

  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteInfo | undefined {
  return useContext(SiteContext);
}

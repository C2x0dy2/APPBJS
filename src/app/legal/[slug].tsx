import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";

import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { LoadBoundary } from "@/components/ui/state";
import { ContentWidth } from "@/constants/theme";
import { useLoad } from "@/hooks/use-load";
import { getLegalPage } from "@/services/siteservices";
import { formatDateTime } from "@/utils/format";

// Une page de texte rédigée dans l'administration du serveur (CGV, politique de confidentialité, mentions légales…).
export default function LegalPageScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const load = useCallback(() => getLegalPage(slug), [slug]);
  const state = useLoad(load);

  return (
    <Screen maxWidth={ContentWidth.form} topInset={false}>
      {/* Barre de titre native avec le bouton retour, au nom de la page une fois chargée. */}
      <Stack.Screen options={{ headerShown: true, title: state.data?.title ?? "Informations", headerBackButtonDisplayMode: "minimal" }} />

      <LoadBoundary state={state}>
        {(page) =>
          page === null ? (
            <EmptyState
              icon="list"
              title="Page introuvable"
              message="Cette page n'existe pas, ou elle n'est plus publiée."
              actionLabel="Retour"
              onAction={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            />
          ) : (
            <>
              <AppText variant="h1" accessibilityRole="header">
                {page.title}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                Dernière mise à jour : {formatDateTime(page.updatedAt)}
              </AppText>
              {/* Texte brut : les retours à la ligne saisis dans l'administration sont conservés tels quels. */}
              <AppText variant="body" selectable style={{ marginTop: 16 }}>
                {page.content}
              </AppText>
            </>
          )
        }
      </LoadBoundary>
    </Screen>
  );
}

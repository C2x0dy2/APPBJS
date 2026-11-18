import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { errorMessage } from "@/services/api";
import { resendVerification } from "@/services/authservices";

// Le rappel « vérifie ton adresse e-mail », avec un bouton pour recevoir un nouveau lien. Rien ne s'affiche quand l'adresse
// est vérifiée ou que personne n'est connecté. Réserver des places demande une adresse vérifiée (règle du serveur).
export function VerifyEmailBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState("");

  if (!user || user.emailVerified) return null;

  async function resend() {
    setSending(true);
    setProblem("");
    try {
      await resendVerification();
      setSent(true);
    } catch (error) {
      setProblem(errorMessage(error)); // par exemple « Patiente un peu avant de demander un nouveau lien. »
    }
    setSending(false);
  }

  return (
    <Banner
      tone="warning"
      title="Vérifie ton adresse e-mail"
      style={style}
      action={
        sent ? (
          <AppText variant="smallStrong" color="warning">
            Un nouveau lien vient d’être envoyé.
          </AppText>
        ) : (
          <Button title="Renvoyer le lien" size="sm" variant="secondary" fullWidth={false} onPress={resend} loading={sending} />
        )
      }>
      {problem !== "" ? problem : `Clique sur le lien envoyé à ${user.email} : il est nécessaire pour réserver des places.`}
    </Banner>
  );
}

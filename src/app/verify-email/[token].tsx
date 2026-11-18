import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, errorMessage } from "@/services/api";
import { verifyEmail } from "@/services/authservices";
import { homeFor } from "@/utils/navigation";

// La page où mène le lien reçu par e-mail : on envoie son jeton au serveur, qui valide l'adresse.
// Elle marche avec ou sans compte connecté (le lien peut s'ouvrir sur un autre appareil que celui de l'inscription).
export default function VerifyEmailScreen() {
  const theme = useTheme();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user, refreshUser } = useAuth();

  // "working" : en cours ; "done" : adresse validée ; sinon la raison du refus.
  const [result, setResult] = useState<"working" | "done" | ApiError | Error>("working");

  useEffect(() => {
    let active = true;
    verifyEmail(token).then(
      () => {
        if (active) setResult("done");
      },
      (error: unknown) => {
        if (active) setResult(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    );
    return () => {
      active = false;
    };
  }, [token]);

  // Si la personne est connectée sur cet appareil, elle doit voir tout de suite son compte « vérifié ».
  useEffect(() => {
    if (result === "done" && user && !user.emailVerified) refreshUser().catch(() => undefined);
  }, [result, user, refreshUser]);

  function goOn() {
    router.replace(user ? homeFor(user) : "/login");
  }

  return (
    <AuthLayout title="Vérification de l'e-mail" subtitle="On vérifie ton adresse e-mail.">
      {result === "working" && (
        <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Vérification en cours">
          <ActivityIndicator color={theme.primary} />
        </View>
      )}

      {result === "done" && (
        <>
          <Banner tone="success" title="Adresse e-mail vérifiée" style={styles.banner}>
            Merci ! Tu peux maintenant réserver des places.
          </Banner>
          <Button title={user ? "Continuer" : "Se connecter"} onPress={goOn} />
        </>
      )}

      {result !== "working" && result !== "done" && (
        <>
          <Banner tone="danger" title="Vérification impossible" style={styles.banner}>
            {result.message}
          </Banner>
          <Button title={user ? "Retour à mon compte" : "Se connecter"} onPress={goOn} />
        </>
      )}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: 24,
    alignItems: "center",
  },

  banner: {
    marginBottom: 20,
  },
});

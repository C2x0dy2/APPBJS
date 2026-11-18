import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { useTheme } from "@/hooks/use-theme";
import { useAuthLinkError } from "@/services/auth-links";
import { homeFor } from "@/utils/navigation";

// Là où ramène le lien de confirmation envoyé à l'inscription (modèle d'e-mail Supabase par défaut) : Supabase a déjà
// validé l'adresse et ouvert une session dans l'adresse de la page (lue au chargement sur le web, par
// services/auth-links.ts sur téléphone). Il ne reste qu'à relire le compte. (verify-email/[token] sert si le modèle
// d'e-mail est personnalisé pour envoyer directement le jeton.)
export default function EmailConfirmedScreen() {
  const theme = useTheme();
  const { user, refreshUser } = useAuth();
  const linkError = useAuthLinkError();
  const [waited, setWaited] = useState(false);

  // Relit le compte une fois (la session vient peut-être d'être ouverte), puis laisse quelques secondes au lien.
  useEffect(() => {
    refreshUser().catch(() => undefined);
    const timer = setTimeout(() => setWaited(true), 5000);
    return () => clearTimeout(timer);
  }, [refreshUser]);

  const verified = !!user?.emailVerified;

  function goOn() {
    router.replace(user ? homeFor(user) : "/login");
  }

  if (verified) {
    return (
      <AuthLayout title="Adresse e-mail vérifiée" subtitle="Merci !">
        <Banner tone="success" title="C'est fait" style={styles.banner}>
          Tu peux maintenant réserver des places.
        </Banner>
        <Button title="Continuer" onPress={goOn} />
      </AuthLayout>
    );
  }

  if (linkError || waited) {
    return (
      <AuthLayout title="Vérification impossible" subtitle="Ce lien n'a pas permis de vérifier ton adresse.">
        <Banner tone="danger" style={styles.banner}>
          {linkError ??
            (user
              ? "Le lien a peut-être expiré : renvoie-toi un e-mail de vérification depuis ton compte."
              : "Connecte-toi : si ton adresse est déjà vérifiée, tout est bon.")}
        </Banner>
        <Button title={user ? "Retour à mon compte" : "Se connecter"} onPress={goOn} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Vérification de l'e-mail" subtitle="On vérifie ton adresse e-mail.">
      <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Vérification en cours">
        <ActivityIndicator color={theme.primary} />
      </View>
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

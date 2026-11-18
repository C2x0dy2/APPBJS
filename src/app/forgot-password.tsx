import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/services/api";
import { requestPasswordReset } from "@/services/authservices";
import { validateEmail } from "@/utils/validate-auth";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (submitting) return;

    const problem = validateEmail(email);
    setError(problem);
    if (problem) return;

    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (failure) {
      // Adresse refusée, trop de demandes, serveur injoignable… : le message du serveur (ou du réseau) explique quoi faire.
      setError(failure instanceof ApiError ? (failure.fields.email ?? failure.message) : "L'envoi a échoué. Réessaie dans un instant.");
    }
    setSubmitting(false);
  }

  function goToLogin() {
    // Arrivé par un lien direct, il n'y a pas d'écran précédent.
    if (router.canGoBack()) router.back();
    else router.replace("/login");
  }

  return (
    <AuthLayout title="Mot de passe oublié" subtitle="Indique ton adresse e-mail : on t'envoie un lien pour en choisir un nouveau.">
      {sent ? (
        <>
          {/* Même message que l'adresse existe ou non : on ne révèle pas quelles adresses ont un compte. */}
          <Banner tone="success" title="E-mail envoyé" style={styles.banner}>
            Si un compte existe pour cette adresse, un e-mail avec un lien de réinitialisation vient d’être envoyé.
          </Banner>
          <Button title="Retour à la connexion" onPress={goToLogin} />
        </>
      ) : (
        <>
          <Input
            label="Adresse e-mail"
            icon="mail"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (error) setError(undefined);
            }}
            placeholder="toi@exemple.fr"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
            error={error}
          />
          <Button title="Envoyer le lien" onPress={handleSubmit} loading={submitting} />
          <Button title="Retour" variant="ghost" onPress={goToLogin} style={styles.back} />
        </>
      )}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 20,
  },

  back: {
    marginTop: 8,
  },
});

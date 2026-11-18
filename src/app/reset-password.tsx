import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, View } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { PasswordStrength } from "@/components/password-strength";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/hooks/use-theme";
import { ApiError } from "@/services/api";
import { useAuthLinkError, waitForRecovery } from "@/services/auth-links";
import { setNewPassword } from "@/services/authservices";
import { AuthFormErrors, MIN_PASSWORD_LENGTH, validateNewPassword } from "@/utils/validate-auth";

// La page où mène le lien « mot de passe oublié » reçu par e-mail. Supabase vérifie le lien (une seule utilisation,
// durée limitée) et ouvre une session de récupération ; la personne choisit alors un nouveau mot de passe.
// Le formulaire n'apparaît QUE si cette page a bien été ouverte par ce lien (voir services/auth-links.ts) : être
// simplement connecté ne permet pas de changer le mot de passe sans connaître l'ancien.
export default function ResetPasswordScreen() {
  const theme = useTheme();
  const linkError = useAuthLinkError();
  const confirmRef = useRef<TextInput>(null);

  // checking : on attend la session ouverte par le lien ; missing : pas de lien de récupération ouvert sur cet appareil.
  const [recovery, setRecovery] = useState<"checking" | "opened" | "missing">("checking");
  const [linkRejected, setLinkRejected] = useState(false); // le serveur a refusé la session au moment d'enregistrer
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<AuthFormErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (linkError) return;
    let active = true;
    waitForRecovery().then((opened) => {
      if (active) setRecovery(opened ? "opened" : "missing");
    });
    return () => {
      active = false;
    };
  }, [linkError]);

  // invalid : lien absent, expiré ou déjà utilisé.
  const phase = done
    ? "done"
    : linkError || linkRejected || recovery === "missing"
      ? "invalid"
      : recovery === "checking"
        ? "checking"
        : "ready";

  async function handleSubmit() {
    if (submitting) return;

    const found = validateNewPassword(password, passwordConfirm);
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await setNewPassword(password);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_link") {
        setLinkRejected(true);
      } else if (error instanceof ApiError) {
        setErrors(error.fields);
        setFormError(Object.keys(error.fields).length > 0 ? "" : error.message);
      } else {
        setFormError("Impossible de changer le mot de passe pour le moment. Réessaie dans un instant.");
      }
    }
    setSubmitting(false);
  }

  if (phase === "done") {
    return (
      <AuthLayout title="Mot de passe modifié" subtitle="Ton nouveau mot de passe est enregistré.">
        <Banner tone="success" title="C'est fait" style={styles.banner}>
          Connecte-toi avec ton nouveau mot de passe. Tes autres appareils ont été déconnectés.
        </Banner>
        <Button title="Se connecter" onPress={() => router.replace("/login")} />
      </AuthLayout>
    );
  }

  if (phase === "checking") {
    return (
      <AuthLayout title="Nouveau mot de passe" subtitle="On vérifie ton lien.">
        <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Vérification du lien">
          <ActivityIndicator color={theme.primary} />
        </View>
      </AuthLayout>
    );
  }

  if (phase === "invalid") {
    return (
      <AuthLayout title="Lien invalide" subtitle="Ce lien ne permet pas de changer le mot de passe.">
        <Banner tone="danger" style={styles.banner}>
          {linkError ?? "Ouvre cette page avec le lien reçu par e-mail. S'il a expiré ou a déjà servi, demandes-en un nouveau."}
        </Banner>
        <Button title="Demander un nouveau lien" onPress={() => router.replace("/forgot-password")} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisis le mot de passe que tu utiliseras pour te connecter.">
      {formError !== "" && (
        <Banner tone="danger" style={styles.banner}>
          {formError}
        </Banner>
      )}

      <Input
        label="Nouveau mot de passe"
        icon="lock"
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          if (errors.password) setErrors({ ...errors, password: "" });
        }}
        placeholder={`${MIN_PASSWORD_LENGTH} caractères minimum`}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        error={errors.password}
      />
      <PasswordStrength password={password} />
      <Input
        label="Confirme le mot de passe"
        icon="lock"
        value={passwordConfirm}
        onChangeText={(value) => {
          setPasswordConfirm(value);
          if (errors.passwordConfirm) setErrors({ ...errors, passwordConfirm: "" });
        }}
        placeholder="Le même mot de passe"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        inputRef={confirmRef}
        error={errors.passwordConfirm}
      />
      <Button title="Changer mon mot de passe" onPress={handleSubmit} loading={submitting} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 20,
  },

  center: {
    paddingVertical: 24,
    alignItems: "center",
  },
});

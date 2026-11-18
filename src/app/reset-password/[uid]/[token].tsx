import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, TextInput } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { PasswordStrength } from "@/components/password-strength";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/services/api";
import { confirmPasswordReset } from "@/services/authservices";
import { AuthFormErrors, MIN_PASSWORD_LENGTH, validateNewPassword } from "@/utils/validate-auth";

// La page où mène le lien « mot de passe oublié » reçu par e-mail : le lien donne `uid` et `token`, la personne choisit
// un nouveau mot de passe. Le serveur vérifie le lien (une seule utilisation, durée limitée).
export default function ResetPasswordScreen() {
  const { uid, token } = useLocalSearchParams<{ uid: string; token: string }>();
  const confirmRef = useRef<TextInput>(null);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [errors, setErrors] = useState<AuthFormErrors>({});
  const [formError, setFormError] = useState("");
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    if (submitting) return;

    const found = validateNewPassword(password, passwordConfirm);
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await confirmPasswordReset(uid, token, password);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_link") {
        setLinkInvalid(true);
        setFormError(error.message);
      } else if (error instanceof ApiError) {
        setErrors(error.fields);
        setFormError(Object.keys(error.fields).length > 0 ? "" : error.message);
      } else {
        setFormError("Impossible de changer le mot de passe pour le moment. Réessaie dans un instant.");
      }
    }
    setSubmitting(false);
  }

  if (done) {
    return (
      <AuthLayout title="Mot de passe modifié" subtitle="Ton nouveau mot de passe est enregistré.">
        <Banner tone="success" title="C'est fait" style={styles.banner}>
          Connecte-toi avec ton nouveau mot de passe. Tes autres appareils ont été déconnectés.
        </Banner>
        <Button title="Se connecter" onPress={() => router.replace("/login")} />
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

      {linkInvalid ? (
        <Button title="Demander un nouveau lien" onPress={() => router.replace("/forgot-password")} />
      ) : (
        <>
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
        </>
      )}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 20,
  },
});

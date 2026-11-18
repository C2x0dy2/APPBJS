import { Link, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Divider } from "@/components/ui/divider";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth";
import { ApiError } from "@/services/api";
import { homeFor, safeRedirect } from "@/utils/navigation";
import { AuthFormErrors, LoginForm, validateLogin } from "@/utils/validate-auth";

export default function LoginScreen() {
  const { signIn } = useAuth();
  // Si on arrive ici depuis un écran qui demande un compte (ex. "Mes billets"), on y retourne après la connexion.
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const passwordRef = useRef<TextInput>(null);

  const [form, setForm] = useState<LoginForm>({ username: "", password: "" });
  const [errors, setErrors] = useState<AuthFormErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Dès qu'on corrige un champ, son message d'erreur disparaît.
  function updateField(field: keyof LoginForm, value: string) {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: "" });
  }

  async function handleSubmit() {
    if (submitting) return;

    const found = validateLogin(form);
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      // Pas besoin de choisir l'espace : on envoie la personne vers celui de son rôle (acheteur ou organisateur).
      const user = await signIn(form);
      router.replace(safeRedirect(redirect) ?? homeFor(user));
    } catch (error) {
      if (error instanceof ApiError) {
        // Le serveur peut refuser un champ précis : on l'affiche sous ce champ. Sinon, son message (identifiants faux, trop d'essais…).
        setErrors(error.fields);
        setFormError(Object.keys(error.fields).length > 0 ? "" : error.message);
      } else {
        setFormError("Connexion impossible pour le moment. Réessaie dans un instant.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Bon retour" subtitle="Connecte-toi pour retrouver tes billets.">
      {formError !== "" && (
        <Banner tone="danger" style={styles.banner}>
          {formError}
        </Banner>
      )}

      <Input
        label="Nom d'utilisateur"
        icon="user"
        value={form.username}
        onChangeText={(value) => updateField("username", value)}
        placeholder="ton_pseudo"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={errors.username}
      />
      <Input
        label="Mot de passe"
        icon="lock"
        value={form.password}
        onChangeText={(value) => updateField("password", value)}
        placeholder="Ton mot de passe"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        inputRef={passwordRef}
        error={errors.password}
      />

      <View style={styles.forgotRow}>
        <Link href="/forgot-password" asChild>
          <Pressable accessibilityRole="link" hitSlop={8}>
            <AppText variant="smallStrong" color="primary">
              Mot de passe oublié ?
            </AppText>
          </Pressable>
        </Link>
      </View>

      <Button title="Se connecter" onPress={handleSubmit} loading={submitting} />

      <Divider label="ou" />

      <Button
        title="Créer un compte"
        variant="secondary"
        onPress={() => router.push({ pathname: "/register", params: redirect ? { redirect } : {} })}
      />

      <Pressable onPress={() => router.replace("/")} accessibilityRole="link" style={styles.guest}>
        <AppText variant="smallStrong" color="textSecondary">
          Continuer sans compte
        </AppText>
      </Pressable>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 20,
  },

  forgotRow: {
    alignItems: "flex-end",
    marginTop: -4,
    marginBottom: 20,
  },

  guest: {
    alignSelf: "center",
    marginTop: 24,
    padding: 8,
  },
});

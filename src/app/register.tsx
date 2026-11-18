import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { AuthLayout } from "@/components/auth-layout";
import { PasswordStrength } from "@/components/password-strength";
import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Divider } from "@/components/ui/divider";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth";
import { useSite } from "@/context/site";
import { ApiError } from "@/services/api";
import { PageLink } from "@/types/site";
import { homeFor, safeRedirect } from "@/utils/navigation";
import { AuthFormErrors, emptyRegisterForm, MIN_PASSWORD_LENGTH, RegisterForm, validateRegister } from "@/utils/validate-auth";

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const site = useSite();
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [form, setForm] = useState<RegisterForm>(emptyRegisterForm);
  const [errors, setErrors] = useState<AuthFormErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Change UN champ en gardant les autres ; son message d'erreur disparaît dès qu'on le corrige.
  function updateField<K extends keyof RegisterForm>(field: K, value: RegisterForm[K]) {
    setForm({ ...form, [field]: value });
    if (errors[field]) setErrors({ ...errors, [field]: "" });
  }

  async function handleSubmit() {
    if (submitting) return;

    const found = validateRegister(form);
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      // L'inscription connecte directement : on envoie la personne là où elle allait.
      const user = await signUp(form);
      router.replace(safeRedirect(redirect) ?? homeFor(user));
    } catch (error) {
      if (error instanceof ApiError) {
        // Le serveur peut refuser un champ précis (ex. nom d'utilisateur déjà pris) : on l'affiche sous ce champ.
        setErrors(error.fields);
        setFormError(Object.keys(error.fields).length > 0 ? "" : error.message);
      } else {
        setFormError("Inscription impossible pour le moment. Réessaie dans un instant.");
      }
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Créer un compte" subtitle="Crée ton compte pour réserver tes places et retrouver tes billets.">
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
        hint="3 à 30 caractères : lettres, chiffres, point, tiret, tiret bas. Tu t'en serviras pour te connecter."
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        error={errors.username}
      />
      <Input
        label="Adresse e-mail"
        icon="mail"
        value={form.email}
        onChangeText={(value) => updateField("email", value)}
        placeholder="toi@exemple.fr"
        hint="Pour vérifier ton compte et retrouver ton mot de passe."
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        inputRef={emailRef}
        error={errors.email}
      />
      <Input
        label="Mot de passe"
        icon="lock"
        value={form.password}
        onChangeText={(value) => updateField("password", value)}
        placeholder={`${MIN_PASSWORD_LENGTH} caractères minimum`}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        inputRef={passwordRef}
        error={errors.password}
      />
      <PasswordStrength password={form.password} />
      <Input
        label="Confirme le mot de passe"
        icon="lock"
        value={form.passwordConfirm}
        onChangeText={(value) => updateField("passwordConfirm", value)}
        placeholder="Le même mot de passe"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        inputRef={confirmRef}
        error={errors.passwordConfirm}
      />

      <View style={styles.checks}>
        <Checkbox checked={form.acceptTerms} onChange={(value) => updateField("acceptTerms", value)} error={errors.acceptTerms}>
          {/* Les pages sont rédigées dans l'administration du serveur : sans page publiée, il n'y a rien à ouvrir, donc pas de lien. */}
          J’accepte les <LegalLink page={site?.termsPage}>conditions générales de vente</LegalLink> et la{" "}
          <LegalLink page={site?.privacyPage}>politique de confidentialité</LegalLink>.
        </Checkbox>
        <Checkbox checked={form.newsletter} onChange={(value) => updateField("newsletter", value)}>
          Je souhaite recevoir les alertes et la newsletter (facultatif).
        </Checkbox>
      </View>

      <Button title="Créer mon compte" onPress={handleSubmit} loading={submitting} />

      <Divider label="ou" />

      <View style={styles.loginRow}>
        <AppText variant="small" color="textSecondary">
          Tu as déjà un compte ?
        </AppText>
        <Pressable
          onPress={() => router.replace({ pathname: "/login", params: redirect ? { redirect } : {} })}
          accessibilityRole="link"
          hitSlop={8}>
          <AppText variant="smallStrong" color="primary">
            Se connecter
          </AppText>
        </Pressable>
      </View>
    </AuthLayout>
  );
}

// Un mot du texte qui ouvre une page légale du serveur ; du texte simple quand la page n'existe pas.
function LegalLink({ page, children }: { page?: PageLink | null; children: string }) {
  if (!page) return <>{children}</>;
  return (
    <AppText
      variant="smallStrong"
      color="primary"
      accessibilityRole="link"
      onPress={() => router.push({ pathname: "/legal/[slug]", params: { slug: page.slug } })}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 20,
  },

  checks: {
    marginTop: 4,
    marginBottom: 12,
  },

  loginRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
});

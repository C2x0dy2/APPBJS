import { router } from "expo-router";
import { Linking, StyleSheet, View } from "react-native";

import { SignInPrompt } from "@/components/sign-in-prompt";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { AppText } from "@/components/ui/app-text";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Icon, IconName } from "@/components/ui/icon";
import { Screen, ScreenHeader } from "@/components/ui/screen";
import { ContentWidth } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useSite } from "@/context/site";
import { useTheme } from "@/hooks/use-theme";
import { CollectiveRole } from "@/types/user";

const COLLECTIVE_ROLE_LABELS: Record<CollectiveRole, string> = {
  admin: "Administrateur",
  manager: "Gestionnaire",
  controller: "Contrôleur",
};

// Onglet "Compte", identique dans les deux espaces.
export function AccountScreen() {
  const { user, signOut, collectiveId, setCollectiveId } = useAuth();
  const site = useSite();

  if (!user) {
    return (
      <Screen>
        <SignInPrompt
          icon="userCircle"
          title="Ton compte"
          message="Connecte-toi ou crée un compte pour gérer tes billets, tes réservations et tes informations."
        />
      </Screen>
    );
  }

  const collective = user.collectives.find((c) => c.id === collectiveId);

  return (
    <Screen maxWidth={ContentWidth.form}>
      <ScreenHeader title="Mon compte" />

      {/* Qui je suis */}
      <Card style={styles.profile} padding={20}>
        <Avatar name={user.name} size={72} />
        <View style={styles.profileText}>
          <AppText variant="h2">{user.name}</AppText>
          <AppText variant="small" color="textSecondary">
            @{user.username}
          </AppText>
          <View style={styles.badges}>
            <Badge label={user.role === "buyer" ? "Acheteur" : "Organisateur"} tone="brand" icon={user.role === "buyer" ? "ticket" : "chart"} />
            <Badge label={user.emailVerified ? "E-mail vérifié" : "E-mail à vérifier"} tone={user.emailVerified ? "success" : "warning"} />
          </View>
        </View>
      </Card>

      <VerifyEmailBanner style={styles.banner} />

      {/* Mes informations */}
      <Card style={styles.infoCard} padding={4}>
        <InfoRow icon="user" label="Nom d'utilisateur" value={user.username} />
        <InfoRow icon="mail" label="Adresse e-mail" value={user.email} />
        {collective ? (
          <InfoRow icon="group" label="Collectif" value={collective.role ? `${collective.name} · ${COLLECTIVE_ROLE_LABELS[collective.role]}` : collective.name} />
        ) : null}
        <InfoRow icon="shield" label="Espace" value={user.role === "buyer" ? "Acheteur" : "Organisateur"} last />
      </Card>

      {/* Un organisateur de plusieurs collectifs choisit celui sur lequel il travaille. */}
      {user.collectives.length > 1 && (
        <View style={styles.switcher}>
          <AppText variant="smallStrong" style={styles.switcherLabel}>
            Collectif actif
          </AppText>
          <View style={styles.chips}>
            {user.collectives.map((c) => (
              <Chip key={c.id} label={c.name} selected={c.id === collectiveId} onPress={() => setCollectiveId(c.id)} />
            ))}
          </View>
        </View>
      )}

      {user.role === "buyer" && (
        <Button title="Voir mes billets" icon="ticket" variant="secondary" onPress={() => router.push("/tickets")} style={styles.action} />
      )}

      {/* Les coordonnées saisies dans l'administration du serveur : rien ne s'affiche tant qu'elles ne sont pas renseignées. */}
      {(site?.contactEmail || site?.contactPhone) && (
        <Card style={styles.infoCard} padding={4}>
          {site.contactEmail ? <ContactRow icon="mail" label="Une question ?" value={site.contactEmail} url={`mailto:${site.contactEmail}`} last={!site.contactPhone} /> : null}
          {site.contactPhone ? <ContactRow icon="phone" label="Nous appeler" value={site.contactPhone} url={`tel:${site.contactPhone.replace(/\s/g, "")}`} last /> : null}
        </Card>
      )}

      {/* signOut met "user" à null : l'espace organisateur n'est alors plus autorisé, l'app revient à l'accueil. */}
      <Button title="Se déconnecter" icon="logout" variant="danger" onPress={signOut} style={[styles.action, { marginTop: 8 }]} />
    </Screen>
  );
}

function InfoRow({ icon, label, value, last = false }: { icon: IconName; label: string; value: string; last?: boolean }) {
  const theme = useTheme();

  return (
    <View style={[styles.infoRow, !last && { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
      <Icon name={icon} size={20} color="textSecondary" />
      <View style={styles.infoText}>
        <AppText variant="caption" color="textSecondary">
          {label}
        </AppText>
        <AppText variant="bodyStrong">{value}</AppText>
      </View>
    </View>
  );
}

// Comme InfoRow, mais touchable : ouvre l'application de messagerie ou de téléphone.
function ContactRow({ icon, label, value, url, last = false }: { icon: IconName; label: string; value: string; url: string; last?: boolean }) {
  const theme = useTheme();

  return (
    <View style={[styles.infoRow, !last && { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
      <Icon name={icon} size={20} color="textSecondary" />
      <View style={styles.infoText}>
        <AppText variant="caption" color="textSecondary">
          {label}
        </AppText>
        <AppText variant="bodyStrong" color="primary" accessibilityRole="link" onPress={() => Linking.openURL(url).catch(() => undefined)}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },

  profileText: {
    flex: 1,
    gap: 2,
  },

  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },

  banner: {
    marginBottom: 16,
  },

  infoCard: {
    marginBottom: 16,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },

  infoText: {
    flex: 1,
  },

  switcher: {
    marginBottom: 16,
  },

  switcherLabel: {
    marginBottom: 8,
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  action: {
    marginBottom: 12,
  },
});

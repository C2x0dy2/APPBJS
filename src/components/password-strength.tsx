import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { passwordStrength } from "../utils/validate-auth";

// La jauge sous le champ "mot de passe" : quatre barres qui se colorent, et un mot ("Faible", "Bon"...).
export function PasswordStrength({ password }: { password: string }) {
  const theme = useTheme();
  const { score, label } = passwordStrength(password);
  if (score === 0) return null;

  const color = score <= 1 ? theme.danger : score === 2 ? theme.warning : theme.success;

  return (
    <View style={styles.container} accessibilityLabel={`Force du mot de passe : ${label}`}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((step) => (
          <View key={step} style={[styles.bar, { backgroundColor: step <= score ? color : theme.backgroundSelected }]} />
        ))}
      </View>
      <AppText variant="caption" color={color}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: -8,
    marginBottom: 16,
  },
  bars: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  bar: {
    flex: 1,
    height: 5,
    borderRadius: Radius.pill,
  },
});

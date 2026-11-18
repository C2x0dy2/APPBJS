import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { LinearGradient } from "expo-linear-gradient";

export type BarChartPoint = { label: string; value: number };

type BarChartProps = {
  data: BarChartPoint[];
  height?: number;
  // Un libellé sous une barre sur N : évite que les dates se chevauchent sur petit écran.
  labelEvery?: number;
  accessibilityLabel?: string;
};

// Un graphique à barres tout simple (une barre par jour), fait de vues : il s'adapte à la largeur de l'écran.
export function BarChart({ data, height = 140, labelEvery = 1, accessibilityLabel }: BarChartProps) {
  const theme = useTheme();
  const max = Math.max(1, ...data.map((point) => point.value));

  return (
    <View accessible accessibilityLabel={accessibilityLabel}>
      <View style={[styles.plot, { height }]}>
        {/* Des repères horizontaux discrets */}
        {[0, 1, 2].map((line) => (
          <View key={line} style={[styles.gridLine, { top: (line / 2) * (height - 1), backgroundColor: theme.border }]} />
        ))}

        {data.map((point, index) => (
          <View key={index} style={styles.column}>
            <LinearGradient
              colors={Gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={[styles.bar, { height: Math.max(point.value > 0 ? 4 : 0, (point.value / max) * (height - 4)) }]}
            />
          </View>
        ))}
      </View>

      <View style={styles.labels}>
        {data.map((point, index) => (
          <View key={index} style={styles.labelCell}>
            {index % labelEvery === 0 && (
              <AppText variant="caption" color="textTertiary" numberOfLines={1} style={styles.label}>
                {point.label}
              </AppText>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
  },
  column: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  bar: {
    width: "100%",
    maxWidth: 28,
    borderTopLeftRadius: Radius.sm / 2,
    borderTopRightRadius: Radius.sm / 2,
  },
  labels: {
    flexDirection: "row",
    gap: 4,
    marginTop: 8,
  },
  labelCell: {
    flex: 1,
    alignItems: "center",
  },
  label: {
    fontSize: 10,
    lineHeight: 12,
  },
});

import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Radius } from "@/constants/theme";
import { errorMessage } from "@/services/api";
import { EntryValidationResult, validateTicketEntry } from "@/services/organizerservices";

// Scan à l'entrée (cahier des charges : "on a déjà eu des billets présentés deux fois"). validate_ticket_entry()
// est atomique côté base : un même code ne peut jamais passer "ok" deux fois, même scanné en même temps sur deux
// téléphones à deux entrées différentes.
export default function ScanTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ result: EntryValidationResult; ticketType?: string } | null>(null);
  const [error, setError] = useState("");
  const lastScanned = useRef<string | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(
    async (code: string) => {
      const trimmed = code.trim();
      if (!trimmed || checking) return;
      setChecking(true);
      setError("");
      try {
        const outcome = await validateTicketEntry(id, trimmed);
        setResult(outcome);
      } catch (e) {
        setError(errorMessage(e, "Impossible de vérifier ce billet. Réessaie."));
      }
      setChecking(false);
      // Le scan reprend après une pause (laisse le temps de lire le résultat avant le prochain billet).
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => {
        lastScanned.current = null;
        setResult(null);
      }, 2500);
    },
    [id, checking]
  );

  function handleBarcodeScanned({ data }: { data: string }) {
    if (data === lastScanned.current) return; // évite de revalider le même QR tant que la caméra le voit encore
    lastScanned.current = data;
    check(data);
  }

  const resultTone = result?.result === "ok" ? "success" : result?.result === "already_used" ? "warning" : "danger";
  const resultLabel = {
    ok: "Billet valide",
    already_used: "Déjà scanné",
    invalid: "Billet invalide",
  }[result?.result ?? "invalid"];

  return (
    <Screen scroll>
      <AppText variant="h1" style={styles.title}>
        Scanner les billets
      </AppText>

      {Platform.OS !== "web" || permission?.granted ? (
        permission?.granted ? (
          <View style={[styles.cameraWrap, { borderRadius: Radius.lg }]}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={checking ? undefined : handleBarcodeScanned}
            />
          </View>
        ) : (
          <Banner tone="info" title="Caméra nécessaire" icon="scan">
            Autorise la caméra pour scanner les QR codes des billets.
          </Banner>
        )
      ) : (
        <Banner tone="info" title="Caméra nécessaire" icon="scan">
          Autorise la caméra pour scanner les QR codes des billets.
        </Banner>
      )}

      {!permission?.granted && (
        <Button title="Autoriser la caméra" icon="scan" onPress={requestPermission} style={styles.permissionButton} />
      )}

      {result && (
        <Banner tone={resultTone} title={resultLabel} style={styles.result}>
          {result.ticketType ?? ""}
        </Banner>
      )}
      {error !== "" && <Banner tone="danger">{error}</Banner>}

      <AppText variant="smallStrong" color="textSecondary" style={styles.manualTitle}>
        Ou saisis le code manuellement
      </AppText>
      <Input
        value={manualCode}
        onChangeText={setManualCode}
        placeholder="Code du billet"
        autoCapitalize="none"
        right={
          <Button
            title="Vérifier"
            size="sm"
            fullWidth={false}
            loading={checking}
            onPress={() => {
              check(manualCode);
              setManualCode("");
            }}
          />
        }
      />

      <Button title="Terminer" variant="secondary" onPress={() => router.back()} style={styles.done} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: 16 },
  cameraWrap: { aspectRatio: 1, overflow: "hidden", marginBottom: 16 },
  camera: { flex: 1 },
  permissionButton: { marginBottom: 16 },
  result: { marginBottom: 16 },
  manualTitle: { marginBottom: 8 },
  done: { marginTop: 24 },
});

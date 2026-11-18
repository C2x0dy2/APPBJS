import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { EventCover } from "@/components/event-cover";
import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Radius } from "@/constants/theme";
import { ApiError, errorMessage } from "@/services/api";
import { PickedImage, removeEventImage, uploadEventImage } from "@/services/organizerservices";
import { Event } from "@/types/even";
import { confirmAction } from "@/utils/confirm";

// L'affiche d'un événement : voir l'actuelle, en choisir une dans la photothèque, la décrire (obligatoire), la retirer.
// Le serveur vérifie l'image (JPG, PNG ou WebP, 5 Mo au plus, 600 × 400 pixels au moins) et en fabrique les versions adaptées aux écrans.
export function EventImageEditor({ event, onChanged }: { event: Event; onChanged: () => void }) {
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [alt, setAlt] = useState(event.image?.alt ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ image?: string; alt?: string; general?: string }>({});

  async function choose() {
    setErrors({});
    // Sur le web, le sélecteur doit être ouvert directement par un clic (sinon le navigateur le bloque) : c'est le cas ici.
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPicked({ uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType, file: asset.file });
  }

  async function save() {
    if (!picked || busy) return;
    if (alt.trim() === "") {
      setErrors({ alt: "Décris l'image en quelques mots : c'est ce que liront les personnes qui ne la voient pas." });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await uploadEventImage(event.id, picked, alt);
      setPicked(null);
      onChanged();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        setErrors({ image: error.fields.image, alt: error.fields.alt, general: error.fields.image || error.fields.alt ? undefined : error.message });
      } else {
        setErrors({ general: errorMessage(error, "L'envoi de l'affiche a échoué. Réessaie.") });
      }
    }
    setBusy(false);
  }

  async function remove() {
    const ok = await confirmAction("Retirer l'affiche ?", "L'événement reviendra à l'illustration par défaut.", "Retirer");
    if (!ok) return;
    setBusy(true);
    setErrors({});
    try {
      await removeEventImage(event.id);
      setAlt("");
      onChanged();
    } catch (error) {
      setErrors({ general: errorMessage(error, "L'affiche n'a pas pu être retirée. Réessaie.") });
    }
    setBusy(false);
  }

  return (
    <Card style={styles.card} padding={16}>
      <AppText variant="h3" style={styles.title}>
        Affiche
      </AppText>

      <View style={styles.preview}>
        {picked ? (
          <Image source={{ uri: picked.uri }} contentFit="cover" alt="Aperçu de l'image choisie" style={styles.previewImage} />
        ) : (
          <EventCover event={event} height={160} />
        )}
      </View>

      {errors.general && (
        <Banner tone="danger" style={styles.banner}>
          {errors.general}
        </Banner>
      )}
      {errors.image && (
        <Banner tone="danger" title="Image refusée" style={styles.banner}>
          {errors.image}
        </Banner>
      )}

      {picked && (
        <Input
          label="Description de l'image"
          value={alt}
          onChangeText={(value) => {
            setAlt(value);
            if (errors.alt) setErrors({ ...errors, alt: undefined });
          }}
          placeholder="Affiche du concert, les artistes sur scène…"
          hint="Obligatoire : lue par les lecteurs d'écran et affichée si l'image ne charge pas."
          error={errors.alt}
        />
      )}

      <View style={styles.buttons}>
        <Button title={picked ? "Choisir une autre image" : event.image ? "Changer l'affiche" : "Ajouter une affiche"} icon="plus" variant="secondary" size="md" onPress={choose} disabled={busy} />
        {picked && <Button title="Enregistrer l'affiche" icon="check" size="md" onPress={save} loading={busy} />}
        {!picked && event.image && <Button title="Retirer l'affiche" icon="trash" variant="danger" size="md" onPress={remove} disabled={busy} />}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 24,
  },

  title: {
    marginBottom: 12,
  },

  preview: {
    borderRadius: Radius.md,
    overflow: "hidden",
    marginBottom: 14,
  },

  previewImage: {
    height: 160,
    width: "100%",
  },

  banner: {
    marginBottom: 12,
  },

  buttons: {
    gap: 10,
  },
});

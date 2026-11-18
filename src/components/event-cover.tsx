import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { CoverPalettes } from '@/constants/theme';
import type { Event, EventImage } from '@/types/even';

// Un dégradé stable pour chaque événement : le même identifiant donne toujours les mêmes couleurs.
// Il sert de fond quand l'événement n'a pas d'affiche, et pendant le chargement de l'affiche.
export function coverColors(id: string): (typeof CoverPalettes)[number] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CoverPalettes[hash % CoverPalettes.length];
}

// Le serveur fournit plusieurs largeurs de la même affiche (comme un « srcset » web) : on prend la plus petite qui reste
// nette sur cet écran, plutôt que de télécharger la plus grande pour une petite carte.
export function pickImageUrl(image: EventImage, displayWidth: number): string {
  const needed = displayWidth * PixelRatio.get();
  const sources = [...image.sources].sort((a, b) => a.width - b.width);
  return (sources.find((source) => source.width >= needed) ?? sources[sources.length - 1])?.url ?? image.url;
}

type EventCoverProps = {
  event: Pick<Event, 'id' | 'image'>;
  height?: number;
  children?: ReactNode; // éléments posés sur la pochette (date, statut, bouton retour...)
  style?: StyleProp<ViewStyle>;
};

export function EventCover({ event, height = 120, children, style }: EventCoverProps) {
  const [width, setWidth] = useState(0);
  // L'adresse de l'affiche qui n'a pas pu se charger : une NOUVELLE affiche (autre adresse) est de nouveau essayée.
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const image = event.image && event.image.url !== failedUrl ? event.image : null;

  // On attend de connaître la largeur réellement affichée pour choisir la bonne version de l'affiche.
  function handleLayout(layout: LayoutChangeEvent) {
    setWidth(Math.round(layout.nativeEvent.layout.width));
  }

  return (
    <LinearGradient
      colors={coverColors(event.id)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      onLayout={handleLayout}
      style={[styles.cover, { height }, style]}>
      {image ? (
        width > 0 && (
          <Image
            source={{ uri: pickImageUrl(image, width) }}
            alt={image.alt}
            contentFit="cover"
            transition={200}
            onError={() => setFailedUrl(image.url)} // affiche introuvable : on retombe sur le dégradé
            style={StyleSheet.absoluteFill}
          />
        )
      ) : (
        <>
          {/* Décor : deux cercles translucides et une note de musique, pour que la pochette ne soit pas "vide". */}
          <View style={[styles.circle, { width: height * 1.1, height: height * 1.1, right: -height * 0.35, top: -height * 0.5 }]} />
          <View style={[styles.circle, { width: height * 0.7, height: height * 0.7, left: -height * 0.2, bottom: -height * 0.4, opacity: 0.6 }]} />
          <Icon
            name="music"
            size={height * 0.8}
            color="rgba(255, 255, 255, 0.2)"
            style={[styles.note, { right: height * 0.1, bottom: -height * 0.08 }]}
          />
        </>
      )}
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  cover: {
    overflow: 'hidden',
  },
  circle: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  note: {
    position: 'absolute',
    transform: [{ rotate: '-12deg' }],
  },
});

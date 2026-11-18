import createQr from 'qrcode-generator';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

type QrCodeProps = {
  value: string; // le contenu à encoder : ici, le code secret du billet
  size?: number;
  color?: string;
  background?: string;
};

// Un vrai QR code (lisible par n'importe quel lecteur), dessiné en SVG : net à toutes les tailles.
export function QrCode({ value, size = 200, color = '#1D0B33', background = '#FFFFFF' }: QrCodeProps) {
  const { path, count } = useMemo(() => {
    const qr = createQr(0, 'M'); // 0 = taille automatique, M = correction d'erreur moyenne
    qr.addData(value);
    qr.make();

    const modules = qr.getModuleCount();
    let d = '';
    // On regroupe les carrés noirs voisins d'une même ligne en un seul rectangle : un dessin beaucoup plus léger.
    for (let row = 0; row < modules; row++) {
      let col = 0;
      while (col < modules) {
        if (!qr.isDark(row, col)) {
          col++;
          continue;
        }
        let end = col;
        while (end < modules && qr.isDark(row, end)) end++;
        d += `M${col} ${row}h${end - col}v1h-${end - col}z`;
        col = end;
      }
    }
    return { path: d, count: modules };
  }, [value]);

  // Une marge blanche de 4 carrés autour : indispensable pour que le QR code soit détecté.
  const quiet = 4;
  const side = count + quiet * 2;

  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${side} ${side}`} accessibilityLabel="QR code du billet">
      <Rect x={-quiet} y={-quiet} width={side} height={side} fill={background} />
      <Path d={path} fill={color} />
    </Svg>
  );
}

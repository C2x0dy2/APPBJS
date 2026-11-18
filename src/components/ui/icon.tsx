import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { StyleProp, ViewStyle } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Une icône = un nom "logique" (ex. "calendar") + son dessin sur iOS (SF Symbols) et sur Android/web (Material Symbols).
// Les noms sont vérifiés par TypeScript : une faute de frappe est signalée tout de suite.
type PerPlatform = Exclude<SymbolViewProps['name'], string>;
type IconEntry = {
  ios: NonNullable<PerPlatform['ios']>;
  md: NonNullable<PerPlatform['android']>;
};

const ICONS = {
  home: { ios: 'house', md: 'home' },
  search: { ios: 'magnifyingglass', md: 'search' },
  calendar: { ios: 'calendar', md: 'calendar_month' },
  clock: { ios: 'clock', md: 'schedule' },
  pin: { ios: 'mappin.and.ellipse', md: 'location_on' },
  ticket: { ios: 'ticket', md: 'confirmation_number' },
  user: { ios: 'person', md: 'person' },
  userCircle: { ios: 'person.circle', md: 'account_circle' },
  userAdd: { ios: 'person.badge.plus', md: 'person_add' },
  group: { ios: 'person.2', md: 'group' },
  chart: { ios: 'chart.bar', md: 'bar_chart' },
  trend: { ios: 'chart.line.uptrend.xyaxis', md: 'trending_up' },
  money: { ios: 'creditcard', md: 'payments' },
  qr: { ios: 'qrcode', md: 'qr_code_2' },
  scan: { ios: 'qrcode.viewfinder', md: 'qr_code_scanner' },
  bell: { ios: 'bell', md: 'notifications' },
  login: { ios: 'rectangle.portrait.and.arrow.forward', md: 'login' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', md: 'logout' },
  back: { ios: 'chevron.left', md: 'arrow_back' },
  chevronRight: { ios: 'chevron.right', md: 'chevron_right' },
  plus: { ios: 'plus', md: 'add' },
  minus: { ios: 'minus', md: 'remove' },
  check: { ios: 'checkmark', md: 'check' },
  checkCircle: { ios: 'checkmark.circle', md: 'check_circle' },
  close: { ios: 'xmark', md: 'close' },
  eye: { ios: 'eye', md: 'visibility' },
  eyeOff: { ios: 'eye.slash', md: 'visibility_off' },
  mail: { ios: 'envelope', md: 'mail' },
  phone: { ios: 'phone', md: 'call' },
  lock: { ios: 'lock', md: 'lock' },
  tag: { ios: 'tag', md: 'sell' },
  door: { ios: 'door.left.hand.open', md: 'door_front' },
  edit: { ios: 'pencil', md: 'edit' },
  trash: { ios: 'trash', md: 'delete' },
  info: { ios: 'info.circle', md: 'info' },
  warning: { ios: 'exclamationmark.triangle', md: 'warning' },
  error: { ios: 'exclamationmark.circle', md: 'error' },
  music: { ios: 'music.note', md: 'music_note' },
  sparkles: { ios: 'sparkles', md: 'auto_awesome' },
  hourglass: { ios: 'hourglass', md: 'hourglass_empty' },
  timer: { ios: 'timer', md: 'timer' },
  globe: { ios: 'globe', md: 'public' },
  shield: { ios: 'shield', md: 'shield' },
  undo: { ios: 'arrow.uturn.backward', md: 'undo' },
  refresh: { ios: 'arrow.clockwise', md: 'refresh' },
  receipt: { ios: 'receipt', md: 'receipt_long' },
  star: { ios: 'star', md: 'star' },
  list: { ios: 'list.bullet', md: 'list' },
} satisfies Record<string, IconEntry>;

export type IconName = keyof typeof ICONS;

export function iconEntry(name: IconName): IconEntry {
  return ICONS[name];
}

type IconProps = {
  name: IconName;
  size?: number;
  // Un nom de couleur du thème ("textSecondary", "primary"...) ou directement une couleur ("#fff").
  color?: ThemeColor | (string & {});
  style?: StyleProp<ViewStyle>;
};

export function Icon({ name, size = 20, color = 'text', style }: IconProps) {
  const theme = useTheme();
  const tint = color in theme ? theme[color as ThemeColor] : color;
  const { ios, md } = ICONS[name];

  // android et web partagent les mêmes noms Material.
  return <SymbolView name={{ ios, android: md, web: md }} size={size} tintColor={tint} style={style} />;
}

import { Link, router } from 'expo-router';
import { TabList, TabListProps, TabSlot, TabTrigger, TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { TabConfig } from './tab-config';

import { AppText } from '@/components/ui/app-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Logo } from '@/components/ui/logo';
import { ContentWidth, Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';

// Version web de la barre d'onglets : même liste d'onglets que sur mobile.
//   - Grand écran : une barre en haut (logo, onglets, connexion ou compte).
//   - Petit écran : une barre en bas avec des icônes, comme sur téléphone.
// La barre fait partie de la page (elle ne flotte pas par-dessus le contenu).
export default function AppTabs({ tabs }: { tabs: TabConfig[] }) {
  const { isWide } = useBreakpoint();

  const triggers = tabs.map((tab) => (
    <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
      {isWide ? <TopTabButton tab={tab} /> : <BottomTabButton tab={tab} />}
    </TabTrigger>
  ));

  return (
    <Tabs>
      {isWide && (
        <TabList asChild>
          <TopBar>{triggers}</TopBar>
        </TabList>
      )}

      <TabSlot style={styles.slot} />

      {!isWide && (
        <TabList asChild>
          <BottomBar>{triggers}</BottomBar>
        </TabList>
      )}
    </Tabs>
  );
}

// --- Grand écran : barre du haut ---

function TopBar(props: TabListProps) {
  const theme = useTheme();
  const { user, signOut } = useAuth();

  return (
    <View {...props} style={[styles.topBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
      <View style={styles.topInner}>
        <Link href={user?.role === 'organizer' ? '/organizer' : '/'} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel="Accueil">
            <Logo size={34} />
          </Pressable>
        </Link>

        <View style={styles.topTabs}>{props.children}</View>

        <View style={styles.topActions}>
          {user ? (
            <>
              <Avatar name={user.name} size={36} />
              <AppText variant="smallStrong">{user.name}</AppText>
              <Button
                title="Déconnexion"
                variant="ghost"
                size="sm"
                icon="logout"
                fullWidth={false}
                onPress={() => {
                  signOut();
                }}
              />
            </>
          ) : (
            <>
              <Button title="Connexion" variant="ghost" size="sm" fullWidth={false} onPress={() => router.push('/login')} />
              <Button title="S'inscrire" size="sm" fullWidth={false} onPress={() => router.push('/register')} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// Les props d'onglet d'expo-router typent `key` et `ref` avec une autre copie des types React que celle de Pressable :
// TypeScript refusait de les transmettre telles quelles (« Two different types with this name exist »). On les retire
// seulement du TYPE : à l'exécution l'objet est transmis tel quel, `ref` compris.
function pressableProps<T extends object>(props: T): Omit<T, 'key' | 'ref'> {
  return props as Omit<T, 'key' | 'ref'>;
}

function TopTabButton({ tab, isFocused, children: _children, ...props }: TabTriggerSlotProps & { tab: TabConfig }) {
  const theme = useTheme();

  return (
    <Pressable
      {...pressableProps(props)}
      accessibilityRole="link"
      accessibilityState={{ selected: isFocused }}
      style={(state) => [
        styles.topTab,
        { backgroundColor: isFocused ? theme.primarySoft : (state as { hovered?: boolean }).hovered ? theme.backgroundElement : 'transparent' },
      ]}>
      <Icon name={tab.icon} size={18} color={isFocused ? 'primary' : 'textSecondary'} />
      <AppText variant="smallStrong" color={isFocused ? 'primary' : 'textSecondary'}>
        {tab.label}
      </AppText>
    </Pressable>
  );
}

// --- Petit écran : barre du bas ---

function BottomBar(props: TabListProps) {
  const theme = useTheme();

  return (
    <View {...props} style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
      {props.children}
    </View>
  );
}

function BottomTabButton({ tab, isFocused, children: _children, ...props }: TabTriggerSlotProps & { tab: TabConfig }) {
  return (
    <Pressable {...pressableProps(props)} accessibilityRole="link" accessibilityState={{ selected: isFocused }} style={styles.bottomTab}>
      <Icon name={tab.icon} size={24} color={isFocused ? 'primary' : 'textSecondary'} />
      <AppText variant="caption" color={isFocused ? 'primary' : 'textSecondary'} style={styles.bottomLabel}>
        {tab.label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    flex: 1,
  },

  // --- barre du haut ---
  topBar: {
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  topInner: {
    width: '100%',
    maxWidth: ContentWidth.wide + 40, // + les 2 marges de 20 px : le logo s'aligne avec le contenu des pages
    height: 68,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  topTabs: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  // --- barre du bas ---
  bottomBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: 6,
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: 10,
    paddingBottom: 6,
  },
  bottomLabel: {
    fontSize: 11,
  },
});

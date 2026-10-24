import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert, Pressable, View } from 'react-native';
import {
  AppText,
  Button,
  Card,
  ErrorView,
  LoadingView,
  Notice,
  Screen,
} from '../../src/components/ui';
import { ProfileView } from '../../src/features/ProfileView';
import { useMyProducts, usePublicUser } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, MIN_TOUCH, spacing } from '../../src/theme/tokens';

const LINKS: { icon: keyof typeof Ionicons.glyphMap; label: string; href: string }[] = [
  { icon: 'receipt-outline', label: 'Mes achats et ventes', href: '/orders' },
  { icon: 'storefront-outline', label: 'Espace vendeur et paiements', href: '/seller' },
  { icon: 'notifications-outline', label: 'Notifications', href: '/notifications' },
  { icon: 'settings-outline', label: 'Compte et confidentialité', href: '/settings' },
  { icon: 'help-circle-outline', label: 'Aide et litiges', href: '/help' },
];

export default function Profile() {
  const me = useAuth((s) => s.user);
  const profile = usePublicUser(me?.id ?? '');
  const mine = useMyProducts();
  if (!me || profile.isLoading) return <LoadingView />;
  if (!profile.data)
    return <ErrorView message="Profil indisponible" onRetry={() => profile.refetch()} />;
  const active = (mine.data?.items ?? []).filter(
    (p) => p.status === 'ACTIVE' || p.status === 'RESERVED',
  );
  const drafts = (mine.data?.items ?? []).filter(
    (p) => p.status === 'DRAFT' || p.status === 'ARCHIVED',
  );

  async function resend() {
    try {
      await api.request('/auth/resend-verification', { method: 'POST' });
      Alert.alert('Email envoyé', 'Consultez votre boîte de réception.');
    } catch (e) {
      Alert.alert('Envoi impossible', e instanceof ApiError ? e.message : '');
    }
  }

  return (
    <Screen>
      <ProfileView
        user={profile.data}
        active={active}
        header={
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: spacing.lg,
            }}
          >
            <AppText variant="title">Profil</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Paramètres"
              onPress={() => router.push('/settings')}
              style={{
                width: MIN_TOUCH,
                height: MIN_TOUCH,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="settings-outline" size={24} color={colors.text} />
            </Pressable>
          </View>
        }
        footer={
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {!me.emailVerified && (
              <View style={{ gap: spacing.sm }}>
                <Notice text="Adresse email non vérifiée : vente, achat et messagerie sont limités." />
                <Button title="Renvoyer l’email de confirmation" variant="ghost" onPress={resend} />
              </View>
            )}
            <Card style={{ padding: 0 }}>
              {LINKS.map((l) => (
                <Pressable
                  key={l.href}
                  accessibilityRole="button"
                  onPress={() => router.push(l.href as never)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    padding: spacing.lg,
                  }}
                >
                  <Ionicons name={l.icon} size={22} color={colors.primaryLight} />
                  <AppText style={{ flex: 1 }}>{l.label}</AppText>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
              ))}
            </Card>
            {drafts.length > 0 && (
              <Card>
                <AppText variant="heading">Brouillons et annonces archivées</AppText>
                {drafts.map((d) => (
                  <Pressable
                    key={d.id}
                    onPress={() => router.push(`/product/${d.id}`)}
                    style={{ paddingVertical: spacing.sm }}
                  >
                    <AppText>{d.title}</AppText>
                    <AppText variant="caption" color={colors.textSecondary}>
                      {d.status === 'DRAFT' ? 'Brouillon' : 'Archivée'}
                    </AppText>
                  </Pressable>
                ))}
              </Card>
            )}
          </View>
        }
      />
    </Screen>
  );
}

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { MeUser, SellerSummary, updateProfileSchema } from '@snapmarket/shared';
import {
  AppText,
  Avatar,
  Button,
  Card,
  Header,
  Notice,
  Screen,
  TextField,
} from '../src/components/ui';
import { api, ApiError } from '../src/services/api';
import { pickFromLibrary, uploadAsset, waitUntilReady } from '../src/services/media';
import { useAuth } from '../src/stores/auth';
import { colors, spacing } from '../src/theme/tokens';

export default function Settings() {
  const me = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const logout = useAuth((s) => s.logout);
  const [displayName, setDisplayName] = useState(me.displayName ?? '');
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? '');
  const [city, setCity] = useState(me.city ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const blocked = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.request<SellerSummary[]>('/users/me/blocks'),
  });

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      Alert.alert(
        'Erreur',
        e instanceof ApiError || e instanceof Error ? e.message : 'Réessayez plus tard.',
      );
    } finally {
      setBusy(null);
    }
  }

  const saveProfile = () =>
    run('profile', async () => {
      const parsed = updateProfileSchema.safeParse({
        displayName: displayName || undefined,
        username,
        bio,
        city,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Données invalides');
      setUser(await api.request<MeUser>('/users/me', { method: 'PATCH', body: parsed.data }));
      Alert.alert('Profil mis à jour');
    });

  const changeAvatar = () =>
    run('avatar', async () => {
      const [asset] = await pickFromLibrary({ limit: 1 });
      if (!asset) return;
      const media = await uploadAsset(asset, 'AVATAR');
      await waitUntilReady(media.id);
      setUser(
        await api.request<MeUser>('/users/me', {
          method: 'PATCH',
          body: { avatarMediaId: media.id },
        }),
      );
    });

  const changePassword = () =>
    run('password', async () => {
      await api.request('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, password: newPassword },
      });
      Alert.alert('Mot de passe modifié', 'Par sécurité, reconnectez-vous.');
      await logout();
    });

  const logoutAll = () =>
    run('logoutAll', async () => {
      await api.request('/auth/logout-all', { method: 'POST' });
      await logout();
    });

  const deleteAccount = () =>
    Alert.alert(
      'Supprimer votre compte ?',
      'Vos données personnelles seront anonymisées et vos annonces retirées. Les commandes passées sont conservées pour nos obligations légales. Action irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            run('delete', async () => {
              await api.request('/users/me', {
                method: 'DELETE',
                body: { password: deletePassword },
              });
              await logout();
            }),
        },
      ],
    );

  return (
    <Screen>
      <Header title="Compte et confidentialité" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
      >
        <Card>
          <AppText variant="heading">Profil public</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar uri={me.avatarUrl} size={64} />
            <Button
              title="Changer la photo"
              variant="ghost"
              onPress={changeAvatar}
              loading={busy === 'avatar'}
            />
          </View>
          <TextField
            label="Nom affiché"
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={50}
          />
          <TextField
            label="Pseudonyme"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            maxLength={24}
          />
          <TextField
            label="Présentation"
            value={bio}
            onChangeText={setBio}
            multiline
            maxLength={300}
          />
          <TextField
            label="Ville (affichée sur votre profil)"
            value={city}
            onChangeText={setCity}
            maxLength={80}
          />
          <Button title="Enregistrer" onPress={saveProfile} loading={busy === 'profile'} />
        </Card>

        <Card>
          <AppText variant="heading">Sécurité</AppText>
          <AppText color={colors.textSecondary}>
            Email : {me.email} {me.emailVerified ? '(vérifié)' : '(non vérifié)'}
          </AppText>
          <TextField
            label="Mot de passe actuel"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoComplete="current-password"
          />
          <TextField
            label="Nouveau mot de passe"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
          />
          <Button
            title="Changer le mot de passe"
            variant="secondary"
            onPress={changePassword}
            loading={busy === 'password'}
            disabled={!currentPassword || !newPassword}
          />
          <Button
            title="Se déconnecter de tous les appareils"
            variant="ghost"
            onPress={logoutAll}
            loading={busy === 'logoutAll'}
          />
        </Card>

        <Card>
          <AppText variant="heading">Confidentialité</AppText>
          <AppText color={colors.textSecondary}>
            Vos favoris sont privés. Votre adresse de livraison n’est communiquée qu’au vendeur
            d’une commande payée. Aucune géolocalisation n’est collectée : le lieu de rendez-vous
            est un texte que vous choisissez. Les métadonnées de vos photos (dont la position GPS)
            sont supprimées lors du téléversement.
          </AppText>
          <AppText variant="bodyStrong">Utilisateurs bloqués</AppText>
          {(blocked.data ?? []).length === 0 && (
            <AppText color={colors.textSecondary}>Aucun</AppText>
          )}
          {blocked.data?.map((u) => (
            <View
              key={u.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <AppText>{u.username}</AppText>
              <Button
                title="Débloquer"
                variant="ghost"
                onPress={() =>
                  run(`unblock-${u.id}`, async () => {
                    await api.request(`/users/${u.id}/block`, { method: 'DELETE' });
                    await blocked.refetch();
                  })
                }
              />
            </View>
          ))}
        </Card>

        <Button
          title="Se déconnecter"
          variant="secondary"
          icon="log-out-outline"
          onPress={() => void logout()}
        />

        <Card>
          <AppText variant="heading" color={colors.danger}>
            Supprimer le compte
          </AppText>
          <Notice tone="danger" text="Impossible tant qu’une commande est en cours." />
          <TextField
            label="Mot de passe"
            value={deletePassword}
            onChangeText={setDeletePassword}
            secureTextEntry
          />
          <Button
            title="Supprimer mon compte"
            variant="danger"
            onPress={deleteAccount}
            disabled={!deletePassword}
            loading={busy === 'delete'}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

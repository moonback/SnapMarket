import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { resetPasswordSchema } from '@snapmarket/shared';
import { Button, Header, Notice, Screen, TextField } from '../../src/components/ui';
import { api, ApiError } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';

/** Ouvert depuis le lien reçu par email : snapmarket://reset-password?token=… */
export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Données invalides');
    setLoading(true);
    try {
      await api.request('/auth/reset-password', { method: 'POST', body: parsed.data, auth: false });
      Alert.alert(
        'Mot de passe modifié',
        'Vous pouvez vous connecter avec votre nouveau mot de passe.',
      );
      router.replace('/(auth)/login');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Réinitialisation impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header title="Nouveau mot de passe" onBack={() => router.replace('/(auth)')} />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        {!token && <Notice tone="danger" text="Lien incomplet. Ouvrez le lien reçu par email." />}
        {error && <Notice text={error} tone="danger" />}
        <TextField
          label="Nouveau mot de passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <Button title="Enregistrer" onPress={submit} loading={loading} disabled={!token} />
      </ScrollView>
    </Screen>
  );
}

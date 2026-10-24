import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { forgotPasswordSchema } from '@snapmarket/shared';
import { Button, Header, Notice, Screen, TextField } from '../../src/components/ui';
import { api, ApiError } from '../../src/services/api';
import { spacing } from '../../src/theme/tokens';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Email invalide');
    setLoading(true);
    setError(null);
    try {
      await api.request('/auth/forgot-password', {
        method: 'POST',
        body: parsed.data,
        auth: false,
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Réessayez plus tard');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header title="Mot de passe oublié" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        {sent ? (
          <Notice
            tone="primary"
            text="Si un compte existe pour cette adresse, un email contenant un lien de réinitialisation (valable 1 heure) vient d’être envoyé."
          />
        ) : (
          <>
            {error && <Notice text={error} tone="danger" />}
            <TextField
              label="Email du compte"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title="Envoyer le lien" onPress={submit} loading={loading} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

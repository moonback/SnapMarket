import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { RegisterInput, registerSchema } from '@snapmarket/shared';
import { AppText, Button, Header, Notice, Screen, TextField } from '../../src/components/ui';
import { ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';

export default function Register() {
  const register = useAuth((s) => s.register);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', username: '', password: '', acceptTerms: false as unknown as true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await register(values);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Inscription impossible');
    }
  });

  return (
    <Screen>
      <Header title="Créer un compte" onBack={() => router.back()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {error && <Notice text={error} tone="danger" />}
          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <TextField
                label="Email"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            )}
          />
          <Controller
            control={control}
            name="username"
            render={({ field, fieldState }) => (
              <TextField
                label="Pseudonyme"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                autoCapitalize="none"
                autoComplete="username"
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                label="Mot de passe (10 caractères, majuscule, minuscule, chiffre)"
                value={field.value}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
            )}
          />
          <Controller
            control={control}
            name="acceptTerms"
            render={({ field, fieldState }) => (
              <View style={{ gap: spacing.xs }}>
                <Pressable
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
                  onPress={() => field.onChange(!field.value)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: !!field.value }}
                >
                  <Switch
                    value={!!field.value}
                    onValueChange={field.onChange}
                    trackColor={{ true: colors.primary }}
                  />
                  <AppText style={{ flex: 1 }} variant="caption">
                    J’accepte les conditions générales d’utilisation et la politique de
                    confidentialité.
                  </AppText>
                </Pressable>
                {fieldState.error && (
                  <AppText variant="caption" color={colors.danger}>
                    {fieldState.error.message}
                  </AppText>
                )}
              </View>
            )}
          />
          <Button title="Créer mon compte" onPress={onSubmit} loading={formState.isSubmitting} />
          <AppText variant="caption" color={colors.textSecondary} style={{ textAlign: 'center' }}>
            Un email de confirmation vous sera envoyé. Il est nécessaire pour vendre, acheter et
            écrire aux membres.
          </AppText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

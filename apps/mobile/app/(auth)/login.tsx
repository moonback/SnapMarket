import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { LoginInput, loginSchema } from '@snapmarket/shared';
import { AppText, Button, Header, Notice, Screen, TextField } from '../../src/components/ui';
import { ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';

export default function Login() {
  const login = useAuth((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Connexion impossible');
    }
  });

  return (
    <Screen>
      <Header title="Connexion" onBack={() => router.back()} />
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
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
              />
            )}
          />
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                label="Mot de passe"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
              />
            )}
          />
          <Button title="Se connecter" onPress={onSubmit} loading={formState.isSubmitting} />
          <View style={{ alignItems: 'center', gap: spacing.md }}>
            <AppText
              color={colors.primaryLight}
              onPress={() => router.push('/(auth)/forgot-password')}
              accessibilityRole="link"
            >
              Mot de passe oublié ?
            </AppText>
            <AppText
              color={colors.textSecondary}
              onPress={() => router.replace('/(auth)/register')}
              accessibilityRole="link"
            >
              Pas encore de compte ? Inscription
            </AppText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { SellerProfileDto } from '@snapmarket/shared';
import {
  AppText,
  Badge,
  Button,
  Card,
  Header,
  LoadingView,
  Notice,
  Screen,
  TextField,
} from '../src/components/ui';
import { useStatus } from '../src/hooks/queries';
import { api, ApiError } from '../src/services/api';
import { useAuth } from '../src/stores/auth';
import { colors, spacing } from '../src/theme/tokens';

const VERIFICATION_LABELS: Record<SellerProfileDto['verificationStatus'], string> = {
  NOT_SUBMITTED: 'Non demandée',
  PENDING: 'En cours de vérification',
  VERIFIED: 'Vérifié',
  REJECTED: 'Refusée',
};

export default function SellerSpace() {
  const me = useAuth((s) => s.user);
  const refreshMe = useAuth((s) => s.refreshMe);
  const status = useStatus();
  const seller = useQuery({
    queryKey: ['seller'],
    queryFn: () => api.request<SellerProfileDto | null>('/sellers/me'),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [company, setCompany] = useState('');
  const [siret, setSiret] = useState('');
  const [vat, setVat] = useState('');
  const [address, setAddress] = useState({ line1: '', postalCode: '', city: '' });

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
      await seller.refetch();
      await refreshMe();
    } catch (e) {
      Alert.alert('Action impossible', e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const onboarding = () =>
    run('stripe', async () => {
      const link = await api.request<{ url: string }>('/sellers/me/stripe/onboarding', {
        method: 'POST',
      });
      await WebBrowser.openAuthSessionAsync(link.url, 'snapmarket://seller');
      await api.request('/sellers/me/stripe/refresh', { method: 'POST' });
    });

  const requestPro = () =>
    run('pro', async () => {
      await api.request('/sellers/me/pro-request', {
        method: 'POST',
        body: {
          companyName: company,
          siret,
          vatNumber: vat || undefined,
          legalAddress: {
            fullName: company,
            line1: address.line1,
            postalCode: address.postalCode,
            city: address.city,
            country: 'FR',
          },
        },
      });
      Alert.alert(
        'Demande envoyée',
        'Notre équipe vérifiera vos informations. Le badge professionnel n’apparaîtra qu’après validation.',
      );
    });

  if (seller.isLoading) return <LoadingView />;
  const s = seller.data;

  return (
    <Screen>
      <Header title="Espace vendeur" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl }}
      >
        <Card>
          <AppText variant="heading">Recevoir vos paiements</AppText>
          <AppText color={colors.textSecondary}>
            Les paiements sont gérés par Stripe. Pour vendre avec paiement intégré, créez votre
            compte de versement (identité et IBAN sont saisis directement chez Stripe, jamais chez
            SnapMarket).
          </AppText>
          {!status.data?.paymentsAvailable ? (
            <Notice
              text="Le paiement en ligne n’est pas encore activé sur SnapMarket."
              tone="danger"
            />
          ) : s?.payoutsEnabled ? (
            <Badge label="Versements activés" tone="success" />
          ) : (
            <>
              {s?.stripeOnboardingComplete && (
                <Notice text="Informations envoyées : Stripe finalise la vérification." />
              )}
              <Button
                title={
                  s?.stripeOnboardingComplete
                    ? 'Compléter mon compte Stripe'
                    : 'Activer les versements'
                }
                onPress={onboarding}
                loading={busy === 'stripe'}
                disabled={!me?.emailVerified}
              />
              <Button
                title="Actualiser le statut"
                variant="ghost"
                onPress={() =>
                  run('refresh', async () => {
                    await api.request('/sellers/me/stripe/refresh', { method: 'POST' });
                  })
                }
                loading={busy === 'refresh'}
              />
            </>
          )}
        </Card>

        <Card>
          <AppText variant="heading">Compte professionnel</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <AppText color={colors.textSecondary}>Statut :</AppText>
            <Badge
              label={VERIFICATION_LABELS[s?.verificationStatus ?? 'NOT_SUBMITTED']}
              tone={
                s?.verificationStatus === 'VERIFIED'
                  ? 'success'
                  : s?.verificationStatus === 'REJECTED'
                    ? 'danger'
                    : 'neutral'
              }
            />
          </View>
          {s?.verificationStatus === 'VERIFIED' ? (
            <AppText>
              {s.companyName} — SIRET {s.siret}
            </AppText>
          ) : (
            <>
              <AppText variant="caption" color={colors.textSecondary}>
                Vous vendez dans le cadre d’une activité professionnelle ? Déclarez votre
                entreprise. La vérification est manuelle.
              </AppText>
              <TextField
                label="Raison sociale"
                value={company}
                onChangeText={setCompany}
                maxLength={120}
              />
              <TextField
                label="SIRET (14 chiffres)"
                value={siret}
                onChangeText={setSiret}
                keyboardType="number-pad"
                maxLength={17}
              />
              <TextField
                label="N° TVA intracommunautaire (facultatif)"
                value={vat}
                onChangeText={setVat}
                autoCapitalize="characters"
              />
              <TextField
                label="Adresse du siège"
                value={address.line1}
                onChangeText={(v) => setAddress({ ...address, line1: v })}
              />
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <TextField
                    label="Code postal"
                    value={address.postalCode}
                    onChangeText={(v) => setAddress({ ...address, postalCode: v })}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <TextField
                    label="Ville"
                    value={address.city}
                    onChangeText={(v) => setAddress({ ...address, city: v })}
                  />
                </View>
              </View>
              <Button
                title={
                  s?.verificationStatus === 'PENDING'
                    ? 'Mettre à jour la demande'
                    : 'Envoyer la demande'
                }
                variant="secondary"
                onPress={requestPro}
                loading={busy === 'pro'}
                disabled={!company || !siret || !me?.emailVerified}
              />
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

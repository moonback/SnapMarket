import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import {
  addressSchema,
  CheckoutSession,
  DELIVERY_MODE_LABELS,
  DeliveryMode,
  formatCents,
} from '@snapmarket/shared';
import {
  AppText,
  Button,
  Card,
  Chip,
  ErrorView,
  Header,
  LoadingView,
  Notice,
  Screen,
  TextField,
} from '../../src/components/ui';
import { STRIPE_PUBLISHABLE_KEY } from '../../src/config';
import { useOffers, useProduct, useStatus } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';

/**
 * Paiement. Le prix, les frais et la commission sont calculés par le serveur ;
 * l'application n'affiche qu'une estimation avant la création de la commande.
 * La commande n'est considérée payée qu'après confirmation du prestataire (webhook).
 */
export default function Checkout() {
  const { id, offerId } = useLocalSearchParams<{ id: string; offerId?: string }>();
  const user = useAuth((s) => s.user);
  const product = useProduct(id);
  const status = useStatus();
  const offers = useOffers('buyer', id);
  const [mode, setMode] = useState<DeliveryMode | null>(null);
  const [address, setAddress] = useState({
    fullName: '',
    line1: '',
    line2: '',
    postalCode: '',
    city: '',
    phone: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);

  if (product.isLoading) return <LoadingView />;
  if (!product.data)
    return <ErrorView message="Annonce introuvable" onRetry={() => product.refetch()} />;
  const p = product.data;
  const selected = mode ?? (p.deliveryModes.length === 1 ? p.deliveryModes[0]! : null);
  const offer = offerId
    ? offers.data?.find((o) => o.id === offerId && o.status === 'ACCEPTED')
    : undefined;
  const itemCents = offer?.amountCents ?? p.priceCents;
  const shippingCents = selected === 'SHIPPING' ? (p.shippingFeeCents ?? 0) : 0;
  const paymentsReady = !!STRIPE_PUBLISHABLE_KEY && status.data?.paymentsAvailable === true;

  async function pay() {
    if (!selected)
      return Alert.alert('Mode de remise', 'Choisissez livraison ou remise en main propre.');
    let shippingAddress: unknown;
    if (selected === 'SHIPPING') {
      const parsed = addressSchema.safeParse({
        ...address,
        line2: address.line2 || undefined,
        phone: address.phone || undefined,
        country: 'FR',
      });
      if (!parsed.success) {
        const e: Record<string, string> = {};
        for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
        return setErrors(e);
      }
      shippingAddress = parsed.data;
    }
    setErrors({});
    setPaying(true);
    try {
      const session = await api.request<CheckoutSession>('/orders', {
        method: 'POST',
        body: { productId: p.id, deliveryMode: selected, offerId: offer?.id, shippingAddress },
      });
      const init = await initPaymentSheet({
        merchantDisplayName: 'SnapMarket',
        paymentIntentClientSecret: session.paymentClientSecret,
        returnURL: 'snapmarket://stripe-redirect',
        defaultBillingDetails: { email: user?.email },
        allowsDelayedPaymentMethods: false,
      });
      if (init.error) throw new Error(init.error.message);
      const result = await presentPaymentSheet();
      if (result.error) {
        if (result.error.code !== 'Canceled')
          Alert.alert('Paiement non abouti', result.error.message);
        // La commande reste en attente de paiement : reprise possible depuis son écran.
        router.replace(`/order/${session.order.id}`);
        return;
      }
      router.replace({ pathname: '/order/[id]', params: { id: session.order.id, justPaid: '1' } });
    } catch (e) {
      Alert.alert(
        'Paiement impossible',
        e instanceof ApiError || e instanceof Error ? e.message : 'Réessayez plus tard.',
      );
    } finally {
      setPaying(false);
    }
  }

  const field = (key: keyof typeof address, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={address[key]}
      onChangeText={(v) => setAddress({ ...address, [key]: v })}
      error={errors[key]}
      {...extra}
    />
  );

  return (
    <Screen>
      <Header title="Paiement" onBack={() => router.back()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          {!paymentsReady && (
            <Notice
              text="Le paiement en ligne n’est pas encore disponible sur SnapMarket."
              tone="danger"
            />
          )}
          {!user?.emailVerified && <Notice text="Confirmez votre adresse email pour acheter." />}
          <Card>
            <AppText variant="heading">{p.title}</AppText>
            <AppText color={colors.textSecondary}>Vendu par {p.seller.username}</AppText>
          </Card>
          <AppText variant="heading">Mode de remise</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {p.deliveryModes.map((m) => (
              <Chip
                key={m}
                label={DELIVERY_MODE_LABELS[m]}
                selected={selected === m}
                onPress={() => setMode(m)}
              />
            ))}
          </View>
          {selected === 'SHIPPING' && (
            <View style={{ gap: spacing.md }}>
              <AppText variant="heading">Adresse de livraison (France)</AppText>
              {field('fullName', 'Nom complet', { autoComplete: 'name' })}
              {field('line1', 'Adresse', { autoComplete: 'street-address' })}
              {field('line2', 'Complément (facultatif)')}
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  {field('postalCode', 'Code postal', {
                    keyboardType: 'number-pad',
                    maxLength: 5,
                    autoComplete: 'postal-code',
                  })}
                </View>
                <View style={{ flex: 2 }}>{field('city', 'Ville')}</View>
              </View>
              {field('phone', 'Téléphone (facultatif, pour le transporteur)', {
                keyboardType: 'phone-pad',
                autoComplete: 'tel',
              })}
            </View>
          )}
          {selected === 'MEETUP' && (
            <Notice
              tone="primary"
              text="Après le paiement, vous fixerez ensemble un rendez-vous dans un lieu public. Les fonds ne sont versés au vendeur qu’après votre confirmation de la remise."
            />
          )}
          <Card>
            <Line
              label={offer ? 'Article (offre acceptée)' : 'Article'}
              value={formatCents(itemCents)}
            />
            <Line
              label="Livraison"
              value={selected === 'SHIPPING' ? formatCents(shippingCents) : '—'}
            />
            <Line label="Total estimé" value={formatCents(itemCents + shippingCents)} strong />
            <AppText variant="small" color={colors.textSecondary}>
              Le montant définitif est calculé par SnapMarket à la création de la commande. Paiement
              sécurisé par Stripe : vos données bancaires ne sont jamais transmises à SnapMarket.
            </AppText>
          </Card>
          <Button
            title="Payer"
            icon="lock-closed-outline"
            onPress={pay}
            loading={paying}
            disabled={!paymentsReady || !p.purchase.available || !selected || !user?.emailVerified}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText
        variant={strong ? 'bodyStrong' : 'body'}
        color={strong ? colors.text : colors.textSecondary}
      >
        {label}
      </AppText>
      <AppText variant={strong ? 'heading' : 'body'}>{value}</AppText>
    </View>
  );
}

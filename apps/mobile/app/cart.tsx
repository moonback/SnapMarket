import { Ionicons } from '@expo/vector-icons';
import { initPaymentSheet, presentPaymentSheet } from '../src/services/stripe';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  addressSchema,
  CartCheckoutSession,
  CartItemDto,
  DELIVERY_MODE_LABELS,
  formatCents,
} from '@snapmarket/shared';
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyView,
  ErrorView,
  Header,
  LoadingView,
  Notice,
  Screen,
  TextField,
} from '../src/components/ui';
import { STRIPE_PUBLISHABLE_KEY } from '../src/config';
import { useCart, useCartItem, useRemoveCartItem, useStatus } from '../src/hooks/queries';
import { api, ApiError } from '../src/services/api';
import { useAuth } from '../src/stores/auth';
import { colors, MIN_TOUCH, radius, spacing } from '../src/theme/tokens';

function CartLine({ item }: { item: CartItemDto }) {
  const update = useCartItem();
  const remove = useRemoveCartItem();
  const onError = (e: unknown) =>
    Alert.alert('Panier', e instanceof ApiError ? e.message : 'Action impossible');
  const setQuantity = (quantity: number) =>
    update.mutate(
      { productId: item.product.id, quantity, deliveryMode: item.deliveryMode ?? undefined },
      { onError },
    );
  const cover = item.product.cover?.thumbnailUrl ?? item.product.cover?.url;
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Pressable
          onPress={() => router.push(`/product/${item.product.id}`)}
          accessibilityRole="button"
        >
          {cover ? (
            <Image source={{ uri: cover }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }]} />
          )}
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" numberOfLines={2}>
            {item.product.title}
          </AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            Vendu par {item.product.seller.username}
          </AppText>
          <AppText variant="bodyStrong">{formatCents(item.lineItemCents)}</AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retirer du panier"
          hitSlop={8}
          onPress={() => remove.mutate(item.product.id, { onError })}
        >
          <Ionicons name="trash-outline" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}
      >
        {item.deliveryModes.map((m) => (
          <Chip
            key={m}
            label={
              m === 'SHIPPING' && item.shippingFeeCents !== null
                ? `${DELIVERY_MODE_LABELS[m]} (${formatCents(item.shippingFeeCents)})`
                : DELIVERY_MODE_LABELS[m]
            }
            selected={item.deliveryMode === m}
            onPress={() =>
              update.mutate(
                { productId: item.product.id, quantity: item.quantity, deliveryMode: m },
                { onError },
              )
            }
          />
        ))}
        {item.availableQuantity > 1 && (
          <View style={styles.stepper} accessibilityLabel={`Quantité ${item.quantity}`}>
            <Pressable
              accessibilityLabel="Diminuer"
              disabled={item.quantity <= 1}
              onPress={() => setQuantity(item.quantity - 1)}
              style={styles.stepBtn}
            >
              <Ionicons name="remove" size={18} color={colors.text} />
            </Pressable>
            <AppText>{item.quantity}</AppText>
            <Pressable
              accessibilityLabel="Augmenter"
              disabled={item.quantity >= item.availableQuantity}
              onPress={() => setQuantity(item.quantity + 1)}
              style={styles.stepBtn}
            >
              <Ionicons name="add" size={18} color={colors.text} />
            </Pressable>
          </View>
        )}
      </View>
      {item.issue && (
        <AppText variant="caption" color={colors.warning}>
          {item.issue}
        </AppText>
      )}
    </Card>
  );
}

/**
 * Panier : une commande sera créée par annonce, toutes réglées en un seul paiement.
 * Les montants affichés sont des estimations ; le serveur calcule les montants définitifs.
 */
export default function Cart() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const cart = useCart();
  const status = useStatus();
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

  if (cart.isLoading) return <LoadingView />;
  if (!cart.data) return <ErrorView message="Panier indisponible" onRetry={() => cart.refetch()} />;
  const c = cart.data;
  const needsAddress = c.items.some((i) => i.deliveryMode === 'SHIPPING');
  const paymentsReady = !!STRIPE_PUBLISHABLE_KEY && status.data?.paymentsAvailable === true;

  async function pay() {
    let shippingAddress: unknown;
    if (needsAddress) {
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
      const session = await api.request<CartCheckoutSession>('/cart/checkout', {
        method: 'POST',
        body: { shippingAddress },
      });
      void qc.invalidateQueries({ queryKey: ['cart'] });
      const init = await initPaymentSheet({
        merchantDisplayName: 'SnapMarket',
        paymentIntentClientSecret: session.paymentClientSecret,
        returnURL: 'snapmarket://stripe-redirect',
        defaultBillingDetails: { email: user?.email },
      });
      if (init.error) throw new Error(init.error.message);
      const result = await presentPaymentSheet();
      if (result.error && result.error.code !== 'Canceled')
        Alert.alert('Paiement non abouti', result.error.message);
      router.replace({
        pathname: '/checkout-done/[id]',
        params: { id: session.checkout.id, paid: result.error ? '0' : '1' },
      });
    } catch (e) {
      Alert.alert(
        'Paiement impossible',
        e instanceof ApiError || e instanceof Error ? e.message : 'Réessayez plus tard.',
      );
      void cart.refetch();
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
      <Header title="Panier" onBack={() => router.back()} />
      {c.items.length === 0 ? (
        <EmptyView
          icon="bag-outline"
          title="Votre panier est vide"
          subtitle="Ajoutez des articles depuis leur annonce."
          action={
            <Button
              title="Découvrir"
              variant="secondary"
              onPress={() => router.navigate('/(tabs)')}
            />
          }
        />
      ) : (
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
            {c.sellerCount > 1 && (
              <Notice
                tone="primary"
                text={`${c.sellerCount} vendeurs : une commande sera créée par article, réglées en un seul paiement. Chaque vendeur expédie ou remet son article séparément.`}
              />
            )}
            {c.items.map((item) => (
              <CartLine key={item.product.id} item={item} />
            ))}
            {needsAddress && (
              <Card>
                <AppText variant="heading">Adresse de livraison (France)</AppText>
                {field('fullName', 'Nom complet', { autoComplete: 'name' })}
                {field('line1', 'Adresse', { autoComplete: 'street-address' })}
                {field('line2', 'Complément (facultatif)')}
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    {field('postalCode', 'Code postal', {
                      keyboardType: 'number-pad',
                      maxLength: 5,
                    })}
                  </View>
                  <View style={{ flex: 2 }}>{field('city', 'Ville')}</View>
                </View>
                {field('phone', 'Téléphone (facultatif)', { keyboardType: 'phone-pad' })}
              </Card>
            )}
            <Card>
              <Line label="Articles" value={formatCents(c.itemsTotalCents)} />
              <Line label="Livraison" value={formatCents(c.shippingTotalCents)} />
              <Line label="Total estimé" value={formatCents(c.totalCents)} strong />
              <AppText variant="small" color={colors.textSecondary}>
                Montants définitifs calculés par SnapMarket à la création des commandes. Paiement
                sécurisé par Stripe.
              </AppText>
            </Card>
            <Button
              title={`Payer ${formatCents(c.totalCents)}`}
              icon="lock-closed-outline"
              onPress={pay}
              loading={paying}
              disabled={!c.ready || !paymentsReady || !user?.emailVerified}
            />
            {!user?.emailVerified && <Notice text="Confirmez votre adresse email pour acheter." />}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
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

const styles = StyleSheet.create({
  thumb: { width: 64, height: 80, borderRadius: radius.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: 'auto',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
  },
  stepBtn: {
    width: MIN_TOUCH - 8,
    height: MIN_TOUCH - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

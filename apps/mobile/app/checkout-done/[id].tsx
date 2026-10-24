import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { formatCents, ORDER_STATUS_LABELS } from '@snapmarket/shared';
import {
  AppText,
  Badge,
  Button,
  Card,
  ErrorView,
  Header,
  LoadingView,
  Notice,
  Screen,
} from '../../src/components/ui';
import { useCheckout } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { colors, spacing } from '../../src/theme/tokens';

/** Suivi d'un paiement groupé : le statut « payé » n'est affiché qu'après confirmation par le prestataire. */
export default function CheckoutDone() {
  const { id, paid } = useLocalSearchParams<{ id: string; paid?: string }>();
  const [busy, setBusy] = useState(false);
  const pending = (s?: string) => s === 'PENDING_PAYMENT';
  const checkout = useCheckout(id, paid === '1');

  if (checkout.isLoading) return <LoadingView />;
  if (!checkout.data)
    return <ErrorView message="Paiement introuvable" onRetry={() => checkout.refetch()} />;
  const c = checkout.data;
  const waiting = c.orders.some((o) => pending(o.status));

  async function resume() {
    setBusy(true);
    try {
      const { paymentClientSecret } = await api.request<{ paymentClientSecret: string }>(
        `/checkouts/${c.id}/payment`,
      );
      const init = await initPaymentSheet({
        merchantDisplayName: 'SnapMarket',
        paymentIntentClientSecret: paymentClientSecret,
        returnURL: 'snapmarket://stripe-redirect',
      });
      if (init.error) throw new Error(init.error.message);
      const res = await presentPaymentSheet();
      if (res.error) {
        if (res.error.code !== 'Canceled') Alert.alert('Paiement non abouti', res.error.message);
      } else router.setParams({ paid: '1' });
    } catch (e) {
      Alert.alert('Paiement', e instanceof ApiError || e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.request(`/checkouts/${c.id}/cancel`, { method: 'POST' });
      await checkout.refetch();
    } catch (e) {
      Alert.alert('Annulation', e instanceof ApiError ? e.message : '');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Header title={`Paiement ${c.reference}`} onBack={() => router.replace('/orders')} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {waiting && paid === '1' && (
          <Notice tone="primary" text="Paiement en cours de confirmation par le prestataire…" />
        )}
        {!waiting && c.orders.every((o) => o.status !== 'CANCELLED') && (
          <Notice tone="primary" text="Paiement confirmé. Chaque vendeur a été prévenu." />
        )}
        <Card>
          <AppText variant="heading">
            {c.orders.length} commande(s) — {formatCents(c.totalCents)}
          </AppText>
          {c.orders.map((o) => (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              onPress={() => router.push(`/order/${o.id}`)}
              style={{ paddingVertical: spacing.sm, gap: 2 }}
            >
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}
              >
                <AppText style={{ flex: 1 }} numberOfLines={1}>
                  {o.product.title}
                </AppText>
                <AppText variant="bodyStrong">{formatCents(o.pricing.totalCents)}</AppText>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="caption" color={colors.textSecondary}>
                  {o.seller.username} · {o.reference}
                </AppText>
                <Badge
                  label={ORDER_STATUS_LABELS[o.status]}
                  tone={
                    o.status === 'PAID'
                      ? 'success'
                      : o.status === 'CANCELLED'
                        ? 'danger'
                        : 'warning'
                  }
                />
              </View>
            </Pressable>
          ))}
        </Card>
        {waiting && paid !== '1' && (
          <>
            <Button title="Finaliser le paiement" onPress={resume} loading={busy} />
            <Button
              title="Annuler ces commandes"
              variant="ghost"
              onPress={cancel}
              disabled={busy}
            />
          </>
        )}
        <Button title="Mes achats" variant="secondary" onPress={() => router.replace('/orders')} />
      </ScrollView>
    </Screen>
  );
}

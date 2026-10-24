import { Ionicons } from '@expo/vector-icons';
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import {
  CheckoutSession,
  ConversationDto,
  formatCents,
  MeetupDto,
  ORDER_STATUS_LABELS,
  OrderDto,
} from '@snapmarket/shared';
import {
  AppText,
  Badge,
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
import { useOrder } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';
import { formatDateTime } from '../../src/utils/format';

const DISPUTE_REASONS = [
  { value: 'NOT_RECEIVED', label: 'Article non reçu' },
  { value: 'NOT_AS_DESCRIBED', label: 'Non conforme à l’annonce' },
  { value: 'DAMAGED', label: 'Article endommagé' },
  { value: 'HANDOFF_ISSUE', label: 'Problème lors de la remise' },
  { value: 'OTHER', label: 'Autre' },
];

/** Analyse « JJ/MM/AAAA » + « HH:MM » en date locale. */
function parseLocalDateTime(date: string, time: string): Date | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  const t = /^(\d{1,2})[:h](\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const result = new Date(Number(d[3]), Number(d[2]) - 1, Number(d[1]), Number(t[1]), Number(t[2]));
  return Number.isNaN(result.getTime()) ? null : result;
}

export default function OrderScreen() {
  const { id, justPaid } = useLocalSearchParams<{ id: string; justPaid?: string }>();
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(justPaid === '1');
  // Après paiement, on interroge le serveur jusqu'à confirmation par le prestataire.
  const order = useOrder(id, waiting ? 2500 : false);
  const [busy, setBusy] = useState<string | null>(null);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [meetDate, setMeetDate] = useState('');
  const [meetTime, setMeetTime] = useState('');
  const [meetPlace, setMeetPlace] = useState('');
  const [disputeReason, setDisputeReason] = useState<string | null>(null);
  const [disputeDetails, setDisputeDetails] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const confirmedStatus = order.data?.status;
  useEffect(() => {
    if (waiting && confirmedStatus && confirmedStatus !== 'PENDING_PAYMENT') setWaiting(false);
  }, [waiting, confirmedStatus]);

  if (order.isLoading) return <LoadingView />;
  if (!order.data)
    return <ErrorView message="Commande introuvable" onRetry={() => order.refetch()} />;
  const o: OrderDto = order.data;
  const isBuyer = o.role === 'BUYER';
  const isSeller = o.role === 'SELLER';
  const can = (s: string) => o.allowedTransitions.includes(s as OrderDto['status']);

  async function run(label: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(label);
    try {
      await fn();
      await order.refetch();
      void qc.invalidateQueries({ queryKey: ['orders'] });
      if (success) Alert.alert(success);
    } catch (e) {
      Alert.alert(
        'Action impossible',
        e instanceof ApiError || e instanceof Error ? e.message : 'Réessayez plus tard.',
      );
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body?: unknown) => api.request(path, { method: 'POST', body });

  async function resumePayment() {
    await run('pay', async () => {
      const session = await api.request<CheckoutSession>(`/orders/${o.id}/payment`);
      const init = await initPaymentSheet({
        merchantDisplayName: 'SnapMarket',
        paymentIntentClientSecret: session.paymentClientSecret,
        returnURL: 'snapmarket://stripe-redirect',
      });
      if (init.error) throw new Error(init.error.message);
      const res = await presentPaymentSheet();
      if (res.error) {
        if (res.error.code !== 'Canceled') throw new Error(res.error.message);
        return;
      }
      setWaiting(true);
    });
  }

  async function contact() {
    await run('contact', async () => {
      const otherId = isBuyer ? o.seller.id : o.buyer.id;
      const conv = await api.request<ConversationDto>('/conversations', {
        method: 'POST',
        body: isBuyer ? { productId: o.product.id } : { userId: otherId },
      });
      router.push(`/chat/${conv.id}`);
    });
  }

  function proposeMeetup() {
    const when = parseLocalDateTime(meetDate, meetTime);
    if (!when) return Alert.alert('Rendez-vous', 'Date (JJ/MM/AAAA) ou heure (HH:MM) invalide.');
    if (meetPlace.trim().length < 3) return Alert.alert('Rendez-vous', 'Indiquez un lieu public.');
    void run(
      'meetup',
      () =>
        post(`/orders/${o.id}/meetups`, {
          scheduledAt: when.toISOString(),
          locationLabel: meetPlace.trim(),
        }),
      'Proposition envoyée',
    );
  }

  return (
    <Screen>
      <Header title={`Commande ${o.reference}`} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        {waiting && (
          <Notice tone="primary" text="Paiement en cours de confirmation par le prestataire…" />
        )}
        <Card>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <AppText variant="heading" style={{ flex: 1 }}>
              {o.product.title}
            </AppText>
            <Badge
              label={ORDER_STATUS_LABELS[o.status]}
              tone={
                o.status === 'COMPLETED'
                  ? 'success'
                  : ['CANCELLED', 'REFUNDED', 'DISPUTED'].includes(o.status)
                    ? 'danger'
                    : 'warning'
              }
            />
          </View>
          <AppText color={colors.textSecondary}>
            {isBuyer ? `Vendeur : ${o.seller.username}` : `Acheteur : ${o.buyer.username}`} ·{' '}
            {o.deliveryMode === 'SHIPPING' ? 'Livraison' : 'Remise en main propre'}
          </AppText>
          <Line label="Articles" value={formatCents(o.pricing.itemPriceCents)} />
          {o.deliveryMode === 'SHIPPING' && (
            <Line label="Livraison" value={formatCents(o.pricing.shippingFeeCents)} />
          )}
          <Line
            label="Total payé par l’acheteur"
            value={formatCents(o.pricing.totalCents)}
            strong
          />
          {isSeller && (
            <>
              <Line
                label={`Commission SnapMarket (${o.pricing.commissionBps / 100} %)`}
                value={`− ${formatCents(o.pricing.commissionCents)}`}
              />
              <Line label="Vous recevrez" value={formatCents(o.pricing.sellerPayoutCents)} strong />
              <AppText variant="small" color={colors.textSecondary}>
                Versement après confirmation de réception par l’acheteur. État du versement :{' '}
                {o.transferStatus === 'SUCCEEDED'
                  ? 'effectué'
                  : o.transferStatus === 'PENDING'
                    ? 'en cours'
                    : o.transferStatus === 'FAILED'
                      ? 'en échec (le support est informé)'
                      : 'en attente'}
                .
              </AppText>
            </>
          )}
        </Card>

        {o.shippingAddress && (
          <Card>
            <AppText variant="heading">Adresse de livraison</AppText>
            <AppText>{o.shippingAddress.fullName}</AppText>
            <AppText color={colors.textSecondary}>
              {o.shippingAddress.line1}
              {o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ''} —{' '}
              {o.shippingAddress.postalCode} {o.shippingAddress.city}
            </AppText>
          </Card>
        )}

        {o.shipment && (
          <Card>
            <AppText variant="heading">Expédition</AppText>
            <AppText>Transporteur : {o.shipment.carrier ?? 'non précisé par le vendeur'}</AppText>
            <AppText>
              Suivi : {o.shipment.trackingNumber ?? 'aucun numéro fourni par le vendeur'}
            </AppText>
            {o.shipment.trackingUrl && (
              <Button
                title="Suivre le colis"
                variant="ghost"
                onPress={() => Linking.openURL(o.shipment!.trackingUrl!)}
              />
            )}
          </Card>
        )}

        {/* --- Acheteur --- */}
        {isBuyer && o.status === 'PENDING_PAYMENT' && !waiting && (
          <>
            {STRIPE_PUBLISHABLE_KEY ? (
              <Button
                title="Finaliser le paiement"
                onPress={resumePayment}
                loading={busy === 'pay'}
              />
            ) : (
              <Notice
                text="Paiement indisponible dans cette version de l’application."
                tone="danger"
              />
            )}
            <Button
              title="Annuler la commande"
              variant="ghost"
              loading={busy === 'cancel'}
              onPress={() => run('cancel', () => post(`/orders/${o.id}/cancel`, {}))}
            />
          </>
        )}
        {isBuyer && can('COMPLETED') && (
          <Button
            title={
              o.deliveryMode === 'SHIPPING'
                ? 'Confirmer la réception'
                : 'Confirmer la remise en main propre'
            }
            loading={busy === 'confirm'}
            onPress={() =>
              Alert.alert(
                'Confirmer ?',
                'Le vendeur sera payé. Ne confirmez qu’après avoir reçu et vérifié l’article.',
                [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Confirmer',
                    onPress: () =>
                      run(
                        'confirm',
                        () => post(`/orders/${o.id}/confirm`),
                        'Merci ! La transaction est terminée.',
                      ),
                  },
                ],
              )
            }
          />
        )}
        {isBuyer && can('DISPUTED') && (
          <Card>
            <AppText variant="heading">Un problème ?</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {DISPUTE_REASONS.map((r) => (
                <Chip
                  key={r.value}
                  label={r.label}
                  selected={disputeReason === r.value}
                  onPress={() => setDisputeReason(r.value)}
                />
              ))}
            </View>
            <TextField
              label="Détails"
              value={disputeDetails}
              onChangeText={setDisputeDetails}
              multiline
              maxLength={2000}
            />
            <Button
              title="Ouvrir un litige"
              variant="danger"
              disabled={!disputeReason}
              loading={busy === 'dispute'}
              onPress={() =>
                run(
                  'dispute',
                  () =>
                    post(`/orders/${o.id}/dispute`, {
                      reason: disputeReason,
                      details: disputeDetails || undefined,
                    }),
                  'Litige ouvert : notre équipe va l’examiner.',
                )
              }
            />
          </Card>
        )}

        {/* --- Vendeur --- */}
        {isSeller && can('PREPARING') && (
          <Button
            title="Je prépare la commande"
            loading={busy === 'prep'}
            onPress={() => run('prep', () => post(`/orders/${o.id}/preparing`))}
          />
        )}
        {isSeller && can('SHIPPED') && (
          <Card>
            <AppText variant="heading">Déclarer l’expédition</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Aucun transporteur n’est intégré à SnapMarket pour le moment : expédiez avec le
              transporteur de votre choix et indiquez le numéro de suivi qu’il vous a fourni.
              SnapMarket ne génère pas d’étiquette.
            </AppText>
            <TextField
              label="Transporteur"
              value={carrier}
              onChangeText={setCarrier}
              maxLength={60}
            />
            <TextField
              label="Numéro de suivi"
              value={tracking}
              onChangeText={setTracking}
              autoCapitalize="characters"
              maxLength={40}
            />
            <Button
              title="Marquer comme expédiée"
              loading={busy === 'ship'}
              onPress={() =>
                run('ship', () =>
                  post(`/orders/${o.id}/ship`, {
                    carrier: carrier || undefined,
                    trackingNumber: tracking || undefined,
                  }),
                )
              }
            />
          </Card>
        )}
        {isSeller && can('REFUNDED') && (
          <Button
            title="Annuler et rembourser l’acheteur"
            variant="ghost"
            loading={busy === 'refund'}
            onPress={() =>
              Alert.alert('Annuler la vente ?', 'L’acheteur sera intégralement remboursé.', [
                { text: 'Retour', style: 'cancel' },
                {
                  text: 'Annuler la vente',
                  style: 'destructive',
                  onPress: () =>
                    run('refund', () =>
                      post(`/orders/${o.id}/cancel`, { reason: 'Annulation par le vendeur' }),
                    ),
                },
              ])
            }
          />
        )}

        {/* --- Remise en main propre --- */}
        {o.deliveryMode === 'MEETUP' && ['PAID', 'READY_FOR_HANDOFF'].includes(o.status) && (
          <Card>
            <AppText variant="heading">Rendez-vous</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Choisissez un lieu public. Aucune position n’est partagée automatiquement.
            </AppText>
            {o.meetups
              .filter((m) => m.status !== 'CANCELLED')
              .slice(0, 3)
              .map((m: MeetupDto) => (
                <View key={m.id} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
                  <AppText variant="bodyStrong">
                    {formatDateTime(m.scheduledAt)} — {m.locationLabel}
                  </AppText>
                  <AppText variant="caption" color={colors.textSecondary}>
                    {m.status === 'PROPOSED'
                      ? m.proposedById === me?.id
                        ? 'En attente de réponse'
                        : 'Proposé par l’autre participant'
                      : m.status === 'ACCEPTED'
                        ? 'Confirmé'
                        : m.status === 'DECLINED'
                          ? 'Refusé'
                          : m.status}
                  </AppText>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    {m.status === 'PROPOSED' && m.proposedById !== me?.id && (
                      <>
                        <Button
                          title="Accepter"
                          loading={busy === `acc-${m.id}`}
                          onPress={() => run(`acc-${m.id}`, () => post(`/meetups/${m.id}/accept`))}
                        />
                        <Button
                          title="Refuser"
                          variant="ghost"
                          onPress={() => run(`dec-${m.id}`, () => post(`/meetups/${m.id}/decline`))}
                        />
                      </>
                    )}
                    {(m.status === 'PROPOSED' || m.status === 'ACCEPTED') && (
                      <Button
                        title="Annuler"
                        variant="ghost"
                        onPress={() => run(`can-${m.id}`, () => post(`/meetups/${m.id}/cancel`))}
                      />
                    )}
                  </View>
                </View>
              ))}
            {o.status === 'PAID' && (
              <>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Date (JJ/MM/AAAA)"
                      value={meetDate}
                      onChangeText={setMeetDate}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="Heure (HH:MM)"
                      value={meetTime}
                      onChangeText={setMeetTime}
                      keyboardType="numbers-and-punctuation"
                    />
                  </View>
                </View>
                <TextField
                  label="Lieu (public)"
                  value={meetPlace}
                  onChangeText={setMeetPlace}
                  maxLength={200}
                />
                <Button
                  title="Proposer ce rendez-vous"
                  variant="secondary"
                  loading={busy === 'meetup'}
                  onPress={proposeMeetup}
                />
              </>
            )}
          </Card>
        )}

        {/* --- Avis --- */}
        {o.canReview && (
          <Card>
            <AppText variant="heading">
              Laisser un avis sur {isBuyer ? o.seller.username : o.buyer.username}
            </AppText>
            <View
              style={{ flexDirection: 'row', gap: spacing.sm }}
              accessibilityRole="adjustable"
              accessibilityLabel={`Note : ${rating} sur 5`}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setRating(n)}
                  accessibilityLabel={`${n} étoile${n > 1 ? 's' : ''}`}
                  hitSlop={6}
                >
                  <Ionicons
                    name={n <= rating ? 'star' : 'star-outline'}
                    size={32}
                    color={colors.warning}
                  />
                </Pressable>
              ))}
            </View>
            <TextField
              label="Commentaire (facultatif)"
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={1000}
            />
            <Button
              title="Publier l’avis"
              disabled={rating === 0}
              loading={busy === 'review'}
              onPress={() =>
                run(
                  'review',
                  () => post(`/orders/${o.id}/reviews`, { rating, comment: comment || undefined }),
                  'Merci pour votre avis',
                )
              }
            />
          </Card>
        )}

        {o.dispute && (
          <Notice
            text={`Litige : ${o.dispute.status === 'OPEN' ? 'en cours d’examen par l’équipe SnapMarket' : 'résolu'}`}
            tone={o.dispute.status === 'OPEN' ? 'warning' : 'primary'}
          />
        )}

        <Button
          title={isBuyer ? 'Contacter le vendeur' : 'Contacter l’acheteur'}
          variant="ghost"
          icon="chatbubble-outline"
          onPress={contact}
          loading={busy === 'contact'}
        />

        <Card>
          <AppText variant="heading">Historique</AppText>
          {o.history.map((h, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
              <AppText variant="caption" color={colors.textSecondary} style={{ width: 130 }}>
                {formatDateTime(h.createdAt)}
              </AppText>
              <AppText variant="caption" style={{ flex: 1 }}>
                {ORDER_STATUS_LABELS[h.to]}
                {h.note ? ` — ${h.note}` : ''}
              </AppText>
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <AppText
        variant={strong ? 'bodyStrong' : 'body'}
        color={strong ? colors.text : colors.textSecondary}
        style={{ flex: 1 }}
      >
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'body'}>{value}</AppText>
    </View>
  );
}

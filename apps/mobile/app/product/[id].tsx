import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ConversationDto,
  DELIVERY_MODE_LABELS,
  formatCents,
  OfferDto,
  parseEurosToCents,
  PRODUCT_CONDITION_LABELS,
  ProductDetail,
} from '@snapmarket/shared';
import { ReportModal } from '../../src/components/ReportModal';
import {
  AppText,
  Avatar,
  Badge,
  Button,
  Card,
  ErrorView,
  LoadingView,
  Notice,
  Rating,
  TextField,
} from '../../src/components/ui';
import {
  keys,
  useCartItem,
  useOffers,
  useProduct,
  useToggleFavorite,
} from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { colors, MIN_TOUCH, radius, spacing } from '../../src/theme/tokens';
import { relativeTime } from '../../src/utils/format';

function OwnerActions({ product }: { product: ProductDetail }) {
  const qc = useQueryClient();
  const offers = useOffers('seller', product.id);
  const pending = offers.data?.filter((o) => o.status === 'PENDING') ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.product(product.id) });
    void qc.invalidateQueries({ queryKey: ['myProducts'] });
    void qc.invalidateQueries({ queryKey: keys.offers('seller', product.id) });
  };
  const act = async (path: string, method: 'POST' | 'DELETE' = 'POST', done?: () => void) => {
    try {
      await api.request(path, { method });
      refresh();
      done?.();
    } catch (e) {
      Alert.alert('Action impossible', e instanceof ApiError ? e.message : 'Réessayez plus tard.');
    }
  };
  return (
    <View style={{ gap: spacing.sm }}>
      {product.moderationStatus !== 'VISIBLE' && (
        <Notice text="Cette annonce n’est pas visible publiquement (vérification ou modération en cours)." />
      )}
      <Button
        title="Modifier"
        icon="create-outline"
        variant="secondary"
        onPress={() => router.push(`/edit-product/${product.id}`)}
        disabled={product.status === 'SOLD'}
      />
      {(product.status === 'DRAFT' || product.status === 'ARCHIVED') && (
        <Button title="Publier" onPress={() => act(`/products/${product.id}/publish`)} />
      )}
      {(product.status === 'ACTIVE' || product.status === 'DRAFT') && (
        <Button
          title="Archiver"
          variant="ghost"
          onPress={() => act(`/products/${product.id}/archive`)}
        />
      )}
      <Button
        title="Supprimer"
        variant="danger"
        onPress={() =>
          Alert.alert('Supprimer l’annonce ?', 'Cette action est définitive.', [
            { text: 'Annuler', style: 'cancel' },
            {
              text: 'Supprimer',
              style: 'destructive',
              onPress: () => act(`/products/${product.id}`, 'DELETE', () => router.back()),
            },
          ])
        }
      />
      {pending.length > 0 && <AppText variant="heading">Offres reçues</AppText>}
      {pending.map((o: OfferDto) => (
        <Card key={o.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            {formatCents(o.amountCents)}
          </AppText>
          <Button title="Refuser" variant="ghost" onPress={() => act(`/offers/${o.id}/decline`)} />
          <Button title="Accepter" onPress={() => act(`/offers/${o.id}/accept`)} />
        </Card>
      ))}
    </View>
  );
}

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const product = useProduct(id);
  const toggleFav = useToggleFavorite();
  const addToCart = useCartItem();
  const myOffers = useOffers('buyer', id);
  const [page, setPage] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerAmount, setOfferAmount] = useState('');
  const [busy, setBusy] = useState(false);

  if (product.isLoading) return <LoadingView />;
  if (!product.data)
    return (
      <ErrorView
        message={(product.error as Error)?.message ?? 'Annonce introuvable'}
        onRetry={() => product.refetch()}
      />
    );
  const p = product.data;
  const acceptedOffer = myOffers.data?.find(
    (o) => o.status === 'ACCEPTED' && (!o.expiresAt || new Date(o.expiresAt) > new Date()),
  );
  const pendingOffer = myOffers.data?.find((o) => o.status === 'PENDING');

  async function contact() {
    setBusy(true);
    try {
      const conv = await api.request<ConversationDto>('/conversations', {
        method: 'POST',
        body: { productId: p.id },
      });
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      Alert.alert('Contact impossible', e instanceof ApiError ? e.message : 'Réessayez plus tard.');
    } finally {
      setBusy(false);
    }
  }

  async function sendOffer() {
    const cents = parseEurosToCents(offerAmount);
    if (!cents) return Alert.alert('Offre', 'Montant invalide');
    setBusy(true);
    try {
      await api.request('/offers', {
        method: 'POST',
        body: { productId: p.id, amountCents: cents },
      });
      setOfferOpen(false);
      setOfferAmount('');
      void qc.invalidateQueries({ queryKey: keys.offers('buyer', p.id) });
      Alert.alert('Offre envoyée', 'Le vendeur a été notifié.');
    } catch (e) {
      Alert.alert('Offre impossible', e instanceof ApiError ? e.message : 'Réessayez plus tard.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View>
          {p.media.length > 0 ? (
            <FlatList
              data={p.media}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(m) => m.id}
              onMomentumScrollEnd={(e) =>
                setPage(Math.round(e.nativeEvent.contentOffset.x / width))
              }
              renderItem={({ item }) => (
                <Image
                  source={{ uri: item.url ?? undefined }}
                  style={{ width, height: width * 1.2 }}
                  contentFit="cover"
                  accessibilityLabel={p.title}
                />
              )}
            />
          ) : (
            <View style={[styles.noImage, { width, height: width * 0.8 }]}>
              <Ionicons name="image-outline" size={48} color={colors.textMuted} />
            </View>
          )}
          {p.media.length > 1 && (
            <View style={styles.dots}>
              {p.media.map((m, i) => (
                <View
                  key={m.id}
                  style={[styles.dot, i === page && { backgroundColor: colors.text }]}
                />
              ))}
            </View>
          )}
          <SafeAreaView edges={['top']} style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retour"
              onPress={() => router.back()}
              style={styles.round}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {!p.isOwner && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Signaler l’annonce"
                  onPress={() => setReportOpen(true)}
                  style={styles.round}
                >
                  <Ionicons name="flag-outline" size={20} color={colors.text} />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={p.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                onPress={() => toggleFav.mutate({ productId: p.id, favorite: !p.isFavorite })}
                style={styles.round}
              >
                <Ionicons
                  name={p.isFavorite ? 'heart' : 'heart-outline'}
                  size={20}
                  color={p.isFavorite ? colors.danger : colors.text}
                />
              </Pressable>
            </View>
          </SafeAreaView>
        </View>

        <View style={styles.content}>
          <View style={{ gap: spacing.xs }}>
            <AppText variant="display">{formatCents(p.priceCents)}</AppText>
            <AppText variant="title">{p.title}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <Badge label={PRODUCT_CONDITION_LABELS[p.condition]} tone="primary" />
              {p.brand && <Badge label={p.brand} />}
              <Badge label={p.category.name} />
              {p.status === 'RESERVED' && <Badge label="Réservé" tone="warning" />}
              {p.status === 'SOLD' && <Badge label="Vendu" tone="danger" />}
              {p.status === 'DRAFT' && <Badge label="Brouillon" tone="warning" />}
            </View>
          </View>

          <AppText>{p.description || 'Aucune description.'}</AppText>

          <Card>
            <Row
              icon="cube-outline"
              text={
                p.availableQuantity > 0 ? `${p.availableQuantity} disponible(s)` : 'Plus disponible'
              }
            />
            {p.deliveryModes.includes('SHIPPING') && (
              <Row
                icon="airplane-outline"
                text={`${DELIVERY_MODE_LABELS.SHIPPING} : ${p.shippingFeeCents !== null ? formatCents(p.shippingFeeCents) : 'frais non communiqués'}`}
              />
            )}
            {p.deliveryModes.includes('MEETUP') && (
              <Row
                icon="people-outline"
                text={`${DELIVERY_MODE_LABELS.MEETUP}${p.city ? ` — ${p.city}` : ''}`}
              />
            )}
            <Row icon="time-outline" text={`Publiée ${relativeTime(p.createdAt)}`} />
          </Card>

          <Pressable accessibilityRole="button" onPress={() => router.push(`/user/${p.seller.id}`)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar uri={p.seller.avatarUrl} size={48} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  <AppText variant="bodyStrong">
                    {p.seller.displayName ?? p.seller.username}
                  </AppText>
                  {p.seller.proVerified && <Badge label="Pro vérifié" tone="success" />}
                </View>
                <Rating {...p.seller.rating} />
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Card>
          </Pressable>

          {p.isOwner ? (
            <OwnerActions product={p} />
          ) : (
            <>
              {!p.purchase.available && p.purchase.reason && <Notice text={p.purchase.reason} />}
              {pendingOffer && (
                <Notice
                  tone="primary"
                  text={`Offre en attente : ${formatCents(pendingOffer.amountCents)}`}
                />
              )}
              {acceptedOffer && (
                <Notice
                  tone="primary"
                  text={`Offre acceptée : ${formatCents(acceptedOffer.amountCents)} — payez avant expiration.`}
                />
              )}
            </>
          )}
        </View>
      </ScrollView>

      {!p.isOwner && (
        <SafeAreaView edges={['bottom']} style={styles.actions}>
          {p.purchase.available && !acceptedOffer && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ajouter au panier"
              disabled={addToCart.isPending}
              onPress={() =>
                addToCart.mutate(
                  { productId: p.id, quantity: 1 },
                  {
                    onSuccess: () =>
                      Alert.alert('Ajouté au panier', undefined, [
                        { text: 'Continuer', style: 'cancel' },
                        { text: 'Voir le panier', onPress: () => router.push('/cart') },
                      ]),
                    onError: (e) =>
                      Alert.alert('Panier', e instanceof ApiError ? e.message : 'Ajout impossible'),
                  },
                )
              }
              style={styles.cartBtn}
            >
              <Ionicons name="bag-add-outline" size={22} color={colors.text} />
            </Pressable>
          )}
          <Button
            title="Contacter"
            variant="secondary"
            icon="chatbubble-outline"
            onPress={contact}
            loading={busy}
            style={{ flex: 1 }}
          />
          {p.offersEnabled && !acceptedOffer && (
            <Button
              title="Offre"
              variant="ghost"
              onPress={() => setOfferOpen(true)}
              disabled={!!pendingOffer || p.status !== 'ACTIVE'}
              style={{ flex: 1 }}
            />
          )}
          <Button
            title={acceptedOffer ? `Acheter ${formatCents(acceptedOffer.amountCents)}` : 'Acheter'}
            onPress={() =>
              router.push({
                pathname: '/checkout/[id]',
                params: { id: p.id, offerId: acceptedOffer?.id ?? '' },
              })
            }
            disabled={!p.purchase.available}
            accessibilityHint={p.purchase.reason ?? undefined}
            style={{ flex: 1.2 }}
          />
        </SafeAreaView>
      )}

      <ReportModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="PRODUCT"
        targetId={p.id}
      />
      <Modal
        visible={offerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOfferOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: colors.overlay }}
          onPress={() => setOfferOpen(false)}
        />
        <View style={styles.sheet}>
          <AppText variant="heading">Faire une offre</AppText>
          <AppText color={colors.textSecondary}>Prix affiché : {formatCents(p.priceCents)}</AppText>
          <TextField
            label="Votre offre (€)"
            value={offerAmount}
            onChangeText={setOfferAmount}
            keyboardType="decimal-pad"
            autoFocus
          />
          <Button title="Envoyer l’offre" onPress={sendOffer} loading={busy} />
        </View>
      </Modal>
    </View>
  );
}

function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Ionicons name={icon} size={18} color={colors.primaryLight} />
      <AppText style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  noImage: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  dots: {
    position: 'absolute',
    bottom: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  round: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: spacing.lg, gap: spacing.lg },
  actions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cartBtn: {
    width: MIN_TOUCH + 4,
    minHeight: MIN_TOUCH + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
});

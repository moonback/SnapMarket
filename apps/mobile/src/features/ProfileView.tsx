import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ProductSummary, PublicUser } from '@snapmarket/shared';
import { ProductCard } from '../components/ProductCard';
import { AppText, Avatar, Badge, Card, Chip, EmptyView, Rating } from '../components/ui';
import { useReviews, useSoldProducts } from '../hooks/queries';
import { colors, spacing } from '../theme/tokens';
import { memberSince, relativeTime } from '../utils/format';

/** Profil (public ou personnel) : identité, évaluations, annonces actives, ventes, avis. */
export function ProfileView({
  user,
  active,
  header,
  footer,
}: {
  user: PublicUser;
  active: ProductSummary[];
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<'active' | 'sold' | 'reviews'>('active');
  const sold = useSoldProducts(user.id);
  const reviews = useReviews(user.id);
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2;
  const products = tab === 'active' ? active : (sold.data ?? []);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      {header}
      <View style={styles.identity}>
        <Avatar uri={user.avatarUrl} size={84} label={`Photo de ${user.username}`} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <AppText variant="title">{user.displayName ?? user.username}</AppText>
          <AppText color={colors.textSecondary}>@{user.username}</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {user.proVerified ? (
              <Badge label="Professionnel vérifié" tone="success" />
            ) : user.accountType === 'PROFESSIONAL' ? (
              <Badge label="Professionnel (vérification en cours)" />
            ) : null}
          </View>
          <Rating {...user.rating} />
          <AppText variant="caption" color={colors.textSecondary}>
            {memberSince(user.createdAt)}
            {user.city ? ` · ${user.city}` : ''}
          </AppText>
        </View>
        {user.bio ? <AppText style={{ textAlign: 'center' }}>{user.bio}</AppText> : null}
        <View style={styles.stats}>
          <Stat value={user.activeListingsCount} label="Annonces" />
          <Stat value={user.soldCount} label="Ventes" />
          <Stat value={user.rating.count} label="Avis" />
        </View>
      </View>
      {footer}
      <View style={styles.tabs}>
        <Chip
          label="Annonces actives"
          selected={tab === 'active'}
          onPress={() => setTab('active')}
        />
        <Chip label="Vendus" selected={tab === 'sold'} onPress={() => setTab('sold')} />
        <Chip label="Avis" selected={tab === 'reviews'} onPress={() => setTab('reviews')} />
      </View>
      {tab === 'reviews' ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {(reviews.data?.items ?? []).length === 0 ? (
            <EmptyView icon="star-outline" title="Aucun avis pour le moment" />
          ) : null}
          {reviews.data?.items.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="bodyStrong">{r.author.username}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {relativeTime(r.createdAt)}
                </AppText>
              </View>
              <AppText color={colors.warning}>
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </AppText>
              {r.comment ? <AppText>{r.comment}</AppText> : null}
            </Card>
          ))}
        </View>
      ) : products.length === 0 ? (
        <EmptyView
          icon="pricetag-outline"
          title={tab === 'active' ? 'Aucune annonce active' : 'Aucun article vendu'}
        />
      ) : (
        <FlatList
          scrollEnabled={false}
          data={products}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap: spacing.md }}
          renderItem={({ item }) => <ProductCard product={item} width={cardWidth} />}
        />
      )}
    </ScrollView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <AppText variant="heading">{value}</AppText>
      <AppText variant="caption" color={colors.textSecondary}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    alignSelf: 'stretch',
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatCents, PRODUCT_CONDITION_LABELS, ProductSummary } from '@snapmarket/shared';
import { useToggleFavorite } from '../hooks/queries';
import { colors, radius, spacing } from '../theme/tokens';
import { AppText } from './ui';

export function ProductCard({ product, width }: { product: ProductSummary; width: number }) {
  const toggle = useToggleFavorite();
  const cover = product.cover?.thumbnailUrl ?? product.cover?.url;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${formatCents(product.priceCents)}`}
      onPress={() => router.push(`/product/${product.id}`)}
      style={[styles.card, { width }]}
    >
      <View style={[styles.imageWrap, { height: width * 1.25 }]}>
        {cover ? (
          <Image
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="image-outline" size={28} color={colors.textMuted} />
          </View>
        )}
        {product.status === 'RESERVED' && (
          <View style={styles.reserved}>
            <AppText variant="small">Réservé</AppText>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={product.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onPress={() => toggle.mutate({ productId: product.id, favorite: !product.isFavorite })}
          style={styles.fav}
          hitSlop={8}
        >
          <Ionicons
            name={product.isFavorite ? 'heart' : 'heart-outline'}
            size={20}
            color={product.isFavorite ? colors.danger : colors.text}
          />
        </Pressable>
      </View>
      <View style={{ padding: spacing.sm, gap: 2 }}>
        <AppText variant="bodyStrong">{formatCents(product.priceCents)}</AppText>
        <AppText variant="caption" numberOfLines={1}>
          {product.title}
        </AppText>
        <AppText variant="small" color={colors.textSecondary} numberOfLines={1}>
          {[product.brand, PRODUCT_CONDITION_LABELS[product.condition]].filter(Boolean).join(' · ')}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  imageWrap: { backgroundColor: colors.surfaceRaised },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fav: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    padding: 6,
  },
  reserved: {
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    backgroundColor: colors.warning,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});

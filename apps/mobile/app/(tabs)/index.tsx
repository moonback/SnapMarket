import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { FiltersModal } from '../../src/components/FiltersModal';
import { ProductCard } from '../../src/components/ProductCard';
import { StoriesBar } from '../../src/components/StoriesBar';
import { AppText, Chip, EmptyView, ErrorView, LoadingView, Screen } from '../../src/components/ui';
import { FeedFilters, flatten, useCart, useCategories, useFeed } from '../../src/hooks/queries';
import { colors, MIN_TOUCH, radius, spacing } from '../../src/theme/tokens';

export default function Discover() {
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FeedFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const categories = useCategories();
  const cart = useCart();
  const cartCount = cart.data?.items.length ?? 0;
  const feed = useFeed(filters);
  const items = useMemo(() => flatten(feed.data), [feed.data]);
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2;
  const activeFilters = [
    filters.minPriceCents,
    filters.maxPriceCents,
    filters.deliveryMode,
    filters.department,
    filters.conditions?.length,
    filters.sort && filters.sort !== 'for_you',
  ].filter(Boolean).length;

  return (
    <Screen>
      <View style={styles.top}>
        <AppText variant="title">Découvrir</AppText>
        <View style={{ flexDirection: 'row' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Panier${cartCount ? `, ${cartCount} articles` : ''}`}
            onPress={() => router.push('/cart')}
            style={styles.iconBtn}
          >
            <Ionicons name="bag-outline" size={24} color={colors.text} />
            {cartCount > 0 && (
              <View style={styles.badge}>
                <AppText variant="small">{cartCount}</AppText>
              </View>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => router.push('/notifications')}
            style={styles.iconBtn}
          >
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => setFilters({ ...filters, q: search.trim() || undefined })}
            placeholder="Rechercher un article, une marque…"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="Recherche"
          />
          {search ? (
            <Pressable
              accessibilityLabel="Effacer la recherche"
              onPress={() => {
                setSearch('');
                setFilters({ ...filters, q: undefined });
              }}
            >
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Filtres${activeFilters ? `, ${activeFilters} actifs` : ''}`}
          onPress={() => setShowFilters(true)}
          style={[styles.filterBtn, activeFilters > 0 && { backgroundColor: colors.primary }]}
        >
          <Ionicons name="options-outline" size={20} color={colors.text} />
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
        renderItem={({ item }) => <ProductCard product={item} width={cardWidth} />}
        onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => feed.refetch()}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
            <StoriesBar />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}
            >
              <Chip
                label="Tout"
                selected={!filters.categoryId}
                onPress={() => setFilters({ ...filters, categoryId: undefined })}
              />
              {categories.data?.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  selected={filters.categoryId === c.id}
                  onPress={() => setFilters({ ...filters, categoryId: c.id })}
                />
              ))}
            </ScrollView>
          </View>
        }
        ListEmptyComponent={
          feed.isLoading ? (
            <LoadingView />
          ) : feed.isError ? (
            <ErrorView message={(feed.error as Error).message} onRetry={() => feed.refetch()} />
          ) : (
            <EmptyView
              icon="search-outline"
              title="Aucun article trouvé"
              subtitle="Modifiez votre recherche ou vos filtres."
            />
          )
        }
        ListFooterComponent={feed.isFetchingNextPage ? <LoadingView /> : null}
      />
      {showFilters && (
        <FiltersModal
          visible
          value={filters}
          onClose={() => setShowFilters(false)}
          onApply={(f) => {
            setFilters(f);
            setShowFilters(false);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  filterBtn: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

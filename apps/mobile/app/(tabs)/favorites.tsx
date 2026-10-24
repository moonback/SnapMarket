import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, RefreshControl, useWindowDimensions } from 'react-native';
import { ProductCard } from '../../src/components/ProductCard';
import {
  AppText,
  Button,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
} from '../../src/components/ui';
import { flatten, useFavorites } from '../../src/hooks/queries';
import { colors, spacing } from '../../src/theme/tokens';

export default function Favorites() {
  const { width } = useWindowDimensions();
  const favorites = useFavorites();
  const items = useMemo(() => flatten(favorites.data), [favorites.data]);
  const cardWidth = (width - spacing.lg * 2 - spacing.md) / 2;
  return (
    <Screen>
      <AppText variant="title" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        Favoris
      </AppText>
      <AppText
        variant="caption"
        color={colors.textSecondary}
        style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}
      >
        Vos favoris sont privés : vous seul pouvez les voir.
      </AppText>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 }}
        renderItem={({ item }) => <ProductCard product={item} width={cardWidth} />}
        onEndReached={() => favorites.hasNextPage && favorites.fetchNextPage()}
        refreshControl={
          <RefreshControl
            refreshing={favorites.isRefetching}
            onRefresh={() => favorites.refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          favorites.isLoading ? (
            <LoadingView />
          ) : favorites.isError ? (
            <ErrorView
              message={(favorites.error as Error).message}
              onRetry={() => favorites.refetch()}
            />
          ) : (
            <EmptyView
              icon="heart-outline"
              title="Aucun favori"
              subtitle="Touchez le cœur d’un article pour le retrouver ici."
              action={
                <Button
                  title="Découvrir des articles"
                  variant="secondary"
                  onPress={() => router.navigate('/(tabs)')}
                />
              }
            />
          )
        }
      />
    </Screen>
  );
}

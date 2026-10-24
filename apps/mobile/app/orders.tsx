import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { formatCents, ORDER_STATUS_LABELS } from '@snapmarket/shared';
import {
  AppText,
  Badge,
  Chip,
  EmptyView,
  ErrorView,
  Header,
  LoadingView,
  Screen,
} from '../src/components/ui';
import { flatten, useOrders } from '../src/hooks/queries';
import { colors, spacing } from '../src/theme/tokens';
import { relativeTime } from '../src/utils/format';

export default function Orders() {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const orders = useOrders(role);
  const items = useMemo(() => flatten(orders.data), [orders.data]);
  return (
    <Screen>
      <Header title="Achats et ventes" onBack={() => router.back()} />
      <View
        style={{
          flexDirection: 'row',
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
        }}
      >
        <Chip label="Mes achats" selected={role === 'buyer'} onPress={() => setRole('buyer')} />
        <Chip label="Mes ventes" selected={role === 'seller'} onPress={() => setRole('seller')} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
        onEndReached={() => orders.hasNextPage && orders.fetchNextPage()}
        refreshControl={
          <RefreshControl
            refreshing={orders.isRefetching}
            onRefresh={() => orders.refetch()}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/order/${item.id}`)}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: spacing.md,
              gap: 4,
            }}
          >
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}
            >
              <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {item.product.title}
              </AppText>
              <AppText variant="bodyStrong">{formatCents(item.pricing.totalCents)}</AppText>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Badge
                label={ORDER_STATUS_LABELS[item.status]}
                tone={
                  item.status === 'COMPLETED'
                    ? 'success'
                    : ['CANCELLED', 'REFUNDED', 'DISPUTED'].includes(item.status)
                      ? 'danger'
                      : 'warning'
                }
              />
              <AppText variant="caption" color={colors.textSecondary}>
                {item.reference} · {relativeTime(item.createdAt)}
              </AppText>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          orders.isLoading ? (
            <LoadingView />
          ) : orders.isError ? (
            <ErrorView message={(orders.error as Error).message} onRetry={() => orders.refetch()} />
          ) : (
            <EmptyView
              icon="receipt-outline"
              title={role === 'buyer' ? 'Aucun achat' : 'Aucune vente'}
            />
          )
        }
      />
    </Screen>
  );
}

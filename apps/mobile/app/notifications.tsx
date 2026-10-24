import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { NotificationDto } from '@snapmarket/shared';
import { AppText, EmptyView, ErrorView, Header, LoadingView, Screen } from '../src/components/ui';
import { flatten, useNotifications } from '../src/hooks/queries';
import { api } from '../src/services/api';
import { colors, spacing } from '../src/theme/tokens';
import { relativeTime } from '../src/utils/format';

const ICONS: Record<NotificationDto['type'], keyof typeof Ionicons.glyphMap> = {
  NEW_MESSAGE: 'chatbubble-outline',
  ORDER_UPDATE: 'receipt-outline',
  OFFER_UPDATE: 'pricetag-outline',
  MEETUP_UPDATE: 'calendar-outline',
  REVIEW_RECEIVED: 'star-outline',
  MODERATION: 'shield-outline',
  SYSTEM: 'information-circle-outline',
};

function target(n: NotificationDto): string | null {
  if (n.data?.orderId) return `/order/${n.data.orderId}`;
  if (n.data?.conversationId) return `/chat/${n.data.conversationId}`;
  if (n.data?.productId) return `/product/${n.data.productId}`;
  return null;
}

export default function Notifications() {
  const notifications = useNotifications();
  const items = useMemo(() => flatten(notifications.data), [notifications.data]);

  async function open(n: NotificationDto) {
    if (!n.readAt)
      await api.request(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    void notifications.refetch();
    const href = target(n);
    if (href) router.push(href as never);
  }

  return (
    <Screen>
      <Header
        title="Notifications"
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tout marquer comme lu"
            hitSlop={8}
            onPress={async () => {
              await api.request('/notifications/read-all', { method: 'POST' });
              void notifications.refetch();
            }}
          >
            <Ionicons name="checkmark-done-outline" size={22} color={colors.text} />
          </Pressable>
        }
      />
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ flexGrow: 1 }}
        onEndReached={() => notifications.hasNextPage && notifications.fetchNextPage()}
        refreshControl={
          <RefreshControl
            refreshing={notifications.isRefetching}
            onRefresh={() => notifications.refetch()}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => open(item)}
            style={{
              flexDirection: 'row',
              gap: spacing.md,
              padding: spacing.lg,
              backgroundColor: item.readAt ? 'transparent' : colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Ionicons name={ICONS[item.type]} size={22} color={colors.primaryLight} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong">{item.title}</AppText>
              <AppText color={colors.textSecondary}>{item.body}</AppText>
              <AppText variant="small" color={colors.textMuted}>
                {relativeTime(item.createdAt)}
              </AppText>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          notifications.isLoading ? (
            <LoadingView />
          ) : notifications.isError ? (
            <ErrorView
              message={(notifications.error as Error).message}
              onRetry={() => notifications.refetch()}
            />
          ) : (
            <EmptyView icon="notifications-outline" title="Aucune notification" />
          )
        }
      />
    </Screen>
  );
}

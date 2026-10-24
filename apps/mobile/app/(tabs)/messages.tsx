import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import {
  AppText,
  Avatar,
  EmptyView,
  ErrorView,
  LoadingView,
  Screen,
} from '../../src/components/ui';
import { flatten, useConversations } from '../../src/hooks/queries';
import { colors, radius, spacing } from '../../src/theme/tokens';
import { relativeTime } from '../../src/utils/format';

export default function Messages() {
  const conversations = useConversations();
  const items = useMemo(() => flatten(conversations.data), [conversations.data]);
  return (
    <Screen>
      <AppText variant="title" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
        Messages
      </AppText>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ flexGrow: 1 }}
        onEndReached={() => conversations.hasNextPage && conversations.fetchNextPage()}
        refreshControl={
          <RefreshControl
            refreshing={conversations.isRefetching}
            onRefresh={() => conversations.refetch()}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          const last = item.lastMessage;
          const preview = last ? (last.type === 'IMAGE' ? 'Photo' : (last.body ?? '')) : '';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Conversation avec ${item.otherUser.username}${item.unreadCount ? `, ${item.unreadCount} non lus` : ''}`}
              onPress={() => router.push(`/chat/${item.id}`)}
              style={styles.row}
            >
              <Avatar uri={item.otherUser.avatarUrl} size={52} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                    {item.otherUser.displayName ?? item.otherUser.username}
                  </AppText>
                  <AppText variant="small" color={colors.textSecondary}>
                    {relativeTime(item.updatedAt)}
                  </AppText>
                </View>
                {item.product && (
                  <AppText variant="small" color={colors.primaryLight} numberOfLines={1}>
                    {item.product.title}
                  </AppText>
                )}
                <AppText
                  variant="caption"
                  numberOfLines={1}
                  color={item.unreadCount ? colors.text : colors.textSecondary}
                >
                  {item.blocked ? 'Utilisateur bloqué' : preview}
                </AppText>
              </View>
              {item.product?.cover?.thumbnailUrl && (
                <Image source={{ uri: item.product.cover.thumbnailUrl }} style={styles.thumb} />
              )}
              {item.unreadCount > 0 && (
                <View style={styles.unread}>
                  <AppText variant="small">{item.unreadCount}</AppText>
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          conversations.isLoading ? (
            <LoadingView />
          ) : conversations.isError ? (
            <ErrorView
              message={(conversations.error as Error).message}
              onRetry={() => conversations.refetch()}
            />
          ) : (
            <EmptyView
              icon="chatbubbles-outline"
              title="Aucune conversation"
              subtitle="Contactez un vendeur depuis une annonce pour démarrer."
            />
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  thumb: { width: 44, height: 44, borderRadius: radius.sm },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
});

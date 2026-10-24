import { Ionicons } from '@expo/vector-icons';
import { InfiniteData, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCents, MESSAGE_MAX_LENGTH, MessageDto, Paginated } from '@snapmarket/shared';
import { ReportModal } from '../../src/components/ReportModal';
import { AppText, Avatar, ErrorView, Header, LoadingView, Notice } from '../../src/components/ui';
import { flatten, keys, useConversation, useMessages } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { pickFromLibrary, uploadAsset } from '../../src/services/media';
import { emitWithAck, getSocket } from '../../src/services/socket';
import { useAuth } from '../../src/stores/auth';
import { colors, MIN_TOUCH, radius, spacing } from '../../src/theme/tokens';
import { clientId, formatDateTime } from '../../src/utils/format';

type LocalMessage = MessageDto & { local?: 'sending' | 'failed' };

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const [pending, setPending] = useState<LocalMessage[]>([]);
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const reportMessage = (messageId: string) => setReportTarget(messageId);

  const addToCache = useCallback(
    (m: MessageDto) => {
      qc.setQueryData<InfiniteData<Paginated<MessageDto>>>(keys.messages(id), (data) => {
        if (!data) return data;
        if (data.pages.some((p) => p.items.some((x) => x.id === m.id))) return data;
        const [first, ...rest] = data.pages;
        return { ...data, pages: [{ ...first!, items: [m, ...first!.items] }, ...rest] };
      });
      setPending((prev) =>
        prev.filter((p) => p.clientMessageId !== m.clientMessageId || !m.clientMessageId),
      );
    },
    [id, qc],
  );

  const markRead = useCallback(() => {
    api
      .request(`/conversations/${id}/read`, { method: 'POST' })
      .then(() => {
        void qc.invalidateQueries({ queryKey: keys.unread });
        void qc.invalidateQueries({ queryKey: keys.conversations });
      })
      .catch(() => undefined);
  }, [id, qc]);

  useEffect(() => {
    const socket = getSocket();
    const join = () => void emitWithAck('conversation:join', { conversationId: id });
    join();
    markRead();
    const onMessage = (m: MessageDto) => {
      if (m.conversationId !== id) return;
      addToCache(m);
      if (m.senderId !== me?.id) markRead();
    };
    const onRead = (e: { conversationId: string; userId: string; readAt: string }) => {
      if (e.conversationId === id && e.userId !== me?.id) setOtherReadAt(e.readAt);
    };
    // Après reconnexion : on rejoint la salle et on recharge l'historique.
    const onReconnect = () => {
      join();
      void messages.refetch();
    };
    socket.on('message:new', onMessage);
    socket.on('conversation:read', onRead);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('message:new', onMessage);
      socket.off('conversation:read', onRead);
      socket.io.off('reconnect', onReconnect);
      void emitWithAck('conversation:leave', { conversationId: id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me?.id]);

  async function deliver(local: LocalMessage, payload: { body?: string; mediaId?: string }) {
    setPending((prev) => [
      local,
      ...prev.filter((p) => p.clientMessageId !== local.clientMessageId),
    ]);
    const body = { conversationId: id, clientMessageId: local.clientMessageId, ...payload };
    let ack = await emitWithAck<MessageDto>('message:send', body);
    if (!ack.ok && (ack.status === undefined || ack.status >= 500)) {
      // Repli REST (idempotent grâce à clientMessageId).
      try {
        const m = await api.request<MessageDto>(`/conversations/${id}/messages`, {
          method: 'POST',
          body: { clientMessageId: local.clientMessageId, ...payload },
        });
        ack = { ok: true, data: m };
      } catch (e) {
        ack = { ok: false, error: e instanceof ApiError ? e.message : 'Envoi impossible' };
      }
    }
    if (ack.ok && ack.data) {
      addToCache(ack.data);
    } else {
      setPending((prev) =>
        prev.map((p) =>
          p.clientMessageId === local.clientMessageId ? { ...p, local: 'failed' } : p,
        ),
      );
      if (ack.error) Alert.alert('Message non envoyé', ack.error);
    }
  }

  function localMessage(payload: { body?: string }): LocalMessage {
    return {
      id: `local-${clientId()}`,
      conversationId: id,
      senderId: me?.id ?? null,
      type: 'TEXT',
      body: payload.body ?? null,
      media: null,
      clientMessageId: clientId(),
      createdAt: new Date().toISOString(),
      readByOther: false,
      local: 'sending',
    };
  }

  function send() {
    const body = text.trim();
    if (!body) return;
    setText('');
    void deliver(localMessage({ body }), { body });
  }

  async function sendPhoto() {
    try {
      const [asset] = await pickFromLibrary({ limit: 1 });
      if (!asset) return;
      setUploading(true);
      const media = await uploadAsset(asset, 'MESSAGE');
      await deliver({ ...localMessage({}), type: 'IMAGE' }, { mediaId: media.id });
    } catch (e) {
      Alert.alert('Photo', (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const all = useMemo<LocalMessage[]>(
    () => [...pending, ...flatten(messages.data)],
    [pending, messages.data],
  );
  const conv = conversation.data;

  async function toggleBlock() {
    if (!conv) return;
    try {
      await api.request(`/users/${conv.otherUser.id}/block`, {
        method: conv.blocked ? 'DELETE' : 'POST',
      });
      void conversation.refetch();
      void qc.invalidateQueries({ queryKey: ['feed'] });
    } catch (e) {
      Alert.alert('Action impossible', e instanceof ApiError ? e.message : '');
    }
  }

  function menu() {
    if (!conv) return;
    const options = [
      'Voir le profil',
      'Signaler l’utilisateur',
      conv.blocked ? 'Débloquer' : 'Bloquer',
      'Annuler',
    ];
    const handle = (i: number) => {
      if (i === 0) router.push(`/user/${conv.otherUser.id}`);
      if (i === 1) setReportOpen(true);
      if (i === 2) {
        Alert.alert(
          conv.blocked ? 'Débloquer ?' : 'Bloquer cet utilisateur ?',
          conv.blocked
            ? ''
            : 'Vous ne pourrez plus échanger de messages et ses contenus seront masqués.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Confirmer', style: 'destructive', onPress: toggleBlock },
          ],
        );
      }
    };
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3, destructiveButtonIndex: 2 },
        handle,
      );
    else
      Alert.alert(
        'Options',
        undefined,
        options
          .slice(0, 3)
          .map((o, i) => ({ text: o, onPress: () => handle(i) }))
          .concat([{ text: 'Annuler', onPress: () => undefined }]),
      );
  }

  if (conversation.isLoading) return <LoadingView />;
  if (!conv)
    return <ErrorView message="Conversation introuvable" onRetry={() => conversation.refetch()} />;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title={conv.otherUser.displayName ?? conv.otherUser.username}
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Options"
            onPress={menu}
            hitSlop={8}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
          </Pressable>
        }
      />
      {conv.product && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/product/${conv.product!.id}`)}
          style={styles.productBar}
        >
          {conv.product.cover?.thumbnailUrl ? (
            <Image source={{ uri: conv.product.cover.thumbnailUrl }} style={styles.productThumb} />
          ) : null}
          <View style={{ flex: 1 }}>
            <AppText variant="caption" numberOfLines={1}>
              {conv.product.title}
            </AppText>
            <AppText variant="bodyStrong">{formatCents(conv.product.priceCents)}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={8}
      >
        <FlatList
          inverted
          data={all}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
          onEndReached={() => messages.hasNextPage && messages.fetchNextPage()}
          ListFooterComponent={
            messages.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null
          }
          renderItem={({ item, index }) => {
            if (item.type === 'SYSTEM') {
              return (
                <AppText variant="caption" color={colors.textSecondary} style={styles.system}>
                  {item.body}
                </AppText>
              );
            }
            const mine = item.senderId === me?.id;
            const read =
              item.readByOther || (otherReadAt !== null && item.createdAt <= otherReadAt);
            return (
              <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
                {!mine && index === 0 && <Avatar uri={conv.otherUser.avatarUrl} size={24} />}
                <Pressable
                  onLongPress={() =>
                    !mine &&
                    !item.local &&
                    Alert.alert('Message', undefined, [
                      { text: 'Signaler ce message', onPress: () => reportMessage(item.id) },
                      { text: 'Annuler', style: 'cancel' },
                    ])
                  }
                  style={[styles.bubble, mine ? styles.mine : styles.theirs]}
                >
                  {item.media?.url ? (
                    <Image
                      source={{ uri: item.media.url }}
                      style={styles.photo}
                      contentFit="cover"
                    />
                  ) : item.type === 'IMAGE' ? (
                    <ActivityIndicator color={colors.text} />
                  ) : null}
                  {item.body ? <AppText>{item.body}</AppText> : null}
                  <AppText
                    variant="small"
                    color={mine ? 'rgba(255,255,255,0.7)' : colors.textSecondary}
                    style={{ alignSelf: 'flex-end' }}
                  >
                    {formatDateTime(item.createdAt)}
                    {mine
                      ? item.local === 'sending'
                        ? ' · envoi…'
                        : item.local === 'failed'
                          ? ' · échec'
                          : read
                            ? ' · lu'
                            : ' · envoyé'
                      : ''}
                  </AppText>
                </Pressable>
                {item.local === 'failed' && (
                  <Pressable
                    accessibilityLabel="Renvoyer"
                    onPress={() =>
                      deliver({ ...item, local: 'sending' }, { body: item.body ?? undefined })
                    }
                  >
                    <Ionicons name="refresh-circle" size={24} color={colors.danger} />
                  </Pressable>
                )}
              </View>
            );
          }}
        />
        {conv.blocked ? (
          <View style={{ padding: spacing.md }}>
            <Notice text="Vous avez bloqué cet utilisateur. Débloquez-le depuis le menu pour échanger à nouveau." />
          </View>
        ) : !me?.emailVerified ? (
          <View style={{ padding: spacing.md }}>
            <Notice text="Confirmez votre adresse email pour envoyer des messages." />
          </View>
        ) : (
          <View style={styles.composer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Envoyer une photo"
              onPress={sendPhoto}
              disabled={uploading}
              style={styles.iconBtn}
            >
              {uploading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Ionicons name="image-outline" size={24} color={colors.primaryLight} />
              )}
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Votre message"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={MESSAGE_MAX_LENGTH}
              style={styles.input}
              accessibilityLabel="Votre message"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Envoyer"
              onPress={send}
              disabled={!text.trim()}
              style={[styles.send, !text.trim() && { opacity: 0.4 }]}
            >
              <Ionicons name="send" size={18} color={colors.text} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
      <ReportModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="USER"
        targetId={conv.otherUser.id}
      />
      {reportTarget && (
        <ReportModal
          visible
          onClose={() => setReportTarget(null)}
          targetType="MESSAGE"
          targetId={reportTarget}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  productBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  productThumb: { width: 40, height: 40, borderRadius: radius.sm },
  system: { textAlign: 'center', marginVertical: spacing.sm },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  bubble: { maxWidth: '78%', padding: spacing.md, borderRadius: radius.lg, gap: 4 },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: 4 },
  photo: { width: 200, height: 240, borderRadius: radius.md },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: MIN_TOUCH,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    fontSize: 15,
  },
  send: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

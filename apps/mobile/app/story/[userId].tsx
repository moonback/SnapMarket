import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatCents, StoryDto, StoryGroupDto } from '@snapmarket/shared';
import { ReportModal } from '../../src/components/ReportModal';
import { AppText, Avatar, EmptyView, LoadingView } from '../../src/components/ui';
import { keys, useStories } from '../../src/hooks/queries';
import { api } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';
import { relativeTime } from '../../src/utils/format';

const IMAGE_DURATION_MS = 5000;

function StoryVideo({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

/** Lecteur plein écran des stories d'un utilisateur (expiration vérifiée par le serveur). */
export default function StoryViewer() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const me = useAuth((s) => s.user);
  const qc = useQueryClient();
  const stories = useStories();
  const group: StoryGroupDto | undefined = stories.data?.find((g) => g.author.id === userId);
  const [index, setIndex] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const story: StoryDto | undefined = group?.stories[index];

  const next = () => {
    if (!group) return;
    if (index < group.stories.length - 1) setIndex(index + 1);
    else router.back();
  };

  useEffect(() => {
    if (!story) return;
    if (!story.viewed && story.author.id !== me?.id) {
      api.request(`/stories/${story.id}/view`, { method: 'POST' }).catch(() => undefined);
    }
    progress.setValue(0);
    if (story.media.kind === 'IMAGE' && !reportOpen) {
      const anim = Animated.timing(progress, {
        toValue: 1,
        duration: IMAGE_DURATION_MS,
        useNativeDriver: false,
      });
      anim.start(({ finished }) => finished && next());
      return () => anim.stop();
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, reportOpen]);

  useEffect(() => () => void qc.invalidateQueries({ queryKey: keys.stories }), [qc]);

  if (stories.isLoading) return <LoadingView />;
  if (!group || !story) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyView
          icon="time-outline"
          title="Story expirée"
          action={
            <AppText color={colors.primaryLight} onPress={() => router.back()}>
              Retour
            </AppText>
          }
        />
      </SafeAreaView>
    );
  }
  const isMine = story.author.id === me?.id;

  async function remove() {
    Alert.alert('Supprimer cette story ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await api.request(`/stories/${story!.id}`, { method: 'DELETE' }).catch(() => undefined);
          void qc.invalidateQueries({ queryKey: keys.stories });
          router.back();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {story.media.kind === 'VIDEO' && story.media.url ? (
        <StoryVideo key={story.id} uri={story.media.url} onEnd={next} />
      ) : (
        <Image
          source={{ uri: story.media.url ?? undefined }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
        />
      )}
      <View style={styles.tapZones}>
        <Pressable
          style={{ flex: 1 }}
          accessibilityLabel="Story précédente"
          onPress={() => setIndex(Math.max(0, index - 1))}
        />
        <Pressable style={{ flex: 2 }} accessibilityLabel="Story suivante" onPress={next} />
      </View>
      <SafeAreaView edges={['top']} style={styles.top}>
        <View style={styles.bars}>
          {group.stories.map((s, i) => (
            <View key={s.id} style={styles.barBg}>
              <Animated.View
                style={[
                  styles.barFill,
                  {
                    width:
                      i < index
                        ? '100%'
                        : i === index
                          ? progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', '100%'],
                            })
                          : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>
        <View style={styles.authorRow}>
          <Pressable
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}
            onPress={() => router.replace(`/user/${story.author.id}`)}
          >
            <Avatar uri={story.author.avatarUrl} size={32} />
            <AppText variant="bodyStrong">{story.author.username}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {relativeTime(story.createdAt)}
            </AppText>
          </Pressable>
          {isMine ? (
            <>
              {story.viewsCount !== null && (
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  accessibilityLabel={`${story.viewsCount} vues`}
                >
                  <Ionicons name="eye-outline" size={18} color={colors.text} />
                  <AppText variant="caption">{story.viewsCount}</AppText>
                </View>
              )}
              <Pressable
                accessibilityLabel="Supprimer la story"
                onPress={remove}
                hitSlop={10}
                style={{ padding: spacing.sm }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.text} />
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityLabel="Signaler la story"
              onPress={() => setReportOpen(true)}
              hitSlop={10}
              style={{ padding: spacing.sm }}
            >
              <Ionicons name="flag-outline" size={22} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            accessibilityLabel="Fermer"
            onPress={() => router.back()}
            hitSlop={10}
            style={{ padding: spacing.sm }}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={styles.bottom}>
        {story.caption ? <AppText style={styles.caption}>{story.caption}</AppText> : null}
        {story.product && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace(`/product/${story.product!.id}`)}
            style={styles.productLink}
          >
            <Ionicons name="pricetag" size={18} color={colors.text} />
            <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {story.product.title}
            </AppText>
            <AppText variant="bodyStrong">{formatCents(story.product.priceCents)}</AppText>
          </Pressable>
        )}
      </SafeAreaView>
      <ReportModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="STORY"
        targetId={story.id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tapZones: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  bars: { flexDirection: 'row', gap: 4, paddingTop: spacing.sm },
  barBg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  barFill: { height: 3, backgroundColor: colors.text },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    gap: spacing.md,
  },
  caption: { textShadowColor: '#000', textShadowRadius: 6 },
  productLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: spacing.md,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useStories } from '../hooks/queries';
import { useAuth } from '../stores/auth';
import { colors, spacing } from '../theme/tokens';
import { AppText, Avatar } from './ui';

export function StoriesBar() {
  const { data } = useStories();
  const me = useAuth((s) => s.user);
  const groups = data ?? [];
  const hasOwn = groups.some((g) => g.author.id === me?.id);
  return (
    <FlatList
      horizontal
      showsHorizontalScrollIndicator={false}
      data={groups}
      keyExtractor={(g) => g.author.id}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
      ListHeaderComponent={
        hasOwn ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Publier une story"
            style={styles.item}
            onPress={() => router.push({ pathname: '/(tabs)/sell', params: { mode: 'story' } })}
          >
            <View style={[styles.ring, { borderColor: colors.border }]}>
              <Avatar uri={me?.avatarUrl} size={58} />
              <View style={styles.plus}>
                <Ionicons name="add" size={14} color={colors.text} />
              </View>
            </View>
            <AppText variant="small" color={colors.textSecondary}>
              Ma story
            </AppText>
          </Pressable>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stories de ${item.author.username}`}
          style={styles.item}
          onPress={() => router.push(`/story/${item.author.id}`)}
        >
          <View
            style={[
              styles.ring,
              { borderColor: item.hasUnviewed ? colors.primary : colors.border },
            ]}
          >
            {item.author.avatarUrl ? (
              <Image source={{ uri: item.author.avatarUrl }} style={styles.img} />
            ) : (
              <Avatar uri={null} size={58} />
            )}
          </View>
          <AppText variant="small" numberOfLines={1} style={{ maxWidth: 68 }}>
            {item.author.id === me?.id ? 'Ma story' : item.author.username}
          </AppText>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', gap: 4, width: 68 },
  ring: { borderWidth: 2, borderRadius: 34, padding: 3 },
  img: { width: 58, height: 58, borderRadius: 29 },
  plus: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: colors.primary,
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

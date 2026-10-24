import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MediaPurpose } from '@snapmarket/shared';
import { AppText } from '../components/ui';
import { PickedAsset, pickFromLibrary, takePhoto, uploadAsset } from '../services/media';
import { colors, radius, spacing } from '../theme/tokens';

export interface LocalMedia {
  key: string;
  uri: string;
  mediaId?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/** Sélection et téléversement immédiat de photos (et vidéos si autorisé). */
export function MediaPickerRow({
  items,
  onChange,
  max,
  purpose,
  allowVideo,
}: {
  items: LocalMedia[];
  onChange: (updater: (prev: LocalMedia[]) => LocalMedia[]) => void;
  max: number;
  purpose: MediaPurpose;
  allowVideo?: boolean;
}) {
  async function add(source: 'camera' | 'library') {
    try {
      const assets: PickedAsset[] =
        source === 'camera'
          ? [await takePhoto()].filter((a): a is PickedAsset => !!a)
          : await pickFromLibrary({ multiple: true, limit: max - items.length, allowVideo });
      for (const asset of assets.slice(0, max - items.length)) {
        const key = `${Date.now()}-${Math.random()}`;
        onChange((prev) => [...prev, { key, uri: asset.uri, status: 'uploading' }]);
        uploadAsset(asset, purpose)
          .then((m) =>
            onChange((prev) =>
              prev.map((x) => (x.key === key ? { ...x, status: 'done', mediaId: m.id } : x)),
            ),
          )
          .catch((e: Error) =>
            onChange((prev) =>
              prev.map((x) => (x.key === key ? { ...x, status: 'error', error: e.message } : x)),
            ),
          );
      }
    } catch (e) {
      Alert.alert('Photos', (e as Error).message);
    }
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm }}
    >
      {items.length < max && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Prendre une photo"
            style={styles.add}
            onPress={() => add('camera')}
          >
            <Ionicons name="camera-outline" size={26} color={colors.primaryLight} />
            <AppText variant="small" color={colors.textSecondary}>
              Photo
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choisir dans la galerie"
            style={styles.add}
            onPress={() => add('library')}
          >
            <Ionicons name="images-outline" size={26} color={colors.primaryLight} />
            <AppText variant="small" color={colors.textSecondary}>
              Galerie
            </AppText>
          </Pressable>
        </>
      )}
      {items.map((m, i) => (
        <View key={m.key} style={styles.thumb}>
          <Image source={{ uri: m.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          {m.status === 'uploading' && (
            <View style={styles.overlay}>
              <ActivityIndicator color={colors.text} />
            </View>
          )}
          {m.status === 'error' && (
            <Pressable
              style={styles.overlay}
              onPress={() => Alert.alert('Échec du téléversement', m.error ?? '')}
            >
              <Ionicons name="alert-circle" size={26} color={colors.danger} />
            </Pressable>
          )}
          {i === 0 && (
            <View style={styles.coverTag}>
              <AppText variant="small">Couverture</AppText>
            </View>
          )}
          <Pressable
            accessibilityLabel="Retirer"
            hitSlop={8}
            style={styles.remove}
            onPress={() => onChange((prev) => prev.filter((x) => x.key !== m.key))}
          >
            <Ionicons name="close" size={14} color={colors.text} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  add: {
    width: 88,
    height: 110,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  thumb: {
    width: 88,
    height: 110,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.overlay,
    borderRadius: 10,
    padding: 3,
  },
  coverTag: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
});

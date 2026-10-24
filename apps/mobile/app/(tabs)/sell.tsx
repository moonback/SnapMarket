import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Button, Chip, Notice, Screen, TextField } from '../../src/components/ui';
import { LocalMedia, MediaPickerRow } from '../../src/features/MediaPickerRow';
import { ProductForm } from '../../src/features/ProductForm';
import { keys, useMyProducts } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';

function StoryComposer() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const [media, setMedia] = useState<LocalMedia[]>([]);
  const [caption, setCaption] = useState('');
  const [productId, setProductId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const mine = useMyProducts('ACTIVE');

  async function publish() {
    const m = media[0];
    if (!m || m.status !== 'done' || !m.mediaId)
      return Alert.alert('Story', 'Ajoutez une photo ou une vidéo téléversée.');
    setSending(true);
    try {
      await api.request('/stories', {
        method: 'POST',
        body: { mediaId: m.mediaId, caption: caption || undefined, productId },
      });
      void qc.invalidateQueries({ queryKey: keys.stories });
      setMedia([]);
      setCaption('');
      setProductId(undefined);
      Alert.alert('Story publiée', 'Elle restera visible 24 heures (durée par défaut).');
      router.navigate('/(tabs)');
    } catch (e) {
      Alert.alert(
        'Publication impossible',
        e instanceof ApiError ? e.message : 'Réessayez plus tard.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {!user?.emailVerified && (
        <Notice text="Confirmez votre adresse email pour publier une story." />
      )}
      <AppText color={colors.textSecondary}>
        Photo ou vidéo courte (60 s max). Les stories expirent automatiquement.
      </AppText>
      <MediaPickerRow items={media} onChange={setMedia} max={1} purpose="STORY" allowVideo />
      <TextField
        label="Légende (facultatif)"
        value={caption}
        onChangeText={setCaption}
        maxLength={200}
      />
      <AppText variant="heading">Lier à une annonce (facultatif)</AppText>
      <View style={styles.wrap}>
        <Chip label="Aucune" selected={!productId} onPress={() => setProductId(undefined)} />
        {mine.data?.items.map((p) => (
          <Chip
            key={p.id}
            label={p.title}
            selected={productId === p.id}
            onPress={() => setProductId(p.id)}
          />
        ))}
      </View>
      <Button
        title="Publier la story"
        onPress={publish}
        loading={sending}
        disabled={!user?.emailVerified || media[0]?.status !== 'done'}
      />
    </ScrollView>
  );
}

export default function Sell() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'product' | 'story'>(
    params.mode === 'story' ? 'story' : 'product',
  );
  useEffect(() => {
    if (params.mode === 'story') setMode('story');
  }, [params.mode]);
  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="title">Vendre</AppText>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Annonce" selected={mode === 'product'} onPress={() => setMode('product')} />
          <Chip label="Story" selected={mode === 'story'} onPress={() => setMode('story')} />
        </View>
      </View>
      {mode === 'product' ? <ProductForm key="new" /> : <StoryComposer />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  body: { padding: spacing.lg, gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { ConversationDto } from '@snapmarket/shared';
import { ReportModal } from '../../src/components/ReportModal';
import { Button, ErrorView, Header, LoadingView, Screen } from '../../src/components/ui';
import { ProfileView } from '../../src/features/ProfileView';
import { queryClient, usePublicUser, useUserProducts } from '../../src/hooks/queries';
import { api, ApiError } from '../../src/services/api';
import { useAuth } from '../../src/stores/auth';
import { colors, spacing } from '../../src/theme/tokens';

export default function PublicProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useAuth((s) => s.user);
  const user = usePublicUser(id);
  const products = useUserProducts(id);
  const [reportOpen, setReportOpen] = useState(false);

  if (user.isLoading) return <LoadingView />;
  if (!user.data) return <ErrorView message="Profil introuvable" onRetry={() => user.refetch()} />;
  const isMe = me?.id === id;

  async function message() {
    try {
      const conv = await api.request<ConversationDto>('/conversations', {
        method: 'POST',
        body: { userId: id },
      });
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      Alert.alert('Contact impossible', e instanceof ApiError ? e.message : '');
    }
  }

  function block() {
    Alert.alert(
      'Bloquer cet utilisateur ?',
      'Vous ne verrez plus ses annonces ni ses stories, et vous ne pourrez plus échanger de messages.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Bloquer',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.request(`/users/${id}/block`, { method: 'POST' });
              void queryClient.invalidateQueries({ queryKey: ['feed'] });
              void queryClient.invalidateQueries({ queryKey: ['stories'] });
              router.back();
            } catch (e) {
              Alert.alert('Action impossible', e instanceof ApiError ? e.message : '');
            }
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <Header
        title={user.data.username}
        onBack={() => router.back()}
        right={
          !isMe ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Signaler l’utilisateur"
              onPress={() => setReportOpen(true)}
              hitSlop={8}
            >
              <Ionicons name="flag-outline" size={20} color={colors.text} />
            </Pressable>
          ) : null
        }
      />
      <ProfileView
        user={user.data}
        active={products.data?.items ?? []}
        footer={
          !isMe ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg }}>
              <Button
                title="Envoyer un message"
                icon="chatbubble-outline"
                onPress={message}
                style={{ flex: 1 }}
              />
              <Button title="Bloquer" variant="ghost" onPress={block} />
            </View>
          ) : null
        }
      />
      <ReportModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="USER"
        targetId={id}
      />
    </Screen>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, Screen } from '../../src/components/ui';
import { colors, radius, spacing } from '../../src/theme/tokens';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'flash-outline', text: 'Découvrez des articles en stories et en images' },
  { icon: 'chatbubbles-outline', text: 'Discutez et négociez directement avec les vendeurs' },
  { icon: 'shield-checkmark-outline', text: 'Paiement intégré, fonds versés après réception' },
];

export default function Welcome() {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <Ionicons name="bag-handle" size={44} color={colors.text} />
          </View>
          <AppText variant="display">
            Snap
            <AppText variant="display" color={colors.primary}>
              Market
            </AppText>
          </AppText>
          <AppText color={colors.textSecondary} style={{ textAlign: 'center' }}>
            La marketplace sociale pour acheter et vendre entre particuliers et professionnels.
          </AppText>
        </View>
        <View style={{ gap: spacing.md }}>
          {POINTS.map((p) => (
            <View key={p.text} style={styles.point}>
              <Ionicons name={p.icon} size={22} color={colors.primaryLight} />
              <AppText style={{ flex: 1 }}>{p.text}</AppText>
            </View>
          ))}
        </View>
        <View style={{ gap: spacing.md }}>
          <Button title="Créer un compte" onPress={() => router.push('/(auth)/register')} />
          <Button
            title="Se connecter"
            variant="ghost"
            onPress={() => router.push('/(auth)/login')}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
  hero: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  point: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
});

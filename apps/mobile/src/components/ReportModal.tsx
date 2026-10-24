import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { REPORT_REASON_LABELS, ReportReason, ReportTargetType } from '@snapmarket/shared';
import { api, ApiError } from '../services/api';
import { colors, radius, spacing } from '../theme/tokens';
import { AppText, Button, Chip } from './ui';

/** Signalement d'un contenu (annonce, utilisateur, message, story, avis). */
export function ReportModal({
  visible,
  onClose,
  targetType,
  targetId,
}: {
  visible: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!reason) return;
    setSending(true);
    try {
      await api.request('/reports', {
        method: 'POST',
        body: { targetType, targetId, reason, details: details || undefined },
      });
      Alert.alert('Merci', 'Votre signalement a été transmis à l’équipe de modération.');
      setReason(null);
      setDetails('');
      onClose();
    } catch (e) {
      Alert.alert(
        'Signalement impossible',
        e instanceof ApiError ? e.message : 'Réessayez plus tard.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer" />
      <View style={styles.sheet}>
        <AppText variant="heading">Signaler</AppText>
        <View style={styles.reasons}>
          {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((r) => (
            <Chip
              key={r}
              label={REPORT_REASON_LABELS[r]}
              selected={reason === r}
              onPress={() => setReason(r)}
            />
          ))}
        </View>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Précisions (facultatif)"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={1000}
          style={styles.input}
          accessibilityLabel="Précisions"
        />
        <Button
          title="Envoyer le signalement"
          onPress={submit}
          disabled={!reason}
          loading={sending}
          variant="danger"
        />
        <Button title="Annuler" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    textAlignVertical: 'top',
  },
});

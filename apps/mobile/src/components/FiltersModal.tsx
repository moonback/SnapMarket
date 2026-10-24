import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import {
  parseEurosToCents,
  PRODUCT_CONDITION_LABELS,
  PRODUCT_CONDITIONS,
} from '@snapmarket/shared';
import type { FeedFilters } from '../hooks/queries';
import { colors, radius, spacing } from '../theme/tokens';
import { AppText, Button, Chip, TextField } from './ui';

const SORTS: { value: NonNullable<FeedFilters['sort']>; label: string }[] = [
  { value: 'for_you', label: 'Pour vous' },
  { value: 'recent', label: 'Plus récents' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
];

export function FiltersModal({
  visible,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  value: FeedFilters;
  onClose: () => void;
  onApply: (f: FeedFilters) => void;
}) {
  const [draft, setDraft] = useState<FeedFilters>(value);
  const [min, setMin] = useState(value.minPriceCents ? String(value.minPriceCents / 100) : '');
  const [max, setMax] = useState(value.maxPriceCents ? String(value.maxPriceCents / 100) : '');
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const minC = min ? parseEurosToCents(min) : undefined;
    const maxC = max ? parseEurosToCents(max) : undefined;
    if (minC === null || maxC === null) return setError('Prix invalide');
    if (minC !== undefined && maxC !== undefined && minC > maxC)
      return setError('Le prix minimum dépasse le maximum');
    if (draft.department && !/^\d{2,3}$/.test(draft.department))
      return setError('Département : 2 ou 3 chiffres');
    setError(null);
    onApply({ ...draft, minPriceCents: minC, maxPriceCents: maxC });
  }

  const toggleCondition = (c: string) => {
    const current = draft.conditions ?? [];
    setDraft({
      ...draft,
      conditions: current.includes(c) ? current.filter((x) => x !== c) : [...current, c],
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.body}
      >
        <AppText variant="title">Filtres</AppText>
        <AppText variant="heading">Trier par</AppText>
        <View style={styles.wrap}>
          {SORTS.map((s) => (
            <Chip
              key={s.value}
              label={s.label}
              selected={(draft.sort ?? 'for_you') === s.value}
              onPress={() => setDraft({ ...draft, sort: s.value })}
            />
          ))}
        </View>
        <AppText variant="heading">Prix (€)</AppText>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Minimum"
              value={min}
              onChangeText={setMin}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Maximum"
              value={max}
              onChangeText={setMax}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <AppText variant="heading">État</AppText>
        <View style={styles.wrap}>
          {PRODUCT_CONDITIONS.map((c) => (
            <Chip
              key={c}
              label={PRODUCT_CONDITION_LABELS[c]}
              selected={draft.conditions?.includes(c)}
              onPress={() => toggleCondition(c)}
            />
          ))}
        </View>
        <AppText variant="heading">Mode de remise</AppText>
        <View style={styles.wrap}>
          <Chip
            label="Tous"
            selected={!draft.deliveryMode}
            onPress={() => setDraft({ ...draft, deliveryMode: undefined })}
          />
          <Chip
            label="Livraison"
            selected={draft.deliveryMode === 'SHIPPING'}
            onPress={() => setDraft({ ...draft, deliveryMode: 'SHIPPING' })}
          />
          <Chip
            label="Main propre"
            selected={draft.deliveryMode === 'MEETUP'}
            onPress={() => setDraft({ ...draft, deliveryMode: 'MEETUP' })}
          />
        </View>
        <TextField
          label="Département (2 ou 3 premiers chiffres du code postal)"
          value={draft.department ?? ''}
          onChangeText={(t) => setDraft({ ...draft, department: t || undefined })}
          keyboardType="number-pad"
          maxLength={3}
        />
        {error && <AppText color={colors.danger}>{error}</AppText>}
        <Button title="Appliquer" onPress={apply} />
        <Button
          title="Réinitialiser"
          variant="ghost"
          onPress={() => {
            setDraft({ q: value.q, categoryId: value.categoryId });
            setMin('');
            setMax('');
          }}
        />
        <Button title="Fermer" variant="ghost" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, borderRadius: radius.md },
});

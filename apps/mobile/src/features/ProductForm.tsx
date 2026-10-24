import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import {
  DELIVERY_MODE_LABELS,
  DeliveryMode,
  formatCents,
  parseEurosToCents,
  PRODUCT_CONDITION_LABELS,
  PRODUCT_CONDITIONS,
  PRODUCT_MAX_MEDIA,
  ProductCondition,
  ProductDetail,
  productInputSchema,
} from '@snapmarket/shared';
import { AppText, Button, Card, Chip, Notice, TextField } from '../components/ui';
import { useCategories } from '../hooks/queries';
import { api, ApiError } from '../services/api';
import { useAuth } from '../stores/auth';
import { colors, spacing } from '../theme/tokens';
import { LocalMedia, MediaPickerRow } from './MediaPickerRow';

const centsToInput = (c: number | null | undefined) =>
  c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ',');

/** Formulaire de création / modification d'annonce (validation Zod partagée, revalidée par l'API). */
export function ProductForm({ product }: { product?: ProductDetail }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const categories = useCategories();
  const [media, setMedia] = useState<LocalMedia[]>(
    product?.media.map((m) => ({
      key: m.id,
      uri: m.thumbnailUrl ?? m.url ?? '',
      mediaId: m.id,
      status: 'done' as const,
    })) ?? [],
  );
  const [title, setTitle] = useState(product?.title ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(centsToInput(product?.priceCents));
  const [categoryId, setCategoryId] = useState(product?.category.id ?? '');
  const [condition, setCondition] = useState<ProductCondition | ''>(product?.condition ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [quantity, setQuantity] = useState(String(product?.quantity ?? 1));
  const [modes, setModes] = useState<DeliveryMode[]>(
    product?.deliveryModes ?? ['SHIPPING', 'MEETUP'],
  );
  const [shipping, setShipping] = useState(centsToInput(product?.shippingFeeCents));
  const [city, setCity] = useState(product?.city ?? '');
  const [postalCode, setPostalCode] = useState(product?.postalCode ?? '');
  const [offersEnabled, setOffersEnabled] = useState(product?.offersEnabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);
  const [preview, setPreview] = useState(false);

  function build() {
    const priceCents = parseEurosToCents(price);
    const shippingFeeCents = shipping ? parseEurosToCents(shipping) : undefined;
    const input = {
      title,
      description,
      priceCents: priceCents ?? NaN,
      categoryId,
      condition,
      brand: brand || undefined,
      quantity: Number(quantity) || 1,
      deliveryModes: modes,
      shippingFeeCents: modes.includes('SHIPPING') ? (shippingFeeCents ?? undefined) : undefined,
      city: city || undefined,
      postalCode: postalCode || undefined,
      offersEnabled,
      mediaIds: media.filter((m) => m.status === 'done' && m.mediaId).map((m) => m.mediaId!),
    };
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] ??= issue.message;
      if (priceCents === null) e.priceCents = 'Prix invalide';
      setErrors(e);
      return null;
    }
    setErrors({});
    return parsed.data;
  }

  async function save(publish: boolean) {
    if (media.some((m) => m.status === 'uploading'))
      return Alert.alert('Patientez', 'Le téléversement des photos est en cours.');
    const data = build();
    if (!data) return;
    if (publish && data.mediaIds.length === 0)
      return setErrors({ mediaIds: 'Ajoutez au moins une photo pour publier' });
    setSaving(publish ? 'publish' : 'draft');
    try {
      const body = { ...data, publish };
      const saved = product
        ? await api.request<ProductDetail>(`/products/${product.id}`, { method: 'PATCH', body })
        : await api.request<ProductDetail>('/products', { method: 'POST', body });
      void qc.invalidateQueries({ queryKey: ['myProducts'] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['product', saved.id] });
      if (saved.moderationStatus === 'HIDDEN') {
        Alert.alert(
          'Annonce enregistrée',
          'Elle sera visible après vérification par notre équipe.',
        );
      }
      router.replace(`/product/${saved.id}`);
    } catch (e) {
      Alert.alert(
        'Enregistrement impossible',
        e instanceof ApiError ? e.message : 'Réessayez plus tard.',
      );
    } finally {
      setSaving(null);
    }
  }

  const toggleMode = (m: DeliveryMode) =>
    setModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  const priceCents = parseEurosToCents(price);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!user?.emailVerified && (
          <Notice text="Confirmez votre adresse email pour pouvoir publier. Vous pouvez enregistrer un brouillon." />
        )}
        <AppText variant="heading">
          Photos ({media.length}/{PRODUCT_MAX_MEDIA})
        </AppText>
        <MediaPickerRow
          items={media}
          onChange={setMedia}
          max={PRODUCT_MAX_MEDIA}
          purpose="PRODUCT"
        />
        {errors.mediaIds && (
          <AppText variant="caption" color={colors.danger}>
            {errors.mediaIds}
          </AppText>
        )}
        <TextField
          label="Titre"
          value={title}
          onChangeText={setTitle}
          maxLength={80}
          error={errors.title}
        />
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={4000}
          style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: spacing.md }}
          error={errors.description}
        />
        <TextField
          label="Prix (€)"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          error={errors.priceCents}
        />
        <AppText variant="heading">Catégorie</AppText>
        <View style={styles.wrap}>
          {categories.data?.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </View>
        {categories.data?.find((c) => c.id === categoryId)?.requiresReview && (
          <Notice
            text="Les annonces de cette catégorie sont vérifiées par l’équipe avant publication."
            tone="primary"
          />
        )}
        {errors.categoryId && (
          <AppText variant="caption" color={colors.danger}>
            {errors.categoryId}
          </AppText>
        )}
        <AppText variant="heading">État</AppText>
        <View style={styles.wrap}>
          {PRODUCT_CONDITIONS.map((c) => (
            <Chip
              key={c}
              label={PRODUCT_CONDITION_LABELS[c]}
              selected={condition === c}
              onPress={() => setCondition(c)}
            />
          ))}
        </View>
        {errors.condition && (
          <AppText variant="caption" color={colors.danger}>
            Choisissez l’état
          </AppText>
        )}
        <TextField
          label="Marque (facultatif)"
          value={brand}
          onChangeText={setBrand}
          maxLength={60}
        />
        <TextField
          label="Quantité disponible"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          error={errors.quantity}
        />
        <AppText variant="heading">Remise</AppText>
        <View style={styles.wrap}>
          {(Object.keys(DELIVERY_MODE_LABELS) as DeliveryMode[]).map((m) => (
            <Chip
              key={m}
              label={DELIVERY_MODE_LABELS[m]}
              selected={modes.includes(m)}
              onPress={() => toggleMode(m)}
            />
          ))}
        </View>
        {errors.deliveryModes && (
          <AppText variant="caption" color={colors.danger}>
            Choisissez au moins un mode
          </AppText>
        )}
        {modes.includes('SHIPPING') && (
          <TextField
            label="Frais de livraison facturés à l’acheteur (€)"
            value={shipping}
            onChangeText={setShipping}
            keyboardType="decimal-pad"
            error={errors.shippingFeeCents}
          />
        )}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 2 }}>
            <TextField label="Ville" value={city} onChangeText={setCity} maxLength={80} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Code postal"
              value={postalCode}
              onChangeText={setPostalCode}
              keyboardType="number-pad"
              maxLength={5}
              error={errors.postalCode}
            />
          </View>
        </View>
        <View style={styles.switchRow}>
          <AppText style={{ flex: 1 }}>Accepter les offres de prix</AppText>
          <Switch
            value={offersEnabled}
            onValueChange={setOffersEnabled}
            trackColor={{ true: colors.primary }}
            accessibilityLabel="Accepter les offres"
          />
        </View>
        <Button
          title="Prévisualiser"
          variant="secondary"
          icon="eye-outline"
          onPress={() => build() && setPreview(true)}
        />
        <Button
          title={product && product.status !== 'DRAFT' ? 'Enregistrer' : 'Publier'}
          onPress={() => save(product ? product.status !== 'DRAFT' : true)}
          loading={saving === 'publish'}
          disabled={!user?.emailVerified && !(product && product.status !== 'DRAFT')}
        />
        {(!product || product.status === 'DRAFT') && (
          <Button
            title="Enregistrer le brouillon"
            variant="ghost"
            onPress={() => save(false)}
            loading={saving === 'draft'}
          />
        )}
      </ScrollView>
      <Modal
        visible={preview}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPreview(false)}
      >
        <ScrollView
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={styles.body}
        >
          <AppText variant="title">Aperçu</AppText>
          <Card>
            <AppText variant="title">{priceCents !== null ? formatCents(priceCents) : '—'}</AppText>
            <AppText variant="heading">{title}</AppText>
            <AppText color={colors.textSecondary}>
              {[brand, condition ? PRODUCT_CONDITION_LABELS[condition] : null, city]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
            <AppText>{description || 'Pas de description'}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {modes.map((m) => DELIVERY_MODE_LABELS[m]).join(' · ')}
            </AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {media.length} photo(s)
            </AppText>
          </Card>
          <Button title="Fermer l’aperçu" variant="ghost" onPress={() => setPreview(false)} />
        </ScrollView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 12,
  },
});

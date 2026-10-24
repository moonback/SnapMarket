import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ORDER_STATUS_LABELS } from '@snapmarket/shared';
import { AppText, Button, Card, Header, Screen } from '../src/components/ui';
import { flatten, useOrders } from '../src/hooks/queries';
import { colors, spacing } from '../src/theme/tokens';

const FAQ = [
  {
    q: 'Quand le vendeur est-il payé ?',
    a: 'Votre paiement est conservé jusqu’à ce que vous confirmiez la réception (livraison) ou la remise en main propre. Les fonds sont ensuite versés au vendeur, déduction faite de la commission SnapMarket.',
  },
  {
    q: 'Comment fonctionne la commission ?',
    a: 'Une commission, dont le taux est affiché sur chaque vente, est calculée sur le prix des articles, hors frais de livraison. Elle est déduite du montant versé au vendeur ; l’acheteur ne paie pas de frais supplémentaires. Elle n’est pas prélevée si la commande est annulée ou remboursée.',
  },
  {
    q: 'Mon colis n’est pas arrivé ou ne correspond pas',
    a: 'Ne confirmez pas la réception. Ouvrez la commande et utilisez « Un problème ? » pour ouvrir un litige : notre équipe examine la situation et peut rembourser l’acheteur.',
  },
  {
    q: 'Remise en main propre : comment se protéger ?',
    a: 'Choisissez un lieu public et fréquenté. Vérifiez l’article sur place avant de confirmer la remise dans l’application. La commande n’est jamais terminée automatiquement.',
  },
  {
    q: 'Un utilisateur me demande de payer hors de l’application',
    a: 'Refusez : les paiements hors SnapMarket (virement, coupons, mandats…) ne sont pas protégés. Signalez l’utilisateur depuis son profil ou la conversation.',
  },
  {
    q: 'Qu’est-ce que le badge « Professionnel vérifié » ?',
    a: 'Il n’apparaît que lorsque notre équipe a vérifié manuellement l’entreprise déclarée par le vendeur (SIRET).',
  },
];

export default function Help() {
  const [open, setOpen] = useState<number | null>(0);
  const purchases = useOrders('buyer');
  const sales = useOrders('seller');
  const disputes = useMemo(
    () =>
      [...flatten(purchases.data), ...flatten(sales.data)].filter(
        (o) => o.status === 'DISPUTED' || o.dispute,
      ),
    [purchases.data, sales.data],
  );
  return (
    <Screen>
      <Header title="Aide et litiges" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl }}
      >
        <AppText variant="heading">Mes litiges</AppText>
        {disputes.length === 0 ? (
          <AppText color={colors.textSecondary}>
            Aucun litige. Pour signaler un problème, ouvrez la commande concernée.
          </AppText>
        ) : (
          disputes.map((o) => (
            <Pressable key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
              <Card>
                <AppText variant="bodyStrong">{o.product.title}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {o.reference} · {ORDER_STATUS_LABELS[o.status]} · litige{' '}
                  {o.dispute?.status === 'OPEN' ? 'en cours' : 'résolu'}
                </AppText>
              </Card>
            </Pressable>
          ))
        )}
        <Button title="Voir mes commandes" variant="ghost" onPress={() => router.push('/orders')} />
        <AppText variant="heading">Questions fréquentes</AppText>
        {FAQ.map((f, i) => (
          <Pressable
            key={f.q}
            accessibilityRole="button"
            accessibilityState={{ expanded: open === i }}
            onPress={() => setOpen(open === i ? null : i)}
          >
            <Card>
              <AppText variant="bodyStrong">{f.q}</AppText>
              {open === i && (
                <View>
                  <AppText color={colors.textSecondary}>{f.a}</AppText>
                </View>
              )}
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

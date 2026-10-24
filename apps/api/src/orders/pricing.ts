import { OrderPricing } from '@snapmarket/shared';

/**
 * Règles de calcul (toutes en centimes d'euro, entiers uniquement) :
 *
 * - Base de la commission : prix des articles (prix unitaire × quantité), HORS frais de
 *   livraison. Les frais de livraison sont intégralement reversés au vendeur, qui expédie.
 * - Commission = arrondi au centime le plus proche (demi-centime arrondi au supérieur)
 *   de base × taux / 10 000 (taux exprimé en points de base : 500 = 5 %).
 * - Total payé par l'acheteur = articles + livraison (aucun frais acheteur au MVP).
 * - Montant reversé au vendeur = total − commission.
 * - Les frais du prestataire de paiement sont supportés par la plateforme.
 *
 * La commission n'est effectivement retenue qu'au moment du transfert vers le vendeur
 * (commande terminée). En cas d'annulation ou de remboursement avant ce transfert,
 * aucune commission n'est prélevée et l'acheteur est remboursé du total.
 */
export interface PricingInput {
  unitPriceCents: number;
  quantity: number;
  shippingFeeCents: number;
  commissionBps: number;
}

function assertCents(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v < 0)
    throw new Error(`${name} doit être un entier positif (centimes)`);
}

export function computeCommissionCents(baseCents: number, commissionBps: number): number {
  assertCents('base', baseCents);
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new Error('Taux de commission invalide');
  }
  return Math.floor((baseCents * commissionBps + 5_000) / 10_000);
}

/**
 * Un colis par vendeur : les annonces expédiées d'un même vendeur ne paient qu'une fois
 * la livraison, au montant le plus élevé parmi elles. Ce montant est porté par la première
 * ligne qui l'atteint, les autres lignes du vendeur passent à 0. Ordre des lignes conservé.
 * shortcut: annuler seule la commande porteuse rembourse toute la livraison du colis ;
 * à revoir si les annulations partielles d'un même colis deviennent courantes.
 */
export function bundleShippingFees(lines: { sellerId: string; feeCents: number }[]): number[] {
  const carrier = new Map<string, number>();
  lines.forEach((l, i) => {
    const best = carrier.get(l.sellerId);
    if (l.feeCents > 0 && (best === undefined || l.feeCents > lines[best]!.feeCents))
      carrier.set(l.sellerId, i);
  });
  return lines.map((l, i) => (carrier.get(l.sellerId) === i ? l.feeCents : 0));
}

export function computeOrderPricing(input: PricingInput): OrderPricing {
  assertCents('unitPriceCents', input.unitPriceCents);
  assertCents('shippingFeeCents', input.shippingFeeCents);
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error('Quantité invalide');
  const itemPriceCents = input.unitPriceCents * input.quantity;
  assertCents('itemPriceCents', itemPriceCents);
  const commissionCents = computeCommissionCents(itemPriceCents, input.commissionBps);
  const totalCents = itemPriceCents + input.shippingFeeCents;
  return {
    itemPriceCents,
    shippingFeeCents: input.shippingFeeCents,
    totalCents,
    commissionCents,
    commissionBps: input.commissionBps,
    sellerPayoutCents: totalCents - commissionCents,
  };
}

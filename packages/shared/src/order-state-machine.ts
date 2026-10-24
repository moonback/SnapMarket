import { DeliveryMode, OrderActor, OrderStatus } from './enums';

export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  actors: readonly OrderActor[];
  modes: readonly DeliveryMode[];
  description: string;
}

const BOTH: readonly DeliveryMode[] = ['SHIPPING', 'MEETUP'];

/**
 * Machine à états des commandes. Le serveur est la seule autorité : ce tableau
 * est partagé pour que les clients puissent afficher les actions possibles,
 * mais chaque transition est revalidée par l'API.
 *
 * Aucune transition n'est automatique sur simple passage du temps, sauf
 * l'annulation d'une commande jamais payée (SYSTEM).
 */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  {
    from: 'PENDING_PAYMENT',
    to: 'PAID',
    actors: ['SYSTEM'],
    modes: BOTH,
    description: 'Paiement confirmé par webhook signé du prestataire',
  },
  {
    from: 'PENDING_PAYMENT',
    to: 'CANCELLED',
    actors: ['BUYER', 'SELLER', 'ADMIN', 'SYSTEM'],
    modes: BOTH,
    description: 'Annulation avant paiement (ou expiration / échec du paiement)',
  },
  {
    from: 'PAID',
    to: 'PREPARING',
    actors: ['SELLER'],
    modes: ['SHIPPING'],
    description: 'Le vendeur prépare le colis',
  },
  {
    from: 'PREPARING',
    to: 'SHIPPED',
    actors: ['SELLER'],
    modes: ['SHIPPING'],
    description: 'Le vendeur déclare l’expédition',
  },
  {
    from: 'PAID',
    to: 'READY_FOR_HANDOFF',
    actors: ['SYSTEM'],
    modes: ['MEETUP'],
    description: 'Un rendez-vous a été accepté par les deux parties',
  },
  {
    from: 'READY_FOR_HANDOFF',
    to: 'PAID',
    actors: ['SYSTEM'],
    modes: ['MEETUP'],
    description: 'Le rendez-vous accepté a été annulé',
  },
  {
    from: 'SHIPPED',
    to: 'COMPLETED',
    actors: ['BUYER', 'ADMIN'],
    modes: ['SHIPPING'],
    description: 'L’acheteur confirme la réception conforme',
  },
  {
    from: 'READY_FOR_HANDOFF',
    to: 'COMPLETED',
    actors: ['BUYER', 'ADMIN'],
    modes: ['MEETUP'],
    description: 'L’acheteur confirme la remise en main propre',
  },
  {
    from: 'PAID',
    to: 'REFUNDED',
    actors: ['SELLER', 'ADMIN'],
    modes: BOTH,
    description: 'Annulation après paiement : remboursement intégral',
  },
  {
    from: 'PREPARING',
    to: 'REFUNDED',
    actors: ['SELLER', 'ADMIN'],
    modes: ['SHIPPING'],
    description: 'Annulation pendant la préparation : remboursement intégral',
  },
  {
    from: 'READY_FOR_HANDOFF',
    to: 'REFUNDED',
    actors: ['SELLER', 'ADMIN'],
    modes: ['MEETUP'],
    description: 'Annulation avant remise : remboursement intégral',
  },
  {
    from: 'PAID',
    to: 'DISPUTED',
    actors: ['BUYER', 'SYSTEM'],
    modes: BOTH,
    description: 'Ouverture d’un litige',
  },
  {
    from: 'PREPARING',
    to: 'DISPUTED',
    actors: ['BUYER', 'SYSTEM'],
    modes: ['SHIPPING'],
    description: 'Ouverture d’un litige',
  },
  {
    from: 'SHIPPED',
    to: 'DISPUTED',
    actors: ['BUYER', 'SYSTEM'],
    modes: ['SHIPPING'],
    description: 'Problème de livraison ou article non conforme',
  },
  {
    from: 'READY_FOR_HANDOFF',
    to: 'DISPUTED',
    actors: ['BUYER', 'SYSTEM'],
    modes: ['MEETUP'],
    description: 'Problème lors de la remise',
  },
  {
    from: 'COMPLETED',
    to: 'DISPUTED',
    actors: ['SYSTEM'],
    modes: BOTH,
    description: 'Contestation bancaire (chargeback) notifiée par le prestataire',
  },
  {
    from: 'DISPUTED',
    to: 'COMPLETED',
    actors: ['ADMIN'],
    modes: BOTH,
    description: 'Litige résolu en faveur du vendeur : fonds libérés',
  },
  {
    from: 'DISPUTED',
    to: 'REFUNDED',
    actors: ['ADMIN'],
    modes: BOTH,
    description: 'Litige résolu en faveur de l’acheteur : remboursement',
  },
];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'REFUNDED'];

export function findOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
  mode: DeliveryMode,
): OrderTransition | undefined {
  return ORDER_TRANSITIONS.find(
    (t) => t.from === from && t.to === to && t.actors.includes(actor) && t.modes.includes(mode),
  );
}

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
  mode: DeliveryMode,
): boolean {
  return findOrderTransition(from, to, actor, mode) !== undefined;
}

export function allowedOrderTransitions(
  from: OrderStatus,
  actor: OrderActor,
  mode: DeliveryMode,
): OrderStatus[] {
  return ORDER_TRANSITIONS.filter(
    (t) => t.from === from && t.actors.includes(actor) && t.modes.includes(mode),
  ).map((t) => t.to);
}

export { OrderStatus };

import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  canTransitionOrder,
  formatCents,
  ORDER_STATUS_LABELS,
  OrderActor,
} from '@snapmarket/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutJob, QUEUE_PAYOUTS } from '../queue/queues';

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor: OrderActor;
  actorId: string | null;
  note?: string;
  /** Données supplémentaires écrites sur la commande dans la même transaction. */
  data?: Prisma.OrderUpdateManyMutationInput;
  /** Opérations supplémentaires dans la même transaction. */
  extra?: (tx: Prisma.TransactionClient, order: Order) => Promise<void>;
  /** Statut attendu (garde supplémentaire contre les traitements concurrents). */
  expectedFrom?: OrderStatus | OrderStatus[];
}

export class InvalidTransitionError extends ConflictException {
  constructor(from: OrderStatus, to: OrderStatus) {
    super({
      message: `Action impossible : la commande est « ${ORDER_STATUS_LABELS[from]} »`,
      code: 'INVALID_ORDER_TRANSITION',
      from,
      to,
    });
  }
}

/**
 * Moteur de transitions des commandes. Chaque transition :
 *  - est validée par la machine à états partagée (statut, acteur, mode de livraison) ;
 *  - est appliquée avec un verrou optimiste (version) ;
 *  - est historisée (OrderStatusEvent) ;
 *  - met à jour le stock réservé de façon transactionnelle ;
 *  - notifie les participants après validation de la transaction.
 */
@Injectable()
export class OrderStateService {
  private readonly logger = new Logger(OrderStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_PAYOUTS) private readonly payouts: Queue<PayoutJob>,
  ) {}

  async transition(input: TransitionInput): Promise<Order> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
      const expected = input.expectedFrom
        ? Array.isArray(input.expectedFrom)
          ? input.expectedFrom
          : [input.expectedFrom]
        : null;
      if (expected && !expected.includes(order.status))
        throw new InvalidTransitionError(order.status, input.to);
      if (!canTransitionOrder(order.status, input.to, input.actor, order.deliveryMode)) {
        throw new InvalidTransitionError(order.status, input.to);
      }
      const now = new Date();
      const firstCompletion = input.to === 'COMPLETED' && order.completedAt === null;
      const data: Prisma.OrderUpdateManyMutationInput = {
        ...input.data,
        status: input.to,
        version: { increment: 1 },
      };
      if (input.to === 'PAID' && !order.paidAt) data.paidAt = now;
      if (firstCompletion) {
        data.completedAt = now;
        data.transferStatus = 'PENDING';
      }
      if (input.to === 'CANCELLED') data.cancelledAt = now;

      const res = await tx.order.updateMany({
        where: { id: order.id, version: order.version, status: order.status },
        data,
      });
      if (res.count === 0) {
        throw new ConflictException('La commande a été modifiée entre-temps, veuillez réessayer');
      }
      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          from: order.status,
          to: input.to,
          actorType: input.actor,
          actorId: input.actorId,
          note: input.note ?? null,
        },
      });

      // Stock : libération si la vente n'a jamais été finalisée, finalisation à la première complétion.
      if ((input.to === 'CANCELLED' || input.to === 'REFUNDED') && order.completedAt === null) {
        await releaseReservation(tx, order.productId, order.quantity);
      }
      if (firstCompletion) await finalizeSale(tx, order.productId, order.quantity);

      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (input.extra) await input.extra(tx, fresh);
      return fresh;
    });

    if (input.to === 'COMPLETED' && updated.transferStatus === 'PENDING') {
      await this.payouts.add('payout', { orderId: updated.id }, { jobId: `payout-${updated.id}` });
    }
    await this.notifyParticipants(updated, input.actorId).catch((e: unknown) =>
      this.logger.warn(`Notification de commande non envoyée : ${String(e)}`),
    );
    return updated;
  }

  private async notifyParticipants(order: Order, actorId: string | null): Promise<void> {
    const label = ORDER_STATUS_LABELS[order.status];
    const body = `Commande ${order.reference} (${formatCents(order.totalCents)}) : ${label}`;
    for (const userId of [order.buyerId, order.sellerId]) {
      if (userId === actorId) continue;
      await this.notifications.notify({
        userId,
        type: 'ORDER_UPDATE',
        title: 'Mise à jour de commande',
        body,
        data: { orderId: order.id },
      });
    }
  }
}

/**
 * Réservation atomique : réussit uniquement si la quantité disponible est suffisante
 * et l'annonce active. Le verrou de ligne posé par UPDATE empêche deux achats
 * concurrents du même article.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number,
): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE "Product"
    SET "reservedQuantity" = "reservedQuantity" + ${quantity},
        "status" = CASE WHEN "quantity" - ("reservedQuantity" + ${quantity}) <= 0
                        THEN 'RESERVED'::"ProductStatus" ELSE "status" END,
        "updatedAt" = NOW()
    WHERE "id" = ${productId}
      AND "status" = 'ACTIVE'
      AND "moderationStatus" = 'VISIBLE'
      AND "deletedAt" IS NULL
      AND "quantity" - "reservedQuantity" >= ${quantity}`;
  return count === 1;
}

export async function releaseReservation(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Product"
    SET "reservedQuantity" = GREATEST("reservedQuantity" - ${quantity}, 0),
        "status" = CASE WHEN "status" = 'RESERVED' AND "deletedAt" IS NULL
                        THEN 'ACTIVE'::"ProductStatus" ELSE "status" END,
        "updatedAt" = NOW()
    WHERE "id" = ${productId}`;
}

async function finalizeSale(
  tx: Prisma.TransactionClient,
  productId: string,
  quantity: number,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Product"
    SET "quantity" = GREATEST("quantity" - ${quantity}, 0),
        "reservedQuantity" = GREATEST("reservedQuantity" - ${quantity}, 0),
        "soldQuantity" = "soldQuantity" + ${quantity},
        "status" = CASE
          WHEN "quantity" - ${quantity} <= 0 THEN 'SOLD'::"ProductStatus"
          WHEN ("quantity" - ${quantity}) - GREATEST("reservedQuantity" - ${quantity}, 0) <= 0
            THEN 'RESERVED'::"ProductStatus"
          WHEN "status" = 'RESERVED' THEN 'ACTIVE'::"ProductStatus"
          ELSE "status" END,
        "updatedAt" = NOW()
    WHERE "id" = ${productId}`;
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Meetup, Order } from '@prisma/client';
import { MeetupDto } from '@snapmarket/shared';
import { AuthUser } from '../common/decorators/auth.decorators';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderStateService } from '../orders/order-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProposeMeetupDto } from './dto/meetup.dto';

const MAX_DAYS_AHEAD = 30;

function dto(m: Meetup): MeetupDto {
  return {
    id: m.id,
    proposedById: m.proposedById,
    scheduledAt: m.scheduledAt.toISOString(),
    locationLabel: m.locationLabel,
    notes: m.notes,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  };
}

const fmt = (d: Date) =>
  d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });

/**
 * Remise en main propre. Le lieu est un texte choisi par les participants : aucune
 * position géographique n'est collectée. Une commande n'est jamais terminée
 * automatiquement à l'heure du rendez-vous : l'acheteur doit confirmer la remise.
 */
@Injectable()
export class MeetupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly notifications: NotificationsService,
  ) {}

  async propose(user: AuthUser, orderId: string, input: ProposeMeetupDto): Promise<MeetupDto> {
    const order = await this.participantOrder(user, orderId);
    if (order.deliveryMode !== 'MEETUP')
      throw new BadRequestException('Cette commande n’est pas en main propre');
    if (order.status !== 'PAID') {
      throw new ConflictException(
        order.status === 'READY_FOR_HANDOFF'
          ? 'Un rendez-vous est déjà accepté : annulez-le avant d’en proposer un autre'
          : 'Un rendez-vous ne peut être proposé qu’après le paiement',
      );
    }
    const when = new Date(input.scheduledAt);
    const now = Date.now();
    if (when.getTime() < now + 30 * 60_000 || when.getTime() > now + MAX_DAYS_AHEAD * 86_400_000) {
      throw new BadRequestException('La date doit être comprise entre 30 minutes et 30 jours');
    }
    const meetup = await this.prisma.$transaction(async (tx) => {
      await tx.meetup.updateMany({
        where: { orderId, status: 'PROPOSED' },
        data: { status: 'CANCELLED' },
      });
      return tx.meetup.create({
        data: {
          orderId,
          proposedById: user.id,
          scheduledAt: when,
          locationLabel: input.locationLabel,
          notes: input.notes ?? null,
        },
      });
    });
    await this.notifyOther(
      order,
      user.id,
      'Proposition de rendez-vous',
      `${fmt(when)} — ${input.locationLabel}`,
    );
    return dto(meetup);
  }

  async accept(user: AuthUser, meetupId: string): Promise<MeetupDto> {
    const { meetup, order } = await this.load(user, meetupId);
    if (meetup.proposedById === user.id)
      throw new ForbiddenException('L’autre participant doit accepter');
    if (meetup.status !== 'PROPOSED')
      throw new ConflictException('Ce rendez-vous n’est plus en attente');
    if (meetup.scheduledAt < new Date()) throw new ConflictException('La date proposée est passée');
    await this.state.transition({
      orderId: order.id,
      to: 'READY_FOR_HANDOFF',
      actor: 'SYSTEM',
      actorId: user.id,
      note: 'Rendez-vous accepté',
      expectedFrom: 'PAID',
      extra: async (tx) => {
        const res = await tx.meetup.updateMany({
          where: { id: meetupId, status: 'PROPOSED' },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
        if (res.count !== 1) throw new ConflictException('Ce rendez-vous n’est plus en attente');
      },
    });
    await this.notifyOther(
      order,
      user.id,
      'Rendez-vous confirmé',
      `${fmt(meetup.scheduledAt)} — ${meetup.locationLabel}`,
    );
    return dto(await this.prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } }));
  }

  async decline(user: AuthUser, meetupId: string): Promise<MeetupDto> {
    const { meetup, order } = await this.load(user, meetupId);
    if (meetup.proposedById === user.id)
      throw new ForbiddenException('Utilisez l’annulation pour votre propre proposition');
    const res = await this.prisma.meetup.updateMany({
      where: { id: meetupId, status: 'PROPOSED' },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    if (res.count !== 1) throw new ConflictException('Ce rendez-vous n’est plus en attente');
    await this.notifyOther(
      order,
      user.id,
      'Rendez-vous refusé',
      'Proposez une autre date dans la commande.',
    );
    return dto(await this.prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } }));
  }

  async cancel(user: AuthUser, meetupId: string): Promise<MeetupDto> {
    const { meetup, order } = await this.load(user, meetupId);
    if (meetup.status === 'PROPOSED') {
      await this.prisma.meetup.update({ where: { id: meetupId }, data: { status: 'CANCELLED' } });
    } else if (meetup.status === 'ACCEPTED') {
      await this.state.transition({
        orderId: order.id,
        to: 'PAID',
        actor: 'SYSTEM',
        actorId: user.id,
        note: 'Rendez-vous annulé',
        expectedFrom: 'READY_FOR_HANDOFF',
        extra: async (tx) => {
          await tx.meetup.update({ where: { id: meetupId }, data: { status: 'CANCELLED' } });
        },
      });
    } else {
      throw new ConflictException('Ce rendez-vous ne peut pas être annulé');
    }
    await this.notifyOther(order, user.id, 'Rendez-vous annulé', 'Le rendez-vous a été annulé.');
    return dto(await this.prisma.meetup.findUniqueOrThrow({ where: { id: meetupId } }));
  }

  /** Tâche planifiée : rappel environ 2 heures avant un rendez-vous accepté. */
  async sendReminders(now = new Date()): Promise<number> {
    const soon = await this.prisma.meetup.findMany({
      where: {
        status: 'ACCEPTED',
        reminderSentAt: null,
        scheduledAt: { gt: now, lte: new Date(now.getTime() + 2 * 3600_000) },
      },
      include: { order: true },
    });
    for (const m of soon) {
      const claimed = await this.prisma.meetup.updateMany({
        where: { id: m.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;
      for (const userId of [m.order.buyerId, m.order.sellerId]) {
        await this.notifications.notify({
          userId,
          type: 'MEETUP_UPDATE',
          title: 'Rappel de rendez-vous',
          body: `${fmt(m.scheduledAt)} — ${m.locationLabel}. Après la remise, l’acheteur confirme dans la commande.`,
          data: { orderId: m.orderId },
        });
      }
    }
    return soon.length;
  }

  private async participantOrder(user: AuthUser, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id)) {
      throw new NotFoundException('Commande introuvable');
    }
    return order;
  }

  private async load(user: AuthUser, meetupId: string) {
    const meetup = await this.prisma.meetup.findUnique({
      where: { id: meetupId },
      include: { order: true },
    });
    if (!meetup || (meetup.order.buyerId !== user.id && meetup.order.sellerId !== user.id)) {
      throw new NotFoundException('Rendez-vous introuvable');
    }
    return { meetup, order: meetup.order };
  }

  private async notifyOther(
    order: Order,
    actorId: string,
    title: string,
    body: string,
  ): Promise<void> {
    const other = order.buyerId === actorId ? order.sellerId : order.buyerId;
    await this.notifications.notify({
      userId: other,
      type: 'MEETUP_UPDATE',
      title,
      body,
      data: { orderId: order.id },
    });
  }
}

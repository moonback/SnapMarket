import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import { AuthUser } from '../common/decorators/auth.decorators';
import { extractBearer, JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { conversationRoom, RealtimeService, userRoom } from '../realtime/realtime.service';
import { ConversationsService } from './conversations.service';
import { SendMessageDto } from './dto/conversation.dto';

interface SocketData {
  user: AuthUser;
  conversations: Set<string>;
}
type AuthedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; status?: number };

/**
 * Gateway temps réel. Une connexion authentifiée ne donne accès à rien en soi :
 * chaque adhésion à une conversation et chaque envoi est autorisé côté serveur.
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly auth: JwtAuthGuard,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const raw =
        (client.handshake.auth as { token?: unknown } | undefined)?.token ??
        extractBearer(client.handshake.headers.authorization);
      if (typeof raw !== 'string' || !raw) throw new UnauthorizedException();
      const user = await this.auth.resolve(raw);
      client.data.user = user;
      client.data.conversations = new Set();
      await client.join(userRoom(user.id));
    } catch {
      (client as unknown as Socket).emit('auth_error', { message: 'Authentification requise' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('conversation:join')
  async join(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<Ack> {
    return this.guard(async () => {
      const id = this.id(body?.conversationId);
      await this.conversations.assertParticipant(client.data.user.id, id);
      await client.join(conversationRoom(id));
      client.data.conversations.add(id);
    });
  }

  @SubscribeMessage('conversation:leave')
  async leave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<Ack> {
    return this.guard(async () => {
      const id = this.id(body?.conversationId);
      await client.leave(conversationRoom(id));
      client.data.conversations.delete(id);
    });
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: unknown } & Record<string, unknown>,
  ): Promise<Ack> {
    return this.guard(async () => {
      const id = this.id(body?.conversationId);
      const dto = plainToInstance(SendMessageDto, {
        body: body.body,
        mediaId: body.mediaId,
        clientMessageId: body.clientMessageId,
      });
      const errors = await validate(dto, { whitelist: true });
      if (errors.length > 0) throw Object.assign(new Error('Message invalide'), { status: 400 });
      // Le statut et la vérification email de l'expéditeur sont rechargés par le service.
      return this.conversations.send(client.data.user.id, id, dto);
    });
  }

  @SubscribeMessage('conversation:read')
  async read(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<Ack> {
    return this.guard(() =>
      this.conversations.markRead(client.data.user.id, this.id(body?.conversationId)),
    );
  }

  @SubscribeMessage('typing')
  typing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Ack {
    const id = typeof body?.conversationId === 'string' ? body.conversationId : '';
    if (!client.data.conversations?.has(id))
      return { ok: false, error: 'Conversation non rejointe' };
    (client as unknown as Socket)
      .to(conversationRoom(id))
      .emit('typing', { conversationId: id, userId: client.data.user.id });
    return { ok: true };
  }

  private id(value: unknown): string {
    if (typeof value !== 'string' || value.length < 5 || value.length > 40) {
      throw Object.assign(new Error('Identifiant de conversation invalide'), { status: 400 });
    }
    return value;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<Ack<T>> {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (e) {
      const err = e as { message?: string; status?: number; getStatus?: () => number };
      const status = err.getStatus?.() ?? err.status ?? 500;
      if (status >= 500) this.logger.error(err.message);
      return {
        ok: false,
        error: status >= 500 ? 'Erreur interne' : (err.message ?? 'Erreur'),
        status,
      };
    }
  }
}

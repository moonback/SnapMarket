import { Inject, Injectable } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { REDIS } from '../redis/redis.module';

export const userRoom = (userId: string) => `user:${userId}`;
export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;

/**
 * Émission d'événements temps réel. Dans l'API, passe par le serveur Socket.IO
 * (adaptateur Redis pour plusieurs instances) ; dans le worker, par l'émetteur Redis.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private emitter: Emitter | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  attach(server: Server): void {
    this.server = server;
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.target().to(userRoom(userId)).emit(event, payload);
  }

  toConversation(conversationId: string, event: string, payload: unknown): void {
    this.target().to(conversationRoom(conversationId)).emit(event, payload);
  }

  /** Retire les sockets d'un utilisateur d'une conversation (ex. après blocage). */
  leaveConversation(userId: string, conversationId: string): void {
    this.target().in(userRoom(userId)).socketsLeave(conversationRoom(conversationId));
  }

  private target(): Server | Emitter {
    if (this.server) return this.server;
    this.emitter ??= new Emitter(this.redis.duplicate());
    return this.emitter;
  }
}

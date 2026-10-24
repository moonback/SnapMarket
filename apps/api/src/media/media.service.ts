import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Media, MediaKind, MediaPurpose, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { MEDIA_LIMITS, MediaDto, UploadTicket } from '@snapmarket/shared';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { DeleteObjectsJob, MediaJob, QUEUE_MEDIA } from '../queue/queues';
import { CreateUploadDto } from './dto/media.dto';
import { StorageService } from './storage.service';

/** Vidéos autorisées uniquement pour les stories et les annonces. */
const VIDEO_PURPOSES: MediaPurpose[] = ['STORY', 'PRODUCT'];

export function kindForMime(mime: string): MediaKind | null {
  if ((MEDIA_LIMITS.IMAGE.mimeTypes as readonly string[]).includes(mime)) return 'IMAGE';
  if ((MEDIA_LIMITS.VIDEO.mimeTypes as readonly string[]).includes(mime)) return 'VIDEO';
  return null;
}

export function finalKey(media: Pick<Media, 'id' | 'ownerId' | 'purpose'>, suffix = ''): string {
  const visibility = media.purpose === 'MESSAGE' ? 'private' : 'public';
  return `${visibility}/${media.purpose.toLowerCase()}/${media.ownerId}/${media.id}${suffix}`;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(QUEUE_MEDIA) private readonly queue: Queue<MediaJob | DeleteObjectsJob>,
  ) {}

  async createUpload(ownerId: string, dto: CreateUploadDto): Promise<UploadTicket> {
    const kind = kindForMime(dto.mimeType);
    if (!kind) throw new BadRequestException('Type de fichier non autorisé');
    const limits = MEDIA_LIMITS[kind];
    if (dto.sizeBytes > limits.maxBytes) {
      throw new BadRequestException(
        `Fichier trop volumineux (maximum ${Math.round(limits.maxBytes / 1024 / 1024)} Mo)`,
      );
    }
    if (kind === 'VIDEO') {
      if (!VIDEO_PURPOSES.includes(dto.purpose)) {
        throw new BadRequestException('Les vidéos ne sont pas autorisées pour cet usage');
      }
      if (!dto.durationSeconds) throw new BadRequestException('Durée de la vidéo requise');
    }
    // Limite simple contre l'abus : 50 téléversements en attente par utilisateur.
    const pending = await this.prisma.media.count({
      where: { ownerId, status: 'PENDING_UPLOAD' },
    });
    if (pending >= 50) throw new BadRequestException('Trop de téléversements en attente');

    const media = await this.prisma.media.create({
      data: {
        ownerId,
        kind,
        purpose: dto.purpose,
        mimeType: dto.mimeType,
        declaredBytes: dto.sizeBytes,
        durationSeconds: dto.durationSeconds ?? null,
        storageKey: `uploads/${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const uploadUrl = await this.storage.createUploadUrl(
      media.storageKey,
      dto.mimeType,
      dto.sizeBytes,
    );
    return {
      mediaId: media.id,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': dto.mimeType },
      expiresAt: new Date(Date.now() + this.config.s3.uploadTtlSeconds * 1000).toISOString(),
    };
  }

  /** Vérifie l'objet réellement téléversé puis déclenche le traitement asynchrone. */
  async complete(ownerId: string, mediaId: string): Promise<MediaDto> {
    const media = await this.getOwned(ownerId, mediaId);
    if (media.status !== 'PENDING_UPLOAD') return this.toDto(media);
    const head = await this.storage.head(media.storageKey);
    if (!head) throw new UnprocessableEntityException('Fichier non reçu par le stockage');
    const limits = MEDIA_LIMITS[media.kind];
    if (head.contentLength > limits.maxBytes || head.contentLength !== media.declaredBytes) {
      await this.markFailed(media, 'Taille réelle non conforme');
      throw new UnprocessableEntityException('Taille du fichier non conforme');
    }
    if (head.contentType && head.contentType !== media.mimeType) {
      await this.markFailed(media, 'Type réel non conforme');
      throw new UnprocessableEntityException('Type de fichier non conforme');
    }
    const updated = await this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'PROCESSING', actualBytes: head.contentLength },
    });
    await this.queue.add('process', { mediaId: media.id }, { jobId: `process-${media.id}` });
    return this.toDto(updated);
  }

  async get(ownerId: string, mediaId: string): Promise<MediaDto> {
    return this.toDto(await this.getOwned(ownerId, mediaId));
  }

  async remove(ownerId: string, mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({
      where: { id: mediaId },
      include: { productMedia: true, story: true, avatarOf: true },
    });
    if (!media || media.ownerId !== ownerId) throw new NotFoundException('Média introuvable');
    if (media.productMedia || media.story || media.avatarOf) {
      throw new BadRequestException('Ce média est utilisé');
    }
    await this.softDelete([media.id]);
  }

  /** Marque des médias supprimés et planifie la suppression des objets. */
  async softDelete(ids: string[], tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    if (ids.length === 0) return;
    const rows = await tx.media.findMany({ where: { id: { in: ids } } });
    await tx.media.updateMany({
      where: { id: { in: ids } },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    const keys = rows.flatMap((m) =>
      [m.storageKey, m.thumbnailKey].filter((k): k is string => !!k),
    );
    if (keys.length > 0) await this.queue.add('delete-objects', { keys });
  }

  /**
   * Vérifie que des médias appartiennent à l'utilisateur, ont le bon usage et sont
   * téléversés (en traitement ou prêts). Retourne les médias dans l'ordre demandé.
   */
  async assertUsable(ownerId: string, ids: string[], purpose: MediaPurpose): Promise<Media[]> {
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Médias en double');
    const rows = await this.prisma.media.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((m) => [m.id, m]));
    return ids.map((id) => {
      const m = byId.get(id);
      if (!m || m.ownerId !== ownerId) throw new BadRequestException(`Média invalide : ${id}`);
      if (m.purpose !== purpose) throw new BadRequestException('Usage du média incompatible');
      if (m.status !== 'READY' && m.status !== 'PROCESSING') {
        throw new BadRequestException('Média non téléversé ou en échec');
      }
      return m;
    });
  }

  async toDto(media: Media): Promise<MediaDto> {
    const ready = media.status === 'READY' && this.storage.configured;
    return {
      id: media.id,
      kind: media.kind,
      status: media.status,
      url: ready ? await this.storage.readUrl(media.storageKey) : null,
      thumbnailUrl:
        ready && media.thumbnailKey ? await this.storage.readUrl(media.thumbnailKey) : null,
      width: media.width,
      height: media.height,
      durationSeconds:
        media.kind === 'VIDEO' && media.status === 'READY' ? media.durationSeconds : null,
    };
  }

  private async getOwned(ownerId: string, mediaId: string): Promise<Media> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) throw new NotFoundException('Média introuvable');
    if (media.ownerId !== ownerId) throw new ForbiddenException('Accès refusé');
    return media;
  }

  private async markFailed(media: Media, reason: string): Promise<void> {
    await this.prisma.media.update({
      where: { id: media.id },
      data: { status: 'FAILED', failureReason: reason },
    });
    await this.queue.add('delete-objects', { keys: [media.storageKey] });
  }
}

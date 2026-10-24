import { Inject, Injectable, Logger } from '@nestjs/common';
import { Media } from '@prisma/client';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { finalKey } from './media.service';
import { StorageService } from './storage.service';
import { assertAcceptable, extractPoster, probeVideo, transcodeVideo } from './video-transcoder';

const MAX_DIMENSION = 2048;
const THUMB_DIMENSION = 480;

/** Traitement des médias, exécuté par le worker (jamais dans la requête HTTP). */
@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async process(mediaId: string): Promise<void> {
    const media = await this.prisma.media.findUnique({ where: { id: mediaId } });
    if (!media || media.status !== 'PROCESSING') return;
    try {
      if (media.kind === 'IMAGE') {
        const input = await this.storage.getBuffer(media.storageKey);
        // sharp échoue si le contenu n'est pas réellement une image (vérification du contenu).
        const meta = await sharp(input, { failOn: 'error' }).metadata();
        if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) {
          throw new Error(`Format d’image non pris en charge : ${meta.format ?? 'inconnu'}`);
        }
        // rotate() applique l'orientation EXIF ; les métadonnées (dont la position GPS)
        // ne sont pas recopiées dans le fichier de sortie.
        const { data, info } = await sharp(input)
          .rotate()
          .resize({
            width: MAX_DIMENSION,
            height: MAX_DIMENSION,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        const thumb = await sharp(data)
          .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside' })
          .webp({ quality: 75 })
          .toBuffer();
        const key = finalKey(media);
        const thumbKey = finalKey(media, '_thumb');
        await this.storage.put(key, data, 'image/jpeg');
        await this.storage.put(thumbKey, thumb, 'image/webp');
        await this.storage.deleteMany([media.storageKey]);
        await this.prisma.media.update({
          where: { id: media.id },
          data: {
            status: 'READY',
            storageKey: key,
            thumbnailKey: thumbKey,
            mimeType: 'image/jpeg',
            width: info.width,
            height: info.height,
            actualBytes: data.length,
          },
        });
      } else {
        await this.processVideo(media);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Échec du traitement du média ${media.id} : ${reason}`);
      await this.prisma.media.update({
        where: { id: media.id },
        data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      });
      await this.storage.deleteMany([media.storageKey]).catch(() => undefined);
    }
  }

  /**
   * Vidéo : mesure de la durée réelle (ffprobe), refus au-delà de la limite, transcodage
   * H.264/AAC sans métadonnées, image d'aperçu. Les fichiers temporaires sont supprimés
   * à la fin du traitement : rien n'est conservé sur le disque du worker.
   */
  private async processVideo(media: Media): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'snapmarket-video-'));
    try {
      const input = join(dir, 'input');
      const output = join(dir, 'output.mp4');
      const poster = join(dir, 'poster.jpg');
      await this.storage.downloadToFile(media.storageKey, input);
      const probe = await probeVideo(input, this.config.video);
      assertAcceptable(probe);
      const size = await transcodeVideo(input, output, probe, this.config.video);
      const result = await probeVideo(output, this.config.video);
      await extractPoster(output, poster, result.durationSeconds, this.config.video);
      const thumb = await sharp(poster)
        .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside' })
        .webp({ quality: 75 })
        .toBuffer();
      const key = finalKey(media);
      const thumbKey = finalKey(media, '_thumb');
      await this.storage.putFile(key, output, 'video/mp4');
      await this.storage.put(thumbKey, thumb, 'image/webp');
      await this.storage.deleteMany([media.storageKey]);
      await this.prisma.media.update({
        where: { id: media.id },
        data: {
          status: 'READY',
          storageKey: key,
          thumbnailKey: thumbKey,
          mimeType: 'video/mp4',
          width: size.width,
          height: size.height,
          // Durée réelle mesurée (remplace la durée déclarée par le client).
          durationSeconds: Math.max(1, Math.round(result.durationSeconds)),
          actualBytes: (await stat(output)).size,
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

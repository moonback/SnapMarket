import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { finalKey } from './media.service';
import { StorageService } from './storage.service';

const MAX_DIMENSION = 2048;
const THUMB_DIMENSION = 480;

/** Traitement des médias, exécuté par le worker (jamais dans la requête HTTP). */
@Injectable()
export class MediaProcessorService {
  private readonly logger = new Logger(MediaProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
        // Vidéo : vérification de la signature ISO-BMFF (« ftyp ») sans transcodage.
        const header = await this.storage.getRange(media.storageKey, 0, 11);
        if (header.length < 12 || header.subarray(4, 8).toString('ascii') !== 'ftyp') {
          throw new Error('Le fichier n’est pas une vidéo MP4/MOV valide');
        }
        const key = finalKey(media);
        await this.storage.copy(media.storageKey, key, media.mimeType);
        await this.storage.deleteMany([media.storageKey]);
        await this.prisma.media.update({
          where: { id: media.id },
          data: { status: 'READY', storageKey: key },
        });
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
}

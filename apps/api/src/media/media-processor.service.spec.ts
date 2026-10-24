import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { MediaProcessorService } from './media-processor.service';
import { probeVideo, targetSize } from './video-transcoder';

const video = {
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  maxDimension: 1280,
  timeoutSeconds: 120,
};
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const tmp = mkdtempSync(join(tmpdir(), 'sm-test-'));

/** Génère une vidéo de test réelle avec ffmpeg (mire + son). */
function makeVideo(name: string, args: string[]): Buffer {
  const out = join(tmp, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, out]);
  return readFileSync(out);
}

describe('MediaProcessorService (sharp réel)', () => {
  function setup(media: Record<string, unknown>, input: Buffer) {
    const objects = new Map<string, Buffer>([[media.storageKey as string, input]]);
    const updates: Record<string, unknown>[] = [];
    const storage = {
      getBuffer: async (k: string) => objects.get(k)!,
      getRange: async (k: string, s: number, e: number) => objects.get(k)!.subarray(s, e + 1),
      put: async (k: string, b: Buffer) => void objects.set(k, b),
      downloadToFile: async (k: string, path: string) => writeFileSync(path, objects.get(k)!),
      putFile: async (k: string, path: string) => void objects.set(k, readFileSync(path)),
      copy: async (a: string, b: string) => void objects.set(b, objects.get(a)!),
      deleteMany: async (keys: string[]) => keys.forEach((k) => objects.delete(k)),
    };
    const prisma = {
      media: {
        findUnique: async () => media,
        update: async ({ data }: { data: Record<string, unknown> }) => updates.push(data),
      },
    };
    return {
      service: new MediaProcessorService(prisma as never, storage as never, { video } as never),
      objects,
      updates,
    };
  }

  const base = {
    id: 'm1',
    ownerId: 'u1',
    purpose: 'PRODUCT',
    status: 'PROCESSING',
    storageKey: 'uploads/u1/x',
  };

  it('redimensionne, génère une miniature et supprime les métadonnées EXIF (dont GPS)', async () => {
    const input = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#7857FF' },
    })
      .jpeg()
      .withExif({
        IFD0: { Copyright: 'secret-owner' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 24/1' },
      })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { service, objects, updates } = setup(
      { ...base, kind: 'IMAGE', mimeType: 'image/jpeg' },
      input,
    );
    await service.process('m1');
    expect(updates[0]).toMatchObject({
      status: 'READY',
      width: 2048,
      height: 1024,
      storageKey: 'public/product/u1/m1',
    });
    const out = objects.get('public/product/u1/m1')!;
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(out.includes(Buffer.from('secret-owner'))).toBe(false);
    expect((await sharp(objects.get('public/product/u1/m1_thumb')!).metadata()).width).toBe(480);
    expect(objects.has('uploads/u1/x')).toBe(false);
  });

  it('marque en échec un fichier qui n’est pas une image', async () => {
    const { service, updates } = setup(
      { ...base, kind: 'IMAGE', mimeType: 'image/jpeg' },
      Buffer.from('<?php echo 1; ?>'),
    );
    await service.process('m1');
    expect(updates[0]).toMatchObject({ status: 'FAILED' });
  });

  const itVideo = hasFfmpeg ? it : it.skip;
  const videoBase = { ...base, kind: 'VIDEO', mimeType: 'video/quicktime', purpose: 'STORY' };

  itVideo(
    'mesure la durée réelle, transcode en H.264/AAC et supprime les métadonnées',
    async () => {
      const input = makeVideo('in.mov', [
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=1920x1080:rate=30:duration=3',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=3',
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-shortest',
        '-metadata',
        'location=+48.8566+002.3522/',
        '-metadata',
        'title=secret-title',
      ]);
      const { service, objects, updates } = setup({ ...videoBase, durationSeconds: 59 }, input);
      await service.process('m1');
      expect(updates[0]).toMatchObject({
        status: 'READY',
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSeconds: 3, // et non la durée déclarée (59)
        storageKey: 'public/story/u1/m1',
        thumbnailKey: 'public/story/u1/m1_thumb',
      });
      const outFile = join(tmp, 'out.mp4');
      writeFileSync(outFile, objects.get('public/story/u1/m1')!);
      const probe = await probeVideo(outFile, video);
      expect(probe).toMatchObject({ videoCodec: 'h264', hasAudio: true, width: 1280, height: 720 });
      const tags = execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format_tags',
        '-of',
        'json',
        outFile,
      ]).toString();
      expect(tags).not.toContain('location');
      expect(tags).not.toContain('secret-title');
      expect((await sharp(objects.get('public/story/u1/m1_thumb')!).metadata()).format).toBe(
        'webp',
      );
      expect(objects.has('uploads/u1/x')).toBe(false);
    },
  );

  itVideo('refuse une vidéo plus longue que la limite, même déclarée courte', async () => {
    const input = makeVideo('long.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=64x64:rate=5:duration=75',
      '-c:v',
      'libx264',
    ]);
    const { service, updates } = setup(
      { ...videoBase, mimeType: 'video/mp4', durationSeconds: 10 },
      input,
    );
    await service.process('m1');
    expect(updates[0]).toMatchObject({ status: 'FAILED' });
    expect(String(updates[0]!.failureReason)).toContain('trop longue');
  });

  itVideo('applique la rotation des vidéos portrait', async () => {
    makeVideo('landscape.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25:duration=1',
      '-c:v',
      'libx264',
    ]);
    // Matrice d'affichage « 90° », comme les vidéos portrait enregistrées par un téléphone.
    const input = makeVideo('rot.mp4', [
      '-display_rotation',
      '90',
      '-i',
      join(tmp, 'landscape.mp4'),
      '-c',
      'copy',
    ]);
    const { service, updates } = setup({ ...videoBase, mimeType: 'video/mp4' }, input);
    await service.process('m1');
    expect(updates[0]).toMatchObject({ status: 'READY', width: 360, height: 640 });
  });

  itVideo('marque en échec un fichier qui n’est pas une vidéo', async () => {
    const { service, updates } = setup(
      { ...videoBase, mimeType: 'video/mp4' },
      Buffer.from('not a video at all'),
    );
    await service.process('m1');
    expect(updates[0]).toMatchObject({ status: 'FAILED' });
  });

  it('calcule des dimensions paires sans agrandir', () => {
    expect(targetSize(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(targetSize(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
    expect(targetSize(641, 359, 1280)).toEqual({ width: 640, height: 358 });
  });
});

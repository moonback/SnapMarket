import sharp from 'sharp';
import { MediaProcessorService } from './media-processor.service';

describe('MediaProcessorService (sharp réel)', () => {
  function setup(media: Record<string, unknown>, input: Buffer) {
    const objects = new Map<string, Buffer>([[media.storageKey as string, input]]);
    const updates: Record<string, unknown>[] = [];
    const storage = {
      getBuffer: async (k: string) => objects.get(k)!,
      getRange: async (k: string, s: number, e: number) => objects.get(k)!.subarray(s, e + 1),
      put: async (k: string, b: Buffer) => void objects.set(k, b),
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
      service: new MediaProcessorService(prisma as never, storage as never),
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

  it('vérifie la signature d’une vidéo MP4', async () => {
    const fakeMp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypisom'),
      Buffer.alloc(32),
    ]);
    const ok = setup({ ...base, kind: 'VIDEO', mimeType: 'video/mp4', purpose: 'STORY' }, fakeMp4);
    await ok.service.process('m1');
    expect(ok.updates[0]).toMatchObject({ status: 'READY', storageKey: 'public/story/u1/m1' });
    const bad = setup(
      { ...base, kind: 'VIDEO', mimeType: 'video/mp4' },
      Buffer.from('not a video at all'),
    );
    await bad.service.process('m1');
    expect(bad.updates[0]).toMatchObject({ status: 'FAILED' });
  });
});

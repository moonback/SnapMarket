import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { APP_CONFIG, AppConfig } from '../config/configuration';

export interface ObjectHead {
  contentLength: number;
  contentType: string | null;
}

/**
 * Accès au stockage objet S3 compatible. Aucun fichier n'est écrit sur le disque
 * du serveur : les clients téléversent directement via URL présignée.
 */
@Injectable()
export class StorageService {
  private client: S3Client | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    const { bucket, accessKeyId, secretAccessKey } = this.config.s3;
    return Boolean(bucket && accessKeyId && secretAccessKey);
  }

  private s3(): S3Client {
    if (!this.configured) {
      throw new ServiceUnavailableException({
        message: 'Le stockage des médias n’est pas configuré',
        code: 'MEDIA_STORAGE_UNAVAILABLE',
      });
    }
    if (!this.client) {
      const c = this.config.s3;
      this.client = new S3Client({
        region: c.region,
        endpoint: c.endpoint ?? undefined,
        forcePathStyle: c.forcePathStyle,
        // Sommes de contrôle uniquement quand l'opération l'exige : évite l'encodage
        // « aws-chunked » des envois en flux, mal pris en charge par certains stockages
        // compatibles S3 (le fichier serait stocké avec son cadrage).
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: { accessKeyId: c.accessKeyId!, secretAccessKey: c.secretAccessKey! },
      });
    }
    return this.client;
  }

  private get bucket(): string {
    return this.config.s3.bucket!;
  }

  /** URL PUT présignée ; Content-Type et Content-Length font partie de la signature. */
  async createUploadUrl(key: string, contentType: string, contentLength: number): Promise<string> {
    return getSignedUrl(
      this.s3(),
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      {
        expiresIn: this.config.s3.uploadTtlSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.s3().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentLength: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (e: unknown) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw e;
    }
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Objet vide : ${key}`);
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async getRange(key: string, start: number, end: number): Promise<Buffer> {
    const res = await this.s3().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }),
    );
    if (!res.Body) return Buffer.alloc(0);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  /** Télécharge un objet vers un fichier temporaire (traitement vidéo du worker). */
  async downloadToFile(key: string, path: string): Promise<void> {
    const res = await this.s3().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Objet vide : ${key}`);
    await pipeline(res.Body as Readable, createWriteStream(path));
  }

  async putFile(key: string, path: string, contentType: string): Promise<void> {
    const { size } = await stat(path);
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async copy(sourceKey: string, targetKey: string, contentType: string): Promise<void> {
    await this.s3().send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: targetKey,
        ContentType: contentType,
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    for (let i = 0; i < keys.length; i += 1000) {
      await this.s3().send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async signedGetUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3(), new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: this.config.s3.downloadTtlSeconds,
    });
  }

  /** URL de lecture : CDN pour les objets publics s'il est configuré, sinon URL présignée. */
  async readUrl(key: string): Promise<string> {
    if (key.startsWith('public/') && this.config.s3.cdnUrl) {
      return `${this.config.s3.cdnUrl.replace(/\/$/, '')}/${key}`;
    }
    return this.signedGetUrl(key);
  }
}

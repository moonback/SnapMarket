import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MEDIA_LIMITS } from '@snapmarket/shared';

const run = promisify(execFile);

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  hasAudio: boolean;
}

export interface TranscoderOptions {
  ffmpegPath: string;
  ffprobePath: string;
  maxDimension: number;
  timeoutSeconds: number;
}

/** Tolérance sur la durée maximale (arrondis des conteneurs). */
const DURATION_TOLERANCE_SECONDS = 0.5;

interface FfprobeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    duration?: string;
    side_data_list?: { rotation?: number }[];
    tags?: { rotate?: string };
  }[];
}

/**
 * Analyse le fichier réellement reçu : la durée déclarée par le client n'est qu'une
 * indication, seule la durée mesurée ici fait foi.
 */
export async function probeVideo(file: string, opts: TranscoderOptions): Promise<VideoProbe> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      opts.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('Transcodage vidéo indisponible (ffprobe introuvable)');
    throw new Error('Le fichier n’est pas une vidéo lisible');
  }
  const data = JSON.parse(stdout) as FfprobeOutput;
  const video = data.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('Aucune piste vidéo détectée');
  const duration = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Durée de la vidéo illisible');
  // Les vidéos de téléphone portrait sont souvent stockées en paysage avec une rotation.
  const rotation = Math.abs(
    Number(
      video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        video.tags?.rotate ??
        0,
    ),
  );
  const swap = rotation === 90 || rotation === 270;
  return {
    durationSeconds: duration,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    videoCodec: video.codec_name ?? 'inconnu',
    hasAudio: data.streams?.some((s) => s.codec_type === 'audio') ?? false,
  };
}

export function assertAcceptable(probe: VideoProbe): void {
  const max = MEDIA_LIMITS.VIDEO.maxDurationSeconds;
  if (probe.durationSeconds > max + DURATION_TOLERANCE_SECONDS) {
    throw new Error(`Vidéo trop longue (${Math.round(probe.durationSeconds)} s, maximum ${max} s)`);
  }
  if (probe.width > 8192 || probe.height > 8192)
    throw new Error('Résolution vidéo non prise en charge');
}

/** Dimensions de sortie : tient dans maxDimension × maxDimension, sans agrandir, valeurs paires. */
export function targetSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.floor((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Transcodage en MP4 H.264 / AAC lisible partout (iOS, Android), « faststart » pour la lecture
 * progressive. Toutes les métadonnées (dont la localisation des vidéos de téléphone) sont supprimées.
 */
export async function transcodeVideo(
  input: string,
  output: string,
  probe: VideoProbe,
  opts: TranscoderOptions,
): Promise<{ width: number; height: number }> {
  const size = targetSize(probe.width, probe.height, opts.maxDimension);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    ...(probe.hasAudio ? ['-map', '0:a:0'] : []),
    '-t',
    String(MEDIA_LIMITS.VIDEO.maxDurationSeconds),
    '-vf',
    `scale=${size.width}:${size.height}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '26',
    '-profile:v',
    'main',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-movflags',
    '+faststart',
    output,
  ];
  await ffmpeg(args, opts);
  return size;
}

/** Image d'aperçu extraite de la vidéo transcodée. */
export async function extractPoster(
  video: string,
  output: string,
  durationSeconds: number,
  opts: TranscoderOptions,
): Promise<void> {
  const at = Math.min(1, durationSeconds / 2).toFixed(2);
  await ffmpeg(
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      at,
      '-i',
      video,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      output,
    ],
    opts,
  );
}

async function ffmpeg(args: string[], opts: TranscoderOptions): Promise<void> {
  try {
    await run(opts.ffmpegPath, args, {
      timeout: opts.timeoutSeconds * 1000,
      maxBuffer: 4 * 1024 * 1024,
      killSignal: 'SIGKILL',
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    if (err.code === 'ENOENT')
      throw new Error('Transcodage vidéo indisponible (ffmpeg introuvable)');
    if (err.killed) throw new Error('Transcodage interrompu (délai dépassé)');
    throw new Error(`Échec du transcodage : ${(err.stderr ?? err.message).slice(0, 200)}`);
  }
}

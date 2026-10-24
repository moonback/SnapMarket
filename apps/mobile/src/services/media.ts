import * as ImagePicker from 'expo-image-picker';
import { MEDIA_LIMITS, MediaDto, MediaPurpose, UploadTicket } from '@snapmarket/shared';
import { api, ApiError } from './api';

export interface PickedAsset {
  uri: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  kind: 'IMAGE' | 'VIDEO';
}

async function toPicked(asset: ImagePicker.ImagePickerAsset): Promise<PickedAsset> {
  const isVideo = asset.type === 'video';
  let size = asset.fileSize ?? 0;
  if (!size) size = (await (await fetch(asset.uri)).blob()).size;
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
    size,
    width: asset.width,
    height: asset.height,
    durationSeconds: isVideo && asset.duration ? Math.ceil(asset.duration / 1000) : undefined,
    kind: isVideo ? 'VIDEO' : 'IMAGE',
  };
}

/** Sélection dans la galerie. Les images sont réencodées en JPEG par le sélecteur. */
export async function pickFromLibrary(opts: {
  multiple?: boolean;
  allowVideo?: boolean;
  limit?: number;
}): Promise<PickedAsset[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Autorisez l’accès à vos photos dans les réglages.');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: opts.allowVideo ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: opts.multiple ?? false,
    selectionLimit: opts.limit ?? 1,
    quality: 0.85,
    videoMaxDuration: MEDIA_LIMITS.VIDEO.maxDurationSeconds,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (res.canceled) return [];
  return Promise.all(res.assets.map(toPicked));
}

export async function takePhoto(): Promise<PickedAsset | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Autorisez l’accès à l’appareil photo dans les réglages.');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
  if (res.canceled || !res.assets[0]) return null;
  return toPicked(res.assets[0]);
}

export function validateAsset(asset: PickedAsset): string | null {
  const limits = MEDIA_LIMITS[asset.kind];
  if (!(limits.mimeTypes as readonly string[]).includes(asset.mimeType))
    return 'Format de fichier non pris en charge';
  if (asset.size > limits.maxBytes)
    return `Fichier trop volumineux (max ${Math.round(limits.maxBytes / 1024 / 1024)} Mo)`;
  if (
    asset.kind === 'VIDEO' &&
    (asset.durationSeconds ?? 0) > MEDIA_LIMITS.VIDEO.maxDurationSeconds
  ) {
    return `Vidéo trop longue (max ${MEDIA_LIMITS.VIDEO.maxDurationSeconds} s)`;
  }
  return null;
}

/**
 * Téléversement sécurisé : ticket signé par l'API → envoi direct au stockage objet →
 * finalisation (l'API vérifie la taille et le type réels puis traite le fichier).
 */
export async function uploadAsset(asset: PickedAsset, purpose: MediaPurpose): Promise<MediaDto> {
  const invalid = validateAsset(asset);
  if (invalid) throw new Error(invalid);
  const ticket = await api.request<UploadTicket>('/media/uploads', {
    method: 'POST',
    body: {
      mimeType: asset.mimeType,
      sizeBytes: asset.size,
      purpose,
      durationSeconds: asset.durationSeconds,
    },
  });
  const blob = await (await fetch(asset.uri)).blob();
  const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: blob });
  if (!put.ok) throw new ApiError(put.status, 'Le téléversement a échoué');
  return api.request<MediaDto>(`/media/${ticket.mediaId}/complete`, { method: 'POST' });
}

/** Attend la fin du traitement serveur (miniature, suppression des métadonnées). */
export async function waitUntilReady(mediaId: string, timeoutMs = 30_000): Promise<MediaDto> {
  const start = Date.now();
  for (;;) {
    const media = await api.request<MediaDto>(`/media/${mediaId}`);
    if (media.status === 'READY') return media;
    if (media.status === 'FAILED') throw new Error('Le fichier n’a pas pu être traité');
    if (Date.now() - start > timeoutMs) return media;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

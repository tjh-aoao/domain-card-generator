import type { CardData, SavedCard } from './types';

export const IMAGE_IMPORT_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif';
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif',
};

export type ImageMatchStatus = 'matched' | 'unsupported' | 'unmatched' | 'duplicate-card' | 'duplicate-image' | 'existing';
export interface ImageMatch {
  fileIndex: number;
  fileName: string;
  status: ImageMatchStatus;
  card?: SavedCard;
}

// Preserve punctuation and internal spaces: similar names must not silently collide.
export const normalizeImageMatchName = (name: string) => name.normalize('NFKC').trim().toLowerCase();
const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() || '';
const imageTypeOf = (name: string) => {
  const extension = extensionOf(name);
  return Object.hasOwn(IMAGE_TYPES, extension) ? IMAGE_TYPES[extension] : undefined;
};

export function matchCardImages(files: readonly { name: string }[], cards: readonly SavedCard[], replaceExisting = true): ImageMatch[] {
  const cardsByName = new Map<string, SavedCard[]>();
  for (const card of cards) {
    const key = normalizeImageMatchName(card.cardData.name);
    if (key) cardsByName.set(key, [...(cardsByName.get(key) || []), card]);
  }
  const keys = files.map(file => normalizeImageMatchName(file.name.replace(/\.[^.]+$/, '')));
  const counts = new Map<string, number>();
  files.forEach((file, index) => {
    if (imageTypeOf(file.name)) counts.set(keys[index], (counts.get(keys[index]) || 0) + 1);
  });

  return files.map((file, fileIndex) => {
    const base = { fileIndex, fileName: file.name };
    if (!imageTypeOf(file.name)) return { ...base, status: 'unsupported' };
    const candidates = cardsByName.get(keys[fileIndex]) || [];
    if (!candidates.length) return { ...base, status: 'unmatched' };
    if (candidates.length > 1) return { ...base, status: 'duplicate-card' };
    const card = candidates[0];
    if ((counts.get(keys[fileIndex]) || 0) > 1) return { ...base, card, status: 'duplicate-image' };
    if (!replaceExisting && card.cardData.image.trim()) return { ...base, card, status: 'existing' };
    return { ...base, card, status: 'matched' };
  });
}

export function withImportedImage(card: CardData, image: string): CardData {
  return { ...card, image, imageScale: 1, imageOffset: { x: 0, y: 0 } };
}

export async function readCardImage(file: File): Promise<string> {
  const type = imageTypeOf(file.name);
  if (!type) throw new Error('不支持的图片格式');
  const blob = new Blob([file], { type });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取失败'));
    reader.onabort = () => reject(new Error('读取中断'));
    reader.readAsDataURL(blob);
  });
}

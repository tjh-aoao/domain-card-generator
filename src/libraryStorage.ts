import { isRecord, normalizeSavedCard } from './cardData';
import type { LibraryGroup, SavedCard } from './types';

export interface CardLibrary {
  cards: SavedCard[];
  groups: LibraryGroup[];
}

const DATABASE_NAME = 'spirit-card-library';
const STORE_NAME = 'library';
const RECORD_KEY = 'current';
const LEGACY_CARDS_KEY = 'spirit_card_library';
const LEGACY_GROUPS_KEY = 'spirit_card_library_groups';

// Serialize migration and writes so an older autosave cannot overwrite a newer import.
let operations: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.catch(() => undefined);
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('请关闭其他卡牌生成器页面后重试。'));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function readRecord(): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('牌库读取中断'));
      transaction.onerror = () => reject(transaction.error || new Error('牌库读取失败'));
    });
  } finally {
    database.close();
  }
}

async function writeRecord(library: CardLibrary): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('牌库保存中断'));
      transaction.onerror = () => reject(transaction.error || new Error('牌库保存失败'));
      transaction.objectStore(STORE_NAME).put(library, RECORD_KEY);
    });
  } finally {
    database.close();
  }
}

function normalizeLibrary(cards: unknown[], groups: unknown[]): CardLibrary {
  const normalizedCards = cards.map(normalizeSavedCard);
  // Never silently drop unreadable records during a storage migration.
  if (normalizedCards.some(card => !card)) throw new Error('牌库中存在无法读取的卡牌，原始数据已保留。');
  const normalizedGroups = groups.map(group => {
    if (!isRecord(group) || typeof group.id !== 'string' || typeof group.name !== 'string') {
      throw new Error('分组数据无法读取，原始数据已保留。');
    }
    return { id: group.id, name: group.name, createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now() };
  });
  return { cards: normalizedCards as SavedCard[], groups: normalizedGroups };
}

export function loadCardLibrary(): Promise<CardLibrary> {
  return enqueue(async () => {
    const stored = await readRecord();
    if (stored !== undefined) {
      if (!isRecord(stored) || !Array.isArray(stored.cards) || !Array.isArray(stored.groups)) {
        throw new Error('本地牌库格式无法读取，原始数据已保留。');
      }
      return normalizeLibrary(stored.cards, stored.groups);
    }

    const rawCards = localStorage.getItem(LEGACY_CARDS_KEY);
    const rawGroups = localStorage.getItem(LEGACY_GROUPS_KEY);
    const legacy = rawCards ? JSON.parse(rawCards) : [];
    const cards = Array.isArray(legacy) ? legacy : isRecord(legacy) ? legacy.cards : undefined;
    const groups = rawGroups ? JSON.parse(rawGroups) : isRecord(legacy) ? legacy.groups ?? [] : [];
    if (!Array.isArray(cards) || !Array.isArray(groups)) throw new Error('旧牌库格式无法读取，原始数据已保留。');
    const library = normalizeLibrary(cards, groups);
    await writeRecord(library);
    // Only release the old, small storage area after the complete transaction commits.
    try {
      if (localStorage.getItem(LEGACY_CARDS_KEY) === rawCards) localStorage.removeItem(LEGACY_CARDS_KEY);
      if (localStorage.getItem(LEGACY_GROUPS_KEY) === rawGroups) localStorage.removeItem(LEGACY_GROUPS_KEY);
    } catch { /* The new database remains authoritative if cleanup is unavailable. */ }
    return library;
  });
}

export function saveCardLibrary(library: CardLibrary): Promise<void> {
  return enqueue(() => writeRecord(library));
}

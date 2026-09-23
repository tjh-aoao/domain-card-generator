import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { loadCardLibrary, saveCardLibrary, type CardLibrary } from './libraryStorage';
import type { LibraryGroup, SavedCard } from './types';

const EMPTY_CARDS: SavedCard[] = [];
const EMPTY_GROUPS: LibraryGroup[] = [];

export function useCardLibrary() {
  const [library, setLibrary] = useState<CardLibrary | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const persisted = useRef<CardLibrary | null>(null);
  const saveVersion = useRef(0);

  useEffect(() => {
    let active = true;
    loadCardLibrary().then(loaded => {
      if (!active) return;
      persisted.current = loaded;
      setLibrary(loaded);
    }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : '浏览器无法读取本地牌库。');
    });
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (snapshot: CardLibrary) => {
    const version = ++saveVersion.current;
    setIsSaving(true);
    setSaveError('');
    try {
      await saveCardLibrary(snapshot);
      persisted.current = snapshot;
      return true;
    } catch (error) {
      if (version === saveVersion.current) {
        setSaveError(error instanceof DOMException && error.name === 'QuotaExceededError'
          ? '设备可用存储空间不足，修改尚未保存。请先备份 JSON，再释放磁盘空间后重试。'
          : '牌库保存失败，修改尚未保存。请重试保存，或先备份 JSON。');
      }
      return false;
    } finally {
      if (version === saveVersion.current) setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    if (library && library !== persisted.current) void persist(library);
  }, [library, persist]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (library && (isSaving || library !== persisted.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [library, isSaving]);

  const setSavedCards = useCallback((update: SetStateAction<SavedCard[]>) => {
    setLibrary(previous => previous ? { ...previous, cards: typeof update === 'function' ? update(previous.cards) : update } : previous);
  }, []);
  const setLibraryGroups = useCallback((update: SetStateAction<LibraryGroup[]>) => {
    setLibrary(previous => previous ? { ...previous, groups: typeof update === 'function' ? update(previous.groups) : update } : previous);
  }, []);

  const commitCards = async (cards: SavedCard[]) => {
    if (!library) return false;
    const next = { ...library, cards };
    if (!await persist(next)) return false;
    setLibrary(next);
    return true;
  };

  return {
    savedCards: library?.cards ?? EMPTY_CARDS, setSavedCards,
    libraryGroups: library?.groups ?? EMPTY_GROUPS, setLibraryGroups,
    isLoading: !library, loadError, saveError, isSaving, commitCards,
    retrySave: () => { if (library) void persist(library); },
  };
}

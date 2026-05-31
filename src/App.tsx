/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { 
  Download, 
  RotateCcw, 
  Save, 
  Upload, 
  Plus, 
  Trash2, 
  Image as ImageIcon,
  Grid,
  Type,
  Zap,
  Shield,
  Layers,
  Library,
  Settings,
  Info,
  Edit,
  Copy,
  FileJson,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { CardData, CardType, INITIAL_CARD_DATA, AssetLibrary, INITIAL_ASSETS, SavedCard } from './types';
import { cloneCardData, deepClone, isRecord, makeSavedCard, normalizeAssetLibrary, normalizeCardData, normalizeSavedCard } from './cardData';
import { fieldsToCardData, parseImportText, readDocxText, SPIRIT_TRAIT_ORDER } from './importParser';
import { A4_EXPORT_HEIGHT, A4_EXPORT_WIDTH, CARD_HEIGHT, CARD_WIDTH, getMatrixLabel } from './cardLayout';
import { cn } from './cn';
import { CardPreview } from './components/CardPreview';
import { getProxiedUrl } from './imageProxy';

// --- Components ---

type AppTab = 'editor' | 'library' | 'cards_library' | 'print_workspace';

type PrintImageFit = 'cover' | 'contain';

interface PrintImageItem {
  id: string;
  name: string;
  src: string;
  count: number;
  fit: PrintImageFit;
}

interface LibraryGroup {
  id: string;
  name: string;
  createdAt: number;
}

const PRINT_CARD_WIDTH = Math.round(A4_EXPORT_WIDTH * 59 / 210);
const PRINT_CARD_HEIGHT = Math.round(A4_EXPORT_HEIGHT * 86 / 297);
const PRINT_GRID_COLS = 3;
const PRINT_GRID_ROWS = 3;
const PRINT_GRID_WIDTH = PRINT_CARD_WIDTH * PRINT_GRID_COLS;
const PRINT_GRID_HEIGHT = PRINT_CARD_HEIGHT * PRINT_GRID_ROWS;
const PRINT_GRID_LEFT = Math.round((A4_EXPORT_WIDTH - PRINT_GRID_WIDTH) / 2);
const PRINT_GRID_TOP = Math.round((A4_EXPORT_HEIGHT - PRINT_GRID_HEIGHT) / 2);
const PRINT_CROP_MARK_LENGTH = 48;
const PRINT_CARDS_PER_PAGE = 9;
const PRINT_PREVIEW_SCALE = 0.56;

interface ImageInputProps {
  key?: React.Key;
  label: string;
  value?: string;
  onChange: (val: string) => void;
  className?: string;
}

function ImageInput({ 
  label, 
  value = '', 
  onChange, 
  className 
}: ImageInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      onChange(base64);
    };
    reader.readAsDataURL(file);
  };

  const displayValue = value && value.startsWith('data:image') ? '[本地图片]' : (value || '');

  return (
    <div className={cn("space-y-2", className)}>
      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider flex justify-between items-center">
        {label}
        <button 
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-[10px] text-accent hover:underline flex items-center gap-1"
        >
          <Upload className="w-3 h-3" />
          上传图片
        </button>
      </label>
      <div className="flex gap-2">
        <input 
          type="text" 
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入图片 URL 或点击上传"
          className="flex-1 bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors text-sm"
        />
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          accept="image/*" 
          className="hidden" 
        />
        {value && value.trim() !== '' && (
          <div className="w-10 h-10 rounded border border-white/10 overflow-hidden bg-black flex-shrink-0 flex items-center justify-center">
            <img src={getProxiedUrl(value)} alt="preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" crossOrigin="anonymous" />
          </div>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [cardData, setCardData] = useState<CardData>(INITIAL_CARD_DATA);
  const [assets, setAssets] = useState<AssetLibrary>(INITIAL_ASSETS);
  const [activeTab, setActiveTab] = useState<AppTab>('editor');
  const [showGrid, setShowGrid] = useState(false);
  
  // Card library states
  const [savedCards, setSavedCards] = useState<SavedCard[]>(() => {
    try {
      const saved = localStorage.getItem('spirit_card_library');
      const parsed = saved ? JSON.parse(saved) : [];
      const cards = Array.isArray(parsed) ? parsed : (isRecord(parsed) && Array.isArray(parsed.cards) ? parsed.cards : []);
      return cards.map(normalizeSavedCard).filter((item): item is SavedCard => Boolean(item));
    } catch {
      return [];
    }
  });
  const [libraryGroups, setLibraryGroups] = useState<LibraryGroup[]>(() => {
    try {
      const savedGroups = localStorage.getItem('spirit_card_library_groups');
      const parsedGroups = savedGroups ? JSON.parse(savedGroups) : null;
      const savedLibrary = localStorage.getItem('spirit_card_library');
      const parsedLibrary = savedLibrary ? JSON.parse(savedLibrary) : null;
      const groups = Array.isArray(parsedGroups)
        ? parsedGroups
        : (isRecord(parsedLibrary) && Array.isArray(parsedLibrary.groups) ? parsedLibrary.groups : []);

      return groups
        .filter(isRecord)
        .map(group => ({
          id: typeof group.id === 'string' ? group.id : '',
          name: typeof group.name === 'string' ? group.name.trim() : '',
          createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now(),
        }))
        .filter(group => group.id && group.name);
    } catch {
      return [];
    }
  });
  const [activeGroupId, setActiveGroupId] = useState<'all' | 'ungrouped' | string>('all');
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isExportingBatch, setIsExportingBatch] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [batchExportCard, setBatchExportCard] = useState<CardData | null>(null);
  const [batchExportAssets, setBatchExportAssets] = useState<AssetLibrary | null>(null);
  const [exportingCardId, setExportingCardId] = useState<string | null>(null);
  const [singleExportWidth, setSingleExportWidth] = useState(CARD_WIDTH);
  const [printImages, setPrintImages] = useState<PrintImageItem[]>([]);

  const previewRef = useRef<HTMLDivElement>(null);
  const effectTextRef = useRef<HTMLTextAreaElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const batchExportRef = useRef<HTMLDivElement>(null);
  const printPagesRef = useRef<HTMLDivElement>(null);

  // Sync saved cards to localStorage
  useEffect(() => {
    localStorage.setItem('spirit_card_library', JSON.stringify(savedCards));
  }, [savedCards]);

  useEffect(() => {
    localStorage.setItem('spirit_card_library_groups', JSON.stringify(libraryGroups));
  }, [libraryGroups]);

  const updateField = (path: string, value: any) => {
    const keys = path.split('.');
    setCardData(prev => {
      const newData = { ...prev };
      let current: any = newData;
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newData;
    });
  };

  const updateAsset = (type: 'templates' | 'attributes' | 'costs', key: string, value: string) => {
    setAssets(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [key]: value
      }
    }));
  };

  const makeAssetsSnapshot = () => deepClone(assets);

  const getCardExportAssets = (saved: SavedCard) => {
    return saved.assetsSnapshot ? deepClone(saved.assetsSnapshot) : makeAssetsSnapshot();
  };

  const handleImageAdjust = (scale: number, offset: { x: number, y: number }) => {
    setCardData(prev => ({
      ...prev,
      imageScale: scale,
      imageOffset: offset
    }));
  };

  const sanitizeFileName = (name: string) => {
    return (name || 'card').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'card';
  };

  const triggerDownload = (dataUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.download = fileName;
    link.href = dataUrl;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
    }, 0);
  };

  const getPreviewBaseWidth = () => {
    const width = previewRef.current?.offsetWidth || CARD_WIDTH;
    return Math.max(240, Math.min(CARD_WIDTH, Math.round(width)));
  };

  const handleExport = async () => {
    const cardEl = exportRef.current;
    if (!cardEl) return;

    try {
      await waitForExportReady(cardEl);
      const dataUrl = await toPng(cardEl, {
        pixelRatio: 3,
        cacheBust: true,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        filter: (node: Element) => {
          if (node instanceof HTMLElement && node.className && typeof node.className === 'string' && node.className.includes('z-[100]')) {
            return false;
          }
          return true;
        },
      });

      triggerDownload(dataUrl, `${sanitizeFileName(cardData.name)}.png`);
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败，可能是由于某些图片源不支持跨域访问。请尝试更换图片源或手动截图。');
    }
  };

  const handleReset = () => {
    if (window.confirm('确定要重置当前卡牌和素材库吗？')) {
      setCardData(deepClone(INITIAL_CARD_DATA));
      setAssets(deepClone(INITIAL_ASSETS));
    }
  };

  const handleSaveJson = () => {
    const blob = new Blob([JSON.stringify({ cardData, assets }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${cardData.name || 'card'}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.cardData) {
          const nextCardData = normalizeCardData(json.cardData);
          if (!nextCardData) {
            alert('无效的 JSON 文件：cardData 格式不正确');
            return;
          }
          setCardData(nextCardData);
        }
        if (json.assets) setAssets(normalizeAssetLibrary(json.assets));
      } catch (err) {
        alert('无效的 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  // --- CARD LIBRARY HANDLERS ---
  const addToLibrary = () => {
    const cardName = cardData.name || '未命名卡牌';
    if (editingCardId) {
      // Update existing card in library
      setSavedCards(prev => prev.map(item => {
        if (item.id === editingCardId) {
          return {
            ...item,
            assetsSnapshot: makeAssetsSnapshot(),
            cardData: cloneCardData(cardData)
          };
        }
        return item;
      }));
      alert(`已成功更新牌库中的【${cardName}】数据！`);
    } else {
      // Add as new card
      const newCard: SavedCard = {
        id: 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
        createdAt: Date.now(),
        groupId: activeGroupId !== 'all' && activeGroupId !== 'ungrouped' ? activeGroupId : undefined,
        assetsSnapshot: makeAssetsSnapshot(),
        cardData: cloneCardData(cardData)
      };
      setSavedCards(prev => [newCard, ...prev]);
      setEditingCardId(newCard.id); // switch into editing mode for this added card
      alert(`已成功将高级卡牌【${cardName}】添加至您的牌库！`);
    }
  };

  const createLibraryGroup = () => {
    const name = window.prompt('请输入新分组名称：')?.trim();
    if (!name) return;

    const exists = libraryGroups.some(group => group.name === name);
    if (exists) {
      alert('已经有同名分组了。');
      return;
    }

    const group: LibraryGroup = {
      id: 'group_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      name,
      createdAt: Date.now(),
    };
    setLibraryGroups(prev => [...prev, group]);
    setActiveGroupId(group.id);
  };

  const deleteLibraryGroup = (groupId: string, groupName: string) => {
    const cardCount = savedCards.filter(card => card.groupId === groupId).length;
    const message = cardCount > 0
      ? `确定删除分组【${groupName}】吗？其中 ${cardCount} 张卡牌会移动到“未分组”，不会删除卡牌。`
      : `确定删除分组【${groupName}】吗？`;
    if (!window.confirm(message)) return;

    setLibraryGroups(prev => prev.filter(group => group.id !== groupId));
    setSavedCards(prev => prev.map(card => card.groupId === groupId ? { ...card, groupId: undefined } : card));
    if (activeGroupId === groupId) setActiveGroupId('all');
  };

  const updateCardGroup = (cardId: string, groupId: string) => {
    setSavedCards(prev => prev.map(card => (
      card.id === cardId
        ? { ...card, groupId: groupId === 'ungrouped' ? undefined : groupId }
        : card
    )));
  };

  const loadCardFromLibrary = (saved: SavedCard) => {
    setCardData(cloneCardData(saved.cardData));
    setEditingCardId(saved.id);
    setActiveTab('editor'); // switch back to tab
  };

  const deleteFromLibrary = (id: string, name: string) => {
    if (window.confirm(`确定要从牌库中删除卡牌【${name || '未命名'}】吗？该操作不可恢复！`)) {
      setSavedCards(prev => prev.filter(item => item.id !== id));
      if (editingCardId === id) {
        setEditingCardId(null);
      }
    }
  };

  const cloneCardInLibrary = (saved: SavedCard) => {
    const clonedCard: SavedCard = {
      id: 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
      createdAt: Date.now(),
      groupId: saved.groupId,
      assetsSnapshot: saved.assetsSnapshot ? deepClone(saved.assetsSnapshot) : undefined,
      cardData: {
        ...cloneCardData(saved.cardData),
        name: saved.cardData.name ? `${saved.cardData.name} (副本)` : '未命名卡牌 (副本)'
      }
    };
    setSavedCards(prev => {
      const index = prev.findIndex(item => item.id === saved.id);
      if (index === -1) return [clonedCard, ...prev];
      const next = [...prev];
      next.splice(index + 1, 0, clonedCard);
      return next;
    });
    alert(`已复制卡牌并且作为副本加入牌库！`);
  };

  const waitForRenderCycle = async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  };

  const waitForFonts = async () => {
    if ('fonts' in document) {
      await document.fonts.ready.catch(() => undefined);
    }
  };

  const waitForImages = async (container: HTMLElement) => {
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(images.map(image => {
      if (image.complete) {
        return image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
      }
      return new Promise<void>(resolve => {
        const timeout = window.setTimeout(() => resolve(), 8000);
        const done = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        image.addEventListener('load', () => {
          if (image.decode) {
            image.decode().then(done, done);
          } else {
            done();
          }
        }, { once: true });
        image.addEventListener('error', done, { once: true });
      });
    }));
  };

  const waitForExportReady = async (container: HTMLElement) => {
    await waitForRenderCycle();
    await waitForFonts();
    await waitForImages(container);
    await waitForRenderCycle();
  };

  const readPrintImageFile = (file: File) => {
    return new Promise<PrintImageItem>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve({
          id: 'print_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          name: file.name,
          src: String(event.target?.result || ''),
          count: 1,
          fit: 'cover',
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  const handleAddPrintImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file): file is File => file instanceof File && file.type.startsWith('image/'));
    event.target.value = '';
    if (files.length === 0) return;

    try {
      const items = await Promise.all(files.map(readPrintImageFile));
      setPrintImages(prev => [...prev, ...items]);
    } catch (err) {
      console.error('Print image import failed:', err);
      alert('图片导入失败，请换一批图片重试。');
    }
  };

  const updatePrintImageCount = (id: string, nextCount: number) => {
    setPrintImages(prev => prev.map(item => (
      item.id === id
        ? { ...item, count: Math.max(1, Math.min(99, nextCount || 1)) }
        : item
    )));
  };

  const updatePrintImageFit = (id: string, fit: PrintImageFit) => {
    setPrintImages(prev => prev.map(item => item.id === id ? { ...item, fit } : item));
  };

  const deletePrintImage = (id: string) => {
    setPrintImages(prev => prev.filter(item => item.id !== id));
  };

  const getExpandedPrintImages = () => {
    return printImages.flatMap(item => (
      Array.from({ length: item.count }, (_, copyIndex) => ({ ...item, copyIndex }))
    ));
  };

  const handleDownloadPrintPdf = async () => {
    const cards = getExpandedPrintImages();
    if (cards.length === 0) {
      alert('请先添加要排版打印的图片。');
      return;
    }

    await waitForRenderCycle();
    const pageNodes = printPagesRef.current
      ? Array.from(printPagesRef.current.querySelectorAll('[data-print-page="true"]')) as HTMLElement[]
      : [];
    if (pageNodes.length === 0) {
      alert('打印页面还没有准备好，请重试。');
      return;
    }

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      for (let index = 0; index < pageNodes.length; index++) {
        const pageNode = pageNodes[index];
        await waitForImages(pageNode);
        const dataUrl = await toPng(pageNode, {
          pixelRatio: 2,
          cacheBust: true,
          width: A4_EXPORT_WIDTH,
          height: A4_EXPORT_HEIGHT,
          backgroundColor: '#ffffff',
        });

        if (index > 0) {
          pdf.addPage('a4', 'portrait');
        }
        pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297);
      }

      pdf.save(`print_sheet_${Date.now()}.pdf`);
    } catch (err) {
      console.error('Print PDF export failed:', err);
      alert('打印 PDF 导出失败，请检查图片后重试。');
    }
  };

  const prepareBatchExportCard = async (card: CardData, exportAssets: AssetLibrary) => {
    flushSync(() => {
      setSingleExportWidth(CARD_WIDTH);
      setBatchExportCard(cloneCardData(card));
      setBatchExportAssets(deepClone(exportAssets));
    });
    await waitForRenderCycle();
    const container = batchExportRef.current;
    if (container) {
      await waitForExportReady(container);
    }
    return container;
  };

  const handleExportSingleCard = async (saved: SavedCard) => {
    const card = saved.cardData;
    setExportingCardId(saved.id);
    try {
      const exportContainer = await prepareBatchExportCard(card, getCardExportAssets(saved));

      if (!exportContainer || !exportContainer.firstElementChild) {
        alert('导出环境未就绪，请重试！');
        return;
      }

      const dataUrl = await toPng(exportContainer, {
        pixelRatio: 3,
        cacheBust: true,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        filter: (node: Element) => {
          if (node instanceof HTMLElement && node.className && typeof node.className === 'string' && node.className.includes('z-[100]')) {
            return false;
          }
          return true;
        },
      });

      triggerDownload(dataUrl, `${sanitizeFileName(card.name)}.png`);
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败：' + (err instanceof Error ? err.message : '可能是存在跨域渲染受限图片'));
    } finally {
      setBatchExportCard(null);
      setBatchExportAssets(null);
      setExportingCardId(null);
    }
  };

  const handleBatchExport = async () => {
    const cardsToExport = savedCards.filter(card => (
      activeGroupId === 'all'
        ? true
        : activeGroupId === 'ungrouped'
          ? !card.groupId
          : card.groupId === activeGroupId
    ));
    const exportGroupName = activeGroupId === 'all'
      ? '全部卡牌'
      : activeGroupId === 'ungrouped'
        ? '未分组'
        : libraryGroups.find(group => group.id === activeGroupId)?.name || '当前分组';

    if (cardsToExport.length === 0) {
      alert('当前分组中无任何可导出的卡牌！');
      return;
    }

    const confirmExport = window.confirm(`准备开始批量导出【${exportGroupName}】中的 ${cardsToExport.length} 张卡牌为高品质PNG。网页将逐一绘制并下载，可能会触发浏览器的多文件下载授权，请点击“允许/同意”。确定开始吗？`);
    if (!confirmExport) return;

    setIsExportingBatch(true);
    setExportProgress({ current: 0, total: cardsToExport.length });

    try {
      for (let i = 0; i < cardsToExport.length; i++) {
        const item = cardsToExport[i];
        setExportProgress({ current: i + 1, total: cardsToExport.length });

        const exportContainer = await prepareBatchExportCard(item.cardData, getCardExportAssets(item));

        if (!exportContainer || !exportContainer.firstElementChild) continue;

        const dataUrl = await toPng(exportContainer, {
          pixelRatio: 3,
          cacheBust: true,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          filter: (node: Element) => {
            if (node instanceof HTMLElement && node.className && typeof node.className === 'string' && node.className.includes('z-[100]')) {
              return false;
            }
            return true;
          },
        });

        triggerDownload(dataUrl, `${sanitizeFileName(item.cardData.name)}_${sanitizeFileName(item.cardData.serialNumber || 'un')}.png`);

        await new Promise(resolve => setTimeout(resolve, 200));
      }
      alert('所有卡牌已生成渲染任务！请检查浏览器的下载纪录。');
    } catch (err) {
      console.error('Batch export failed:', err);
      alert('批量导出发生错误，可能因为某些插画源无法跨域：' + err);
    } finally {
      setIsExportingBatch(false);
      setBatchExportCard(null);
      setBatchExportAssets(null);
    }
  };

  const handleExportLibraryJson = () => {
    if (savedCards.length === 0) {
      alert('您的牌库暂无卡牌数据！');
      return;
    }
    const blob = new Blob([JSON.stringify({ version: 2, groups: libraryGroups, cards: savedCards }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `spirit_card_deck_${Date.now()}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportLibraryJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const rawCards = Array.isArray(json) ? json : (isRecord(json) && Array.isArray(json.cards) ? json.cards : null);
        if (rawCards) {
          const normalized = rawCards
            .map(normalizeSavedCard)
            .filter((item): item is SavedCard => Boolean(item))
            .map(item => ({
              ...item,
              id: `${item.id}_${Math.random().toString(36).substring(2, 5)}`,
              assetsSnapshot: item.assetsSnapshot ? deepClone(item.assetsSnapshot) : undefined,
              cardData: cloneCardData(item.cardData),
            }));

          if (normalized.length !== rawCards.length || normalized.length === 0) {
            alert('无效的牌库数据。数据字段格式不正确。');
            return;
          }

          const importedGroups = isRecord(json) && Array.isArray(json.groups)
            ? json.groups
                .filter(isRecord)
                .map(group => ({
                  id: typeof group.id === 'string' ? group.id : '',
                  name: typeof group.name === 'string' ? group.name.trim() : '',
                  createdAt: typeof group.createdAt === 'number' ? group.createdAt : Date.now(),
                }))
                .filter(group => group.id && group.name)
            : [];

          const append = window.confirm(`检测到包含 ${rawCards.length} 张卡牌的文件。点击【确定】将它们【追加】到当前的牌库中；或者点击【取消】将【覆盖并重置】现有牌库。`);

          if (append) {
            setSavedCards(prev => [...prev, ...normalized]);
            setLibraryGroups(prev => {
              const existingNames = new Set(prev.map(group => group.name));
              return [...prev, ...importedGroups.filter(group => !existingNames.has(group.name))];
            });
          } else {
            setSavedCards(normalized);
            setLibraryGroups(importedGroups);
            setActiveGroupId('all');
          }
          alert(`成功加载并处理了 ${rawCards.length} 张卡牌！`);
        } else {
          alert('数据根节点应该为一个包含卡牌对象的 JSON 数组，或包含 cards 字段的牌库备份对象。');
        }
      } catch (err) {
        alert('解析文件遇到错误：' + err);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // clean input
  };

  const handleBatchImportCards = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    try {
      let importedCards: SavedCard[] = [];
      const failedFiles: string[] = [];

      for (const file of files) {
        try {
          const lowerName = file.name.toLowerCase();
          const text = lowerName.endsWith('.docx')
            ? await readDocxText(file)
            : await file.text();

          if (lowerName.endsWith('.json')) {
            const json = JSON.parse(text);
            if (Array.isArray(json)) {
              importedCards = [
                ...importedCards,
                ...json
                  .map(item => normalizeCardData(isRecord(item) && 'cardData' in item ? item.cardData : item))
                  .filter((item): item is CardData => Boolean(item))
                  .map(card => makeSavedCard(card, assets))
              ];
            } else if (isRecord(json) && json.cardData) {
              const card = normalizeCardData(json.cardData);
              if (card) importedCards.push(makeSavedCard(card, assets));
            } else {
              const card = normalizeCardData(json);
              if (card) importedCards.push(makeSavedCard(card, assets));
            }
          } else {
            importedCards = [
              ...importedCards,
              ...parseImportText(text)
                .map(fieldsToCardData)
                .map(card => makeSavedCard(card, assets))
            ];
          }
        } catch (err) {
          console.error('Failed to import file:', file.name, err);
          failedFiles.push(file.name);
        }
      }

      if (importedCards.length === 0) {
        alert('没有识别到可导入的卡牌。请确认文档使用“字段名：内容”或简化段落格式。');
        return;
      }

      const targetGroupId = activeGroupId !== 'all' && activeGroupId !== 'ungrouped'
        ? activeGroupId
        : undefined;
      const cardsForLibrary = importedCards.map(card => ({ ...card, groupId: targetGroupId }));

      const failedText = failedFiles.length > 0 ? `\n\n有 ${failedFiles.length} 个文件未能解析：\n${failedFiles.join('\n')}` : '';
      const append = window.confirm(`从 ${files.length} 个文件中识别到 ${importedCards.length} 张卡牌。点击【确定】追加到当前牌库；点击【取消】覆盖当前牌库。${failedText}`);
      if (append) {
        setSavedCards(prev => [...cardsForLibrary, ...prev]);
      } else {
        setSavedCards(cardsForLibrary);
      }

      setCardData(cloneCardData(cardsForLibrary[0].cardData));
      setEditingCardId(cardsForLibrary[0].id);
      setActiveTab('cards_library');
      alert(`已成功批量导入 ${importedCards.length} 张卡牌。${failedText}`);
    } catch (err) {
      console.error('Batch import failed:', err);
      alert('批量导入失败：' + err);
    } finally {
      e.target.value = '';
    }
  };

  const clearLibrary = () => {
    if (window.confirm('您确定要清空当前的全部牌库吗？警告：这会永久擦除浏览器所有的本地牌库历史！')) {
      setSavedCards([]);
      setLibraryGroups([]);
      setActiveGroupId('all');
      setEditingCardId(null);
    }
  };

  const refreshLibraryAssetSnapshots = () => {
    if (savedCards.length === 0) {
      alert('牌库中还没有卡牌。');
      return;
    }

    if (!window.confirm('确定要把当前素材库写入所有已保存卡牌吗？这会修复旧卡的费用/属性图标快照。')) {
      return;
    }

    const nextAssets = makeAssetsSnapshot();
    setSavedCards(prev => prev.map(item => ({
      ...item,
      assetsSnapshot: deepClone(nextAssets),
    })));
    alert(`已同步 ${savedCards.length} 张卡牌的素材快照。`);
  };

  const insertKeyword = (keyword: string) => {
    const textarea = effectTextRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end);
    const formattedKeyword = `【${keyword}】`;
    
    const newText = before + formattedKeyword + after;
    
    updateEffectEditorValue(newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + formattedKeyword.length, start + formattedKeyword.length);
    }, 0);
  };

  const toggleMatrix = (index: number) => {
    const newMatrix = [...cardData.matrix];
    newMatrix[index] = (newMatrix[index] + 1) % 2;
    updateField('matrix', newMatrix);
  };

  const effectTagOptions = cardData.cardType === 'trace'
    ? ['发动条件', '效果']
    : SPIRIT_TRAIT_ORDER;

  const getEffectEditorValue = () => {
    if (cardData.cardType === 'master') return cardData.master?.activeSkill ?? '';
    if (cardData.cardType === 'trace') return cardData.trace?.effectText ?? '';
    return cardData.spirit?.effectText ?? '';
  };

  const updateEffectEditorValue = (value: string) => {
    if (cardData.cardType === 'master') {
      updateField('master.activeSkill', value);
      return;
    }

    if (cardData.cardType === 'trace') {
      updateField('trace.effectText', value);
      return;
    }

    updateField('spirit.effectText', value);
  };

  const handleEffectEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = getEffectEditorValue();
    const nextValue = currentValue.slice(0, start) + '\n' + currentValue.slice(end);
    updateEffectEditorValue(nextValue);

    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1);
    }, 0);
  };

  const expandedPrintImages = getExpandedPrintImages();
  const printPageCount = Math.max(1, Math.ceil(expandedPrintImages.length / PRINT_CARDS_PER_PAGE));
  const printPages = Array.from({ length: printPageCount }, (_, pageIndex) => (
    expandedPrintImages.slice(pageIndex * PRINT_CARDS_PER_PAGE, (pageIndex + 1) * PRINT_CARDS_PER_PAGE)
  ));
  const cropXs = Array.from({ length: PRINT_GRID_COLS + 1 }, (_, index) => PRINT_GRID_LEFT + PRINT_CARD_WIDTH * index);
  const cropYs = Array.from({ length: PRINT_GRID_ROWS + 1 }, (_, index) => PRINT_GRID_TOP + PRINT_CARD_HEIGHT * index);
  const ungroupedCount = savedCards.filter(card => !card.groupId).length;
  const activeGroupName = activeGroupId === 'all'
    ? '全部卡牌'
    : activeGroupId === 'ungrouped'
      ? '未分组'
      : libraryGroups.find(group => group.id === activeGroupId)?.name || '全部卡牌';
  const visibleSavedCards = savedCards.filter(card => (
    activeGroupId === 'all'
      ? true
      : activeGroupId === 'ungrouped'
        ? !card.groupId
        : card.groupId === activeGroupId
  ));

  return (
    <div className="light-app min-h-screen flex flex-col bg-neutral-950 text-neutral-200 font-sans">
      {/* Top Action Bar */}
      <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center shadow-lg shadow-accent/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">域·卡牌生成器 <span className="text-[10px] font-mono opacity-50 ml-2">v1.3</span></h1>
        </div>
        <div className="flex items-center gap-2">
          {editingCardId && (
            <button 
              onClick={() => {
                if (window.confirm('是否卸载当前卡片并新建一张空卡？未保存的草稿将丢失哦！')) {
                  setCardData(INITIAL_CARD_DATA);
                  setEditingCardId(null);
                }
              }}
              className="mr-1 flex items-center gap-1.5 border border-dashed border-neutral-700 hover:border-accent text-neutral-400 hover:text-white px-3 py-1.5 rounded-lg font-bold text-xs transition-colors"
              title="解除当前牌库卡牌的编辑锁定，开始新建"
            >
              <Plus className="w-3.5 h-3.5" />
              设计新卡
            </button>
          )}

          <button onClick={handleReset} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-white" title="重置当前编辑器">
            <RotateCcw className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-white/10 mx-1" />
          <label className="p-2 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-white cursor-pointer" title="读取卡牌 JSON">
            <Upload className="w-5 h-5" />
            <input type="file" accept=".json" onChange={handleLoadJson} className="hidden" />
          </label>
          <button onClick={handleSaveJson} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-neutral-400 hover:text-white" title="下载卡牌 JSON">
            <Save className="w-5 h-5" />
          </button>

          <div className="h-6 w-px bg-white/10 mx-1" />

          {/* Add to Library buttons */}
          {editingCardId ? (
            <>
              <button 
                onClick={addToLibrary}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all shadow-lg shadow-emerald-600/20 active:scale-95"
                title="保存修改并覆盖至牌库中的本张卡片"
              >
                <Save className="w-3.5 h-3.5" />
                更新当前卡
              </button>
              <button 
                onClick={() => {
                  const newCard: SavedCard = {
                    id: 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
                    createdAt: Date.now(),
                    groupId: activeGroupId !== 'all' && activeGroupId !== 'ungrouped' ? activeGroupId : undefined,
                    assetsSnapshot: makeAssetsSnapshot(),
                    cardData: cloneCardData(cardData)
                  };
                  setSavedCards(prev => [newCard, ...prev]);
                  setEditingCardId(newCard.id);
                  alert(`已作为新卡【${cardData.name || '未命名'}】另存至牌库！`);
                }}
                className="flex items-center gap-1.5 bg-neutral-800 border border-white/10 hover:border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-lg font-bold text-xs transition-all active:scale-95"
                title="不覆盖原子文件，而是复制为另一张新卡"
              >
                <Copy className="w-3.5 h-3.5" />
                另存为新卡
              </button>
            </>
          ) : (
            <button 
              onClick={addToLibrary}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-lg font-bold text-xs transition-all shadow-lg shadow-emerald-600/20 active:scale-95"
              title="将当前卡片加入您的本地牌库"
            >
              <Plus className="w-3.5 h-3.5" />
              添加至牌库
            </button>
          )}

          {activeTab === 'editor' && (
            <button
              onClick={handleExport}
              className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-1.5 rounded-lg font-bold text-xs transition-all shadow-lg shadow-accent/20 active:scale-95"
            >
              <Download className="w-4 h-4" />
              导出当前卡
            </button>
          )}
        </div>
      </header>

      {activeTab === 'print_workspace' ? (
        <main className="flex-1 overflow-hidden bg-neutral-100 text-neutral-900">
          <div className="h-full flex overflow-hidden">
            <aside className="w-[340px] shrink-0 bg-white border-r border-neutral-300 flex flex-col">
              <div className="p-4 border-b border-neutral-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-neutral-950">打印工作台</h2>
                    <p className="text-xs text-neutral-500 mt-1">本地图片按 59mm × 86mm 排版</p>
                  </div>
                  <button
                    onClick={() => setActiveTab('editor')}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg border border-neutral-300 hover:border-accent hover:text-accent transition-colors"
                  >
                    返回编辑器
                  </button>
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="text-xs text-neutral-600 font-bold">纸张大小</span>
                    <select className="mt-1 w-full border border-neutral-300 rounded-lg bg-white px-3 py-2 text-sm font-bold outline-none focus:border-accent">
                      <option>A4 (portrait)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-neutral-600 font-bold">卡片尺寸</span>
                    <select className="mt-1 w-full border border-neutral-300 rounded-lg bg-white px-3 py-2 text-sm font-bold outline-none focus:border-accent">
                      <option>小尺寸</option>
                    </select>
                  </label>
                  <p className="text-xs text-neutral-500">59mm × 86mm：图片默认居中裁切。</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                {printImages.length === 0 ? (
                  <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center border border-dashed border-neutral-300 rounded-xl bg-neutral-50 p-6">
                    <ImageIcon className="w-10 h-10 text-neutral-400 mb-3" />
                    <p className="text-sm font-bold text-neutral-700">暂无卡图</p>
                    <p className="text-xs text-neutral-500 mt-1">点击底部按钮，从文件夹选择图片。</p>
                  </div>
                ) : (
                  printImages.map(item => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-sm">
                      <div className="w-9 h-12 rounded border border-neutral-200 overflow-hidden bg-neutral-100 shrink-0">
                        <img src={item.src} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-neutral-900" title={item.name}>{item.name}</p>
                        <div className="mt-1 flex items-center gap-1">
                          <button
                            onClick={() => updatePrintImageCount(item.id, item.count - 1)}
                            className="w-7 h-7 rounded border border-neutral-300 text-lg leading-none hover:border-accent hover:text-accent"
                            title="减少张数"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={item.count}
                            onChange={(event) => updatePrintImageCount(item.id, Number(event.target.value))}
                            className="w-16 h-7 rounded border border-neutral-300 text-center text-sm outline-none focus:border-accent"
                          />
                          <span className="text-xs text-neutral-500">张</span>
                          <button
                            onClick={() => updatePrintImageCount(item.id, item.count + 1)}
                            className="w-7 h-7 rounded border border-neutral-300 text-lg leading-none hover:border-accent hover:text-accent"
                            title="增加张数"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => updatePrintImageFit(item.id, item.fit === 'cover' ? 'contain' : 'cover')}
                        className="p-1.5 rounded text-neutral-500 hover:bg-neutral-100 hover:text-accent"
                        title={item.fit === 'cover' ? '当前：裁切填满，点击改为完整适配' : '当前：完整适配，点击改为裁切填满'}
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deletePrintImage(item.id)}
                        className="p-1.5 rounded text-neutral-500 hover:bg-red-50 hover:text-red-600"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t border-neutral-200 space-y-2">
                <label className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-accent text-accent font-bold text-sm cursor-pointer hover:bg-accent/5 transition-colors">
                  <ImageIcon className="w-4 h-4" />
                  添加卡片
                  <input type="file" accept="image/*" multiple onChange={handleAddPrintImages} className="hidden" />
                </label>
                <button
                  onClick={() => setPrintImages([])}
                  disabled={printImages.length === 0}
                  className="w-full px-4 py-2 rounded-lg border border-neutral-300 text-neutral-600 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:border-red-300 hover:text-red-600"
                >
                  清空工作台
                </button>
              </div>
            </aside>

            <section className="flex-1 overflow-auto bg-neutral-200 p-8 custom-scrollbar">
              <div className="min-w-[760px] flex flex-col items-center">
                <div className="sticky top-0 z-10 mb-4 flex w-[760px] items-center justify-between rounded-lg bg-neutral-200/95 py-2 backdrop-blur">
                  <div>
                    <h3 className="text-base font-bold text-neutral-900">A4 预览</h3>
                    <p className="text-xs text-neutral-500">
                      已添加 {expandedPrintImages.length} 张，共 {printPageCount} 页。向下滚动查看后续页面。
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadPrintPdf}
                    disabled={expandedPrintImages.length === 0}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-white shadow-lg transition-all active:scale-95",
                      expandedPrintImages.length === 0
                        ? "bg-neutral-400 cursor-not-allowed shadow-none"
                        : "bg-blue-600 hover:bg-blue-500 shadow-blue-600/20"
                    )}
                  >
                    <Download className="w-4 h-4" />
                    导出 PDF
                  </button>
                </div>

                <div ref={printPagesRef} className="flex flex-col items-center gap-8 pb-10">
                  {printPages.map((pageItems, pageIndex) => (
                    <div
                      key={`print-preview-page-${pageIndex}`}
                      className="relative bg-white shadow-2xl"
                      style={{
                        width: A4_EXPORT_WIDTH * PRINT_PREVIEW_SCALE,
                        height: A4_EXPORT_HEIGHT * PRINT_PREVIEW_SCALE,
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${PRINT_PREVIEW_SCALE})`,
                          transformOrigin: 'top left',
                        }}
                      >
                        <div
                          data-print-page="true"
                          style={{
                            width: `${A4_EXPORT_WIDTH}px`,
                            height: `${A4_EXPORT_HEIGHT}px`,
                            background: '#ffffff',
                            boxSizing: 'border-box',
                            position: 'relative',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              left: `${PRINT_GRID_LEFT}px`,
                              top: `${PRINT_GRID_TOP}px`,
                              width: `${PRINT_GRID_WIDTH}px`,
                              height: `${PRINT_GRID_HEIGHT}px`,
                              display: 'grid',
                              gridTemplateColumns: `repeat(${PRINT_GRID_COLS}, ${PRINT_CARD_WIDTH}px)`,
                              gridTemplateRows: `repeat(${PRINT_GRID_ROWS}, ${PRINT_CARD_HEIGHT}px)`,
                              gap: 0,
                            }}
                          >
                            {Array.from({ length: PRINT_CARDS_PER_PAGE }).map((_, index) => {
                              const item = pageItems[index];
                              return (
                                <div
                                  key={item ? `${item.id}-${item.copyIndex}` : `empty-${pageIndex}-${index}`}
                                  style={{
                                    width: `${PRINT_CARD_WIDTH}px`,
                                    height: `${PRINT_CARD_HEIGHT}px`,
                                    overflow: 'hidden',
                                    background: '#ffffff',
                                  }}
                                >
                                  {item && (
                                    <img
                                      src={item.src}
                                      alt=""
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: item.fit,
                                        display: 'block',
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {cropXs.map((x) => (
                            <React.Fragment key={`crop-x-${pageIndex}-${x}`}>
                              <div style={{ position: 'absolute', left: `${x}px`, top: `${PRINT_GRID_TOP - PRINT_CROP_MARK_LENGTH}px`, width: '1px', height: `${PRINT_CROP_MARK_LENGTH - 8}px`, background: '#8a8a8a' }} />
                              <div style={{ position: 'absolute', left: `${x}px`, top: `${PRINT_GRID_TOP + PRINT_GRID_HEIGHT + 8}px`, width: '1px', height: `${PRINT_CROP_MARK_LENGTH - 8}px`, background: '#8a8a8a' }} />
                            </React.Fragment>
                          ))}

                          {cropYs.map((y) => (
                            <React.Fragment key={`crop-y-${pageIndex}-${y}`}>
                              <div style={{ position: 'absolute', left: `${PRINT_GRID_LEFT - PRINT_CROP_MARK_LENGTH}px`, top: `${y}px`, width: `${PRINT_CROP_MARK_LENGTH - 8}px`, height: '1px', background: '#8a8a8a' }} />
                              <div style={{ position: 'absolute', left: `${PRINT_GRID_LEFT + PRINT_GRID_WIDTH + 8}px`, top: `${y}px`, width: `${PRINT_CROP_MARK_LENGTH - 8}px`, height: '1px', background: '#8a8a8a' }} />
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>
      ) : (
      <main className="flex-1 flex overflow-hidden">
        {/* Left: Preview */}
        <section className="w-1/2 flex items-center justify-center p-12 bg-neutral-950 relative overflow-y-auto custom-scrollbar">
          <div className="sticky top-12 py-10 w-[380px] max-w-full">
            <CardPreview ref={previewRef} data={cardData} assets={assets} showGrid={showGrid} onImageAdjust={handleImageAdjust} />
          </div>
        </section>

        {/* Right: Sidebar */}
        <section className="w-1/2 border-l border-white/10 bg-neutral-900/30 flex flex-col overflow-hidden animate-fade-in">
          {/* Tabs */}
          <div className="flex border-b border-white/10 bg-neutral-950/20">
            <button 
              onClick={() => setActiveTab('editor')}
              className={cn(
                "flex-1 py-3.5 flex items-center justify-center gap-1.5 font-bold text-xs transition-all border-r border-white/5",
                activeTab === 'editor' ? "text-accent bg-white/5 border-b-2 border-accent" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <Settings className="w-3.5 h-3.5" />
              卡牌编辑器
            </button>
            <button 
              onClick={() => setActiveTab('cards_library')}
              className={cn(
                "flex-1 py-3.5 flex items-center justify-center gap-1.5 font-bold text-xs transition-all relative border-r border-white/5",
                activeTab === 'cards_library' ? "text-accent bg-white/5 border-b-2 border-accent" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <Library className="w-3.5 h-3.5" />
              我的牌库
              {savedCards.length > 0 && (
                <span className="absolute top-1 right-2 bg-accent text-white text-[9px] px-1.5 h-4.5 rounded-full flex items-center justify-center font-bold scale-90">
                  {savedCards.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('print_workspace')}
              className={cn(
                "flex-1 py-3.5 flex items-center justify-center gap-1.5 font-bold text-xs transition-all border-r border-white/5",
                activeTab === 'print_workspace' ? "text-accent bg-white/5 border-b-2 border-accent" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              打印工作台
            </button>
            <button 
              onClick={() => setActiveTab('library')}
              className={cn(
                "flex-1 py-3.5 flex items-center justify-center gap-1.5 font-bold text-xs transition-all",
                activeTab === 'library' ? "text-accent bg-white/5 border-b-2 border-accent" : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              素材库
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
            {activeTab === 'cards_library' ? (
              <div className="space-y-6">
                {/* Deck Action bar */}
                <div className="flex items-center justify-between p-4 bg-neutral-950/40 border border-white/5 rounded-xl">
                  <div>
                    <h3 className="text-white font-bold text-xs">卡牌库数据</h3>
                    <p className="text-[10px] text-neutral-500 mt-1">
                      本地共存储了 {savedCards.length} 张卡牌，当前显示 {activeGroupName} · {visibleSavedCards.length} 张
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {/* Bulk Export Button */}
                    <button 
                      onClick={handleBatchExport}
                      disabled={isExportingBatch}
                      className={cn(
                        "flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition-all",
                        isExportingBatch 
                          ? "bg-accent/20 text-accent/50 cursor-not-allowed" 
                          : "bg-accent hover:bg-accent/90 text-white shadow-md active:scale-95"
                      )}
                    >
                      <Zap className={cn("w-3 h-3", isExportingBatch && "animate-spin")} />
                      批量PNG
                    </button>
                    
                    {/* Word/Text batch import button */}
                    <label
                      className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-700/80 border border-emerald-400/20 hover:bg-emerald-600 text-white cursor-pointer active:scale-95 transition-all"
                      title="从 Word、TXT 或 JSON 批量生成并导入卡牌"
                    >
                      <FileText className="w-3 h-3" />
                      Word导入
                      <input type="file" accept=".docx,.txt,.md,.json" multiple onChange={handleBatchImportCards} className="hidden" />
                    </label>

                    {/* JSON Import button */}
                    <label className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-neutral-800 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white cursor-pointer active:scale-95 transition-all">
                      <Upload className="w-3 h-3" />
                      导入
                      <input type="file" accept=".json" onChange={handleImportLibraryJson} className="hidden" />
                    </label>

                    {/* JSON Export button */}
                    <button 
                      onClick={handleExportLibraryJson}
                      className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-neutral-800 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white active:scale-95 transition-all"
                      title="备份牌库为 JSON 文件"
                    >
                      <Save className="w-3 h-3" />
                      备份JSON
                    </button>

                    <button
                      onClick={refreshLibraryAssetSnapshots}
                      className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-neutral-800 border border-white/10 hover:border-white/20 text-neutral-300 hover:text-white active:scale-95 transition-all"
                      title="把当前素材库同步到所有已保存卡牌，修复旧卡导出素材"
                    >
                      <RotateCcw className="w-3 h-3" />
                      同步素材
                    </button>

                    {/* Clear Library button */}
                    <button 
                      onClick={clearLibrary}
                      className="p-1.5 rounded-lg bg-red-950/20 text-red-500 hover:bg-red-950/40 active:scale-95 transition-all"
                      title="清空牌库"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-neutral-950/30 border border-white/5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-white font-bold text-xs">牌库分组</h3>
                      <p className="text-[10px] text-neutral-500 mt-1">按系列、卡组或测试批次整理本地牌库</p>
                    </div>
                    <button
                      onClick={createLibraryGroup}
                      className="flex items-center gap-1.5 rounded-lg bg-neutral-800 border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-neutral-200 hover:border-accent hover:text-accent transition-all"
                    >
                      <Plus className="w-3 h-3" />
                      新建分组
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setActiveGroupId('all')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all",
                        activeGroupId === 'all'
                          ? "bg-accent text-white border-accent"
                          : "bg-neutral-800 border-white/10 text-neutral-400 hover:text-white"
                      )}
                    >
                      全部 <span className="opacity-70">{savedCards.length}</span>
                    </button>
                    <button
                      onClick={() => setActiveGroupId('ungrouped')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all",
                        activeGroupId === 'ungrouped'
                          ? "bg-accent text-white border-accent"
                          : "bg-neutral-800 border-white/10 text-neutral-400 hover:text-white"
                      )}
                    >
                      未分组 <span className="opacity-70">{ungroupedCount}</span>
                    </button>
                    {libraryGroups.map(group => {
                      const count = savedCards.filter(card => card.groupId === group.id).length;
                      return (
                        <div
                          key={group.id}
                          className={cn(
                            "group flex items-center rounded-lg border transition-all overflow-hidden",
                            activeGroupId === group.id
                              ? "bg-accent text-white border-accent"
                              : "bg-neutral-800 border-white/10 text-neutral-400 hover:text-white"
                          )}
                        >
                          <button
                            onClick={() => setActiveGroupId(group.id)}
                            className="px-3 py-1.5 text-[11px] font-bold"
                          >
                            {group.name} <span className="opacity-70">{count}</span>
                          </button>
                          <button
                            onClick={() => deleteLibraryGroup(group.id, group.name)}
                            className="px-1.5 py-1.5 opacity-60 hover:opacity-100 hover:bg-red-500/20"
                            title="删除分组"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Export Progress overlay */}
                {isExportingBatch && (
                  <div className="p-4 bg-accent/10 border border-accent/20 rounded-xl animate-pulse">
                    <div className="flex justify-between text-xs font-bold text-accent">
                      <span>正在批量输出 PNG 卡牌...</span>
                      <span>{exportProgress.current} / {exportProgress.total}</span>
                    </div>
                    <div className="w-full bg-white/5 h-1.5 rounded-full mt-2 overflow-hidden">
                      <div 
                        className="bg-accent h-full rounded-full transition-all duration-300" 
                        style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Saved cards grid/list */}
                {savedCards.length === 0 ? (
                  <div className="text-center py-20 px-6 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center bg-neutral-950/10">
                    <div className="w-12 h-12 bg-neutral-800/50 rounded-full flex items-center justify-center mb-4 text-neutral-500">
                      <Library className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-bold text-neutral-400">牌库里目前空空如也</h4>
                    <p className="text-xs text-neutral-500 mt-2 max-w-[280px] leading-relaxed">
                      先在「卡牌编辑器」中设计卡牌，然后点击顶部的 <strong className="text-emerald-500">添加至牌库</strong> 按钮保存您的杰作吧！
                    </p>
                  </div>
                ) : visibleSavedCards.length === 0 ? (
                  <div className="text-center py-14 px-6 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center bg-neutral-950/10">
                    <div className="w-12 h-12 bg-neutral-800/50 rounded-full flex items-center justify-center mb-4 text-neutral-500">
                      <Library className="w-6 h-6" />
                    </div>
                    <h4 className="text-sm font-bold text-neutral-400">当前分组暂无卡牌</h4>
                    <p className="text-xs text-neutral-500 mt-2 max-w-[320px] leading-relaxed">
                      可以从其它分组的卡牌右侧下拉菜单移动进来，或在当前分组下新增卡牌。
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5">
                    {visibleSavedCards.map((item) => {
                      const typeLabels: Record<string, string> = {
                        master: '星主',
                        spirit_normal: '域灵',
                        spirit_resonance: '域灵(共鸣)',
                        trace: '痕迹'
                      };
                      const costValue = item.cardData.cardType === 'master' 
                        ? '★' 
                        : (item.cardData.cardType.startsWith('spirit') ? `Fee ${item.cardData.spirit.cost}` : `Fee ${item.cardData.trace.cost}`);
                      
                      const attrName = item.cardData.attribute || '无';

                      return (
                        <div 
                          key={item.id} 
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border transition-all relative group bg-neutral-950/40 hover:bg-neutral-950/80",
                            editingCardId === item.id ? "border-emerald-500/40 shadow-md shadow-emerald-500/5 bg-emerald-500/[0.02]" : "border-white/5"
                          )}
                        >
                          {/* Mini artwork thumbnail */}
                          <div className="w-12 h-14 bg-neutral-800 rounded-lg flex-shrink-0 relative overflow-hidden flex items-center justify-center border border-white/10 select-none">
                            {item.cardData.image ? (
                              <img 
                                src={item.cardData.image} 
                                alt="" 
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover" 
                              />
                            ) : (
                              <ImageIcon className="w-5 h-5 text-neutral-600" />
                            )}
                            
                            {/* Cost/Lv Badge */}
                            <span className="absolute bottom-0 right-0 bg-black/70 text-[8px] font-mono px-1 font-bold text-white rounded-tl-md">
                              {costValue}
                            </span>
                          </div>

                          {/* Info Column */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between h-14">
                            <div className="flex items-start justify-between gap-2">
                              {/* Title */}
                              <h4 className="text-sm font-bold text-white truncate group-hover:text-accent transition-colors">
                                {item.cardData.name || '未命名卡牌'}
                              </h4>
                              {/* Serial */}
                              <span className="text-[10px] text-neutral-500 shrink-0">
                                {item.cardData.serialNumber || 'AA-000'}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Type badge */}
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 shrink-0">
                                {typeLabels[item.cardData.cardType] || '卡牌'}
                              </span>
                              {/* Attribute badge */}
                              {attrName && (
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0",
                                  attrName === '红' && "bg-red-950/50 text-red-400",
                                  attrName === '蓝' && "bg-blue-950/50 text-blue-400",
                                  attrName === '绿' && "bg-emerald-950/50 text-emerald-400",
                                  attrName === '黄' && "bg-yellow-950/50 text-yellow-500",
                                  attrName === '黑' && "bg-zinc-900 text-zinc-400 border border-white/5",
                                  attrName === '白' && "bg-white/15 text-white"
                                )}>
                                  {attrName}
                                </span>
                              )}
                              
                              {/* Trait or race */}
                              {item.cardData.cardType.startsWith('spirit') && item.cardData.spirit.race && (
                                <span className="text-[10px] text-neutral-500 shrink-0 truncate max-w-[80px]">
                                  {item.cardData.spirit.race}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quick Actions Column */}
                          <div className="flex flex-wrap items-center justify-end gap-1 ml-1 shrink-0 max-w-[220px]">
                            <select
                              value={item.groupId || 'ungrouped'}
                              onChange={(event) => updateCardGroup(item.id, event.target.value)}
                              className="max-w-[90px] h-8 rounded-lg bg-neutral-800 border border-white/10 px-2 text-[10px] font-bold text-neutral-300 outline-none hover:border-accent focus:border-accent"
                              title="移动到分组"
                            >
                              <option value="ungrouped">未分组</option>
                              {libraryGroups.map(group => (
                                <option key={group.id} value={group.id}>{group.name}</option>
                              ))}
                            </select>

                            {/* Load / Edit */}
                            <button 
                              onClick={() => loadCardFromLibrary(item)}
                              className="p-1.5 rounded-lg bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition"
                              title="加载进编辑器进行修改"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>

                            {/* Clone card */}
                            <button 
                              onClick={() => cloneCardInLibrary(item)}
                              className="p-1.5 rounded-lg bg-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700 transition"
                              title="复制此卡牌副本"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>

                            {/* Export PNG */}
                            <button 
                              onClick={() => handleExportSingleCard(item)}
                              disabled={exportingCardId === item.id}
                              className={cn(
                                "flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent hover:text-white transition disabled:opacity-60 disabled:cursor-wait text-[11px] font-bold",
                                exportingCardId === item.id && "bg-accent text-white"
                              )}
                              title="将此卡片渲染导出为高保真 PNG"
                            >
                              <Download className={cn("w-3.5 h-3.5", exportingCardId === item.id && "animate-pulse")} />
                              高清PNG
                            </button>

                            {/* Delete */}
                            <button 
                              onClick={() => deleteFromLibrary(item.id, item.cardData.name)}
                              className="p-1.5 rounded-lg bg-red-950/20 text-red-500 hover:bg-red-500 hover:text-white transition"
                              title="删除卡牌"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : activeTab === 'editor' ? (
              <>
                {/* Grid Toggle */}
                <div className="flex items-center justify-between p-4 bg-accent/10 border border-accent/20 rounded-xl mb-6">
                  <div className="flex items-center gap-2">
                    <Grid className="w-4 h-4 text-accent" />
                    <span className="text-sm font-bold text-accent">显示参考网格</span>
                  </div>
                  <button 
                    onClick={() => setShowGrid(!showGrid)}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative",
                      showGrid ? "bg-accent" : "bg-neutral-700"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      showGrid ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>

                {/* A. Basic Info */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-accent">
                    <Type className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-widest text-sm">基本信息</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">卡片名称</label>
                      <input 
                        type="text" 
                        value={cardData.name}
                        onChange={(e) => updateField('name', e.target.value)}
                        className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors font-sans"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">卡片类型</label>
                      <select 
                        value={cardData.cardType}
                        onChange={(e) => {
                          const newType = e.target.value as CardType;
                          updateField('cardType', newType);
                          if (newType === 'trace') {
                            updateField('attribute', '痕迹');
                          } else if (cardData.attribute === '痕迹') {
                            updateField('attribute', '黑'); // Default back to something else
                          }
                        }}
                        className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors appearance-none"
                      >
                        <option value="master">域主卡 (Master)</option>
                        <option value="spirit_normal">普通域灵 (Normal Spirit)</option>
                        <option value="spirit_resonance">共鸣域灵 (Resonance Spirit)</option>
                        <option value="trace">痕迹卡 (Trace)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">属性 (Attribute)</label>
                      <select 
                        value={cardData.attribute}
                        onChange={(e) => updateField('attribute', e.target.value)}
                        disabled={cardData.cardType === 'trace'}
                        className={cn(
                          "w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors appearance-none",
                          cardData.cardType === 'trace' && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {Object.keys(assets.attributes)
                          .filter(attr => cardData.cardType === 'trace' ? attr === '痕迹' : attr !== '痕迹')
                          .map(attr => (
                            <option key={attr} value={attr}>{attr}</option>
                          ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">卡牌编号</label>
                      <input 
                        type="text" 
                        value={cardData.serialNumber}
                        onChange={(e) => updateField('serialNumber', e.target.value)}
                        className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors"
                      />
                    </div>
                  </div>

                  <ImageInput 
                    label="插画 (Card Art)" 
                    value={cardData.image}
                    onChange={(val) => updateField('image', val)}
                  />
                </div>

                {/* B. Dynamic Fields */}
                <AnimatePresence mode="wait">
                  <motion.div 
                    key={cardData.cardType}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-8"
                  >
                    <div className="flex items-center gap-2 text-accent">
                      <Zap className="w-5 h-5" />
                      <h3 className="font-bold uppercase tracking-widest text-sm">类型专属字段</h3>
                    </div>

                    {cardData.cardType === 'master' && (
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">初始状态</label>
                          <div className="flex gap-2">
                            {['未觉醒', '觉醒'].map(s => (
                              <button 
                                key={s}
                                onClick={() => updateField('master.state', s)}
                                className={cn(
                                  "flex-1 py-2 rounded-lg border transition-all text-sm font-medium",
                                  cardData.master.state === s ? "bg-accent border-accent text-white" : "bg-neutral-800 border-white/10 text-neutral-400 hover:border-white/20"
                                )}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">维持费用</label>
                          <input 
                            type="text" 
                            value={cardData.master.maintenance}
                            onChange={(e) => updateField('master.maintenance', e.target.value)}
                            className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">觉醒条件</label>
                          <textarea 
                            value={cardData.master.triggerCondition}
                            onChange={(e) => updateField('master.triggerCondition', e.target.value)}
                            className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors h-20 resize-none"
                          />
                        </div>
                      </div>
                    )}

                    {(cardData.cardType === 'spirit_normal' || cardData.cardType === 'spirit_resonance') && (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">费用 (Cost)</label>
                      <select 
                        value={cardData.spirit.cost}
                        onChange={(e) => updateField('spirit.cost', parseInt(e.target.value))}
                        className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors appearance-none"
                      >
                        {[1, 2, 3, 4, 5, 6].map(num => (
                          <option key={num} value={num}>{num}点域能</option>
                        ))}
                      </select>
                    </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-neutral-500">
                            <div className="h-px flex-1 bg-white/5" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">攻击力得分</span>
                            <div className="h-px flex-1 bg-white/5" />
                          </div>
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">攻击力 (ATK)</label>
                              <input 
                                type="number" 
                                value={isNaN(cardData.spirit.attack) ? '' : cardData.spirit.attack}
                                onChange={(e) => updateField('spirit.attack', e.target.value === '' ? 0 : parseInt(e.target.value))}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">得分 (ZP)</label>
                              <input 
                                type="number" 
                                value={isNaN(cardData.spirit.domainValue) ? '' : cardData.spirit.domainValue}
                                onChange={(e) => updateField('spirit.domainValue', e.target.value === '' ? 0 : parseInt(e.target.value))}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-neutral-500">
                            <div className="h-px flex-1 bg-white/5" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">种族特性</span>
                            <div className="h-px flex-1 bg-white/5" />
                          </div>
                          <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">种族/种类</label>
                              <select 
                                value={cardData.spirit.race}
                                onChange={(e) => updateField('spirit.race', e.target.value)}
                                className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors appearance-none"
                              >
                                {['人界域', '天界域', '魔界域', '机界域', '精灵界域', '兽界域', '龙界域'].map(r => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">特性标记 (多选)</label>
                              <div className="flex flex-wrap gap-2">
                                {['限制', '登场', '共鸣', '战斗', '吟唱', '遗言'].map(t => {
                                  const traits = cardData.spirit.trait.split('/').filter(Boolean);
                                  const isActive = traits.includes(t);
                                  return (
                                    <button
                                      key={t}
                                      onClick={() => {
                                        let newTraits;
                                        if (isActive) {
                                          newTraits = traits.filter(x => x !== t);
                                        } else {
                                          // Keep the order consistent with the defined list
                                          const order = ['限制', '登场', '共鸣', '战斗', '吟唱', '遗言'];
                                          const currentSet = new Set([...traits, t]);
                                          newTraits = order.filter(item => currentSet.has(item));
                                        }
                                        updateField('spirit.trait', newTraits.join('/'));
                                      }}
                                      className={cn(
                                        "px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                        isActive 
                                          ? "bg-accent border-accent text-white shadow-lg shadow-accent/20" 
                                          : "bg-neutral-800 border-white/10 text-neutral-400 hover:border-white/20"
                                      )}
                                    >
                                      {t}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {cardData.cardType === 'trace' && (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-6">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">费用</label>
                            <select 
                              value={cardData.trace.cost}
                              onChange={(e) => updateField('trace.cost', parseInt(e.target.value))}
                              className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors appearance-none"
                            >
                              {[1, 2, 3, 4, 5, 6].map(num => (
                                <option key={num} value={num}>{num}点域能</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">特性标记 (多选)</label>
                          <div className="flex flex-wrap gap-2">
                            {['普通', '结界'].map(t => {
                              const types = cardData.trace.traceType.split('/').filter(Boolean);
                              const isActive = types.includes(t);
                              return (
                                <button
                                  key={t}
                                  onClick={() => {
                                    let newTypes;
                                    if (isActive) {
                                      newTypes = types.filter(x => x !== t);
                                    } else {
                                      const order = ['普通', '结界'];
                                      const currentSet = new Set([...types, t]);
                                      newTypes = order.filter(item => currentSet.has(item));
                                    }
                                    updateField('trace.traceType', newTypes.join('/'));
                                  }}
                                  className={cn(
                                    "px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                                    isActive 
                                      ? "bg-accent border-accent text-white shadow-lg shadow-accent/20" 
                                      : "bg-neutral-800 border-white/10 text-neutral-400 hover:border-white/20"
                                  )}
                                >
                                  {t}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                {/* C. Effect Editor */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-accent">
                    <Layers className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-widest text-sm">效果与台词</h3>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {effectTagOptions.map(kw => (
                      <button 
                        key={kw}
                        onClick={() => insertKeyword(kw)}
                        className="px-3 py-1 bg-neutral-800 border border-white/10 rounded hover:bg-neutral-700 hover:border-accent transition-all text-xs font-bold"
                      >
                        【{kw}】
                      </button>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">效果文本</label>
                      <textarea 
                        ref={effectTextRef}
                        value={getEffectEditorValue()}
                        onKeyDown={handleEffectEditorKeyDown}
                        onChange={(e) => updateEffectEditorValue(e.target.value)}
                        className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-accent transition-colors h-32 resize-none font-sans text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* D. Matrix Editor */}
                {(cardData.cardType === 'master' || cardData.cardType === 'spirit_resonance') && (
                  <div className="space-y-6 pb-12">
                    <div className="flex items-center gap-2 text-accent">
                      <Grid className="w-5 h-5" />
                      <h3 className="font-bold uppercase tracking-widest text-sm">共鸣阵图</h3>
                    </div>
                    
                    <div className="flex items-start gap-8">
                      <div className="matrix-grid bg-neutral-800 p-2 rounded-xl border border-white/10 gap-2">
                        {cardData.matrix.map((val, i) => (
                          <button 
                            key={i} 
                            onClick={() => toggleMatrix(i)}
                            className={cn(
                              "w-12 h-12 rounded-lg transition-all flex items-center justify-center text-lg font-bold",
                              val === 0 ? "bg-neutral-900 text-neutral-700 hover:bg-neutral-800" : 
                              "bg-red-600 text-white shadow-lg shadow-red-600/20"
                            )}
                          >
                            {getMatrixLabel(i)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Material Library Tab */
              <div className="space-y-10">
                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-accent">
                    <Layers className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-widest text-sm">卡牌基础版型 (Templates)</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {(Object.entries(assets.templates) as [string, string][]).map(([type, url]) => {
                      const typeLabel = type === 'master' ? '域主卡' : 
                                       type === 'spirit_normal' ? '普通域灵' : 
                                       type === 'spirit_resonance' ? '共鸣域灵' : '痕迹卡';
                      const isDefault = type === 'spirit_normal' && url === INITIAL_ASSETS.templates.spirit_normal;
                      
                      return (
                        <ImageInput 
                          key={type}
                          label={`${typeLabel} 版型 ${isDefault ? '(内置)' : ''}`}
                          value={url}
                          onChange={(val) => updateAsset('templates', type, val)}
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-6 pb-12">
                  <div className="flex items-center gap-2 text-accent">
                    <Zap className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-widest text-sm">域灵属性素材 (Attributes)</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {(Object.entries(assets.attributes) as [string, string][]).map(([attr, url]) => (
                      <ImageInput 
                        key={attr}
                        label={`${attr} 图标`}
                        value={url}
                        onChange={(val) => updateAsset('attributes', attr, val)}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-6 pb-12">
                  <div className="flex items-center gap-2 text-accent">
                    <Zap className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-widest text-sm">费用图标素材 (Costs)</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    {(Object.entries(assets.costs) as [string, string][]).map(([cost, url]) => (
                      <ImageInput 
                        key={cost}
                        label={`费用 ${cost} 图标`}
                        value={url}
                        onChange={(val) => updateAsset('costs', cost, val)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      )}

      {/* Off-screen CardPreview for high-fidelity export, free from styling zooms/scales */}
      <div
        className="fixed pointer-events-none" style={{ left: '5000px', top: '0px', width: `${CARD_WIDTH}px`, overflow: 'visible' }}
      >
        <div ref={exportRef} style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px`, transform: 'none', transition: 'none', position: 'relative' }}>
          <CardPreview data={cardData} assets={assets} showGrid={false} forExport />
        </div>
      </div>

      {/* Off-screen CardPreview for card library single & batch exports */}
      <div
        className="fixed pointer-events-none" style={{ left: '5000px', top: '1000px', width: `${singleExportWidth}px`, overflow: 'visible' }}
      >
        <div ref={batchExportRef} style={{ width: `${singleExportWidth}px`, height: `${Math.round(singleExportWidth * 86 / 59)}px`, transform: 'none', transition: 'none', position: 'relative' }}>
          {batchExportCard && (
            <CardPreview data={batchExportCard} assets={batchExportAssets || assets} showGrid={false} forExport exportWidth={singleExportWidth} />
          )}
        </div>
      </div>

    </div>
  );
}

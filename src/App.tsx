/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  ZoomIn,
  ZoomOut,
  Maximize,
  Edit,
  Copy,
  FileJson,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import JSZip from 'jszip';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CardData, CardType, INITIAL_CARD_DATA, AssetLibrary, INITIAL_ASSETS, SavedCard } from './types';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Helper to proxy external image URLs to bypass CORS constraints entirely on both display and export
function getProxiedUrl(url: string | undefined | null) {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/') || !trimmed.startsWith('http')) {
    return trimmed;
  }
  return `/api/proxy?url=${encodeURIComponent(trimmed)}`;
}

type ParsedCardFields = Record<string, string>;

const FIELD_ALIASES: Array<[string, string[]]> = [
  ['name', ['name', '名称', '卡名', '卡牌名', '卡牌名称']],
  ['cardType', ['type', 'cardType', '类型', '卡牌类型', '种类']],
  ['serialNumber', ['serial', 'serialNumber', '编号', '序号', '卡号']],
  ['image', ['image', '图片', '插图', '立绘', '图片链接', '插图链接']],
  ['attribute', ['attribute', '属性', '主属性', '颜色']],
  ['flavorText', ['flavor', 'flavorText', '背景', '背景描述', '风味文本', '台词']],
  ['matrix', ['matrix', '矩阵', '格子', '阵列']],
  ['master.state', ['state', '状态', '觉醒状态']],
  ['master.triggerCondition', ['trigger', 'triggerCondition', '触发', '触发条件']],
  ['master.activeSkill', ['active', 'activeSkill', '主动', '主动技能']],
  ['master.passiveSkill', ['passive', 'passiveSkill', '被动', '被动技能']],
  ['master.maintenance', ['maintenance', '维持', '维持费用']],
  ['spirit.cost', ['cost', '费用', '召唤费用']],
  ['spirit.attributes', ['attributes', '副属性', '属性组', '多属性']],
  ['spirit.trait', ['trait', '特性', '标签']],
  ['spirit.keywords', ['keywords', '关键词', '关键字']],
  ['spirit.race', ['race', '种族', '族类']],
  ['spirit.attack', ['attack', '攻击', '攻击力']],
  ['spirit.domainValue', ['domainValue', '域值', '领域值']],
  ['spirit.effectText', ['effect', 'effectText', '效果', '效果文本', '能力']],
  ['trace.traceType', ['traceType', '痕迹类型', '法术类型']],
  ['trace.cost', ['traceCost', '痕迹费用', '费用']],
  ['trace.effectCost', ['effectCost', '效果费用']],
  ['trace.canUseOnOpponentTurn', ['quick', '对方回合', '是否速攻']],
  ['trace.extraCost', ['extraCost', '额外费用']],
  ['trace.effectText', ['traceEffect', '痕迹效果', '效果', '效果文本']],
];

function normalizeFieldKey(key: string) {
  const normalized = key.trim().replace(/\s+/g, '').toLowerCase();
  for (const [target, aliases] of FIELD_ALIASES) {
    if (aliases.some(alias => alias.toLowerCase() === normalized)) return target;
  }
  return key.trim();
}

function splitList(value: string) {
  return value.split(/[,\u3001，/|；;]+/).map(item => item.trim()).filter(Boolean);
}

function parseNumber(value: string, fallback: number) {
  const match = value.match(/-?\d+/);
  return match ? Number(match[0]) : fallback;
}

function parseBoolean(value: string) {
  return /^(true|yes|y|1|是|可|可以|能|速攻|对方回合)$/i.test(value.trim());
}

const SPIRIT_TRAIT_ORDER = ['限制', '登场', '共鸣', '战斗', '吟唱', '遗言'];
const EFFECT_TAGS = [...SPIRIT_TRAIT_ORDER, '普通', '结界', '痕迹', '退场', '领域', '发动条件', '效果'];
const MATRIX_LABELS = [-8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8];

function parseMatrix(value: string, fallback: number[]) {
  const binary = value.match(/[01]/g)?.map(Number);
  if (binary?.length === 16) return binary;

  const next = Array(16).fill(0);
  const labels = value.match(/-?\d+/g)?.map(Number).filter(num => MATRIX_LABELS.includes(num)) || [];
  if (labels.length === 0) return fallback;
  labels.forEach(label => {
    const index = MATRIX_LABELS.indexOf(label);
    if (index >= 0) next[index] = 1;
  });
  return next;
}

function normalizeKnownItems(value: string, order: string[]) {
  const items = splitList(value).map(item => item.replace(/[【】]/g, '').trim()).filter(Boolean);
  const itemSet = new Set(items);
  const ordered = order.filter(item => itemSet.has(item));
  const extras = items.filter(item => !order.includes(item));
  return [...ordered, ...extras];
}

function normalizeEffectTag(label: string) {
  const trimmed = label.replace(/[【】]/g, '').trim();
  if (trimmed === '条件') return '发动条件';
  return EFFECT_TAGS.includes(trimmed) ? trimmed : '';
}

function formatEffectTextWithTags(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(rawLine => {
      const line = rawLine.trim();
      if (!line) return '';

      const bracketMatch = line.match(/^【([^】]+)】\s*(.*)$/);
      if (bracketMatch) {
        const tag = normalizeEffectTag(bracketMatch[1]);
        return tag ? `【${tag}】 ${bracketMatch[2].trim()}`.trim() : line;
      }

      const colonMatch = line.match(/^([^:：]{1,12})\s*[:：]\s*(.*)$/);
      if (!colonMatch) return line;

      const tag = normalizeEffectTag(colonMatch[1]);
      return tag ? `【${tag}】 ${colonMatch[2].trim()}`.trim() : line;
    })
    .filter(Boolean)
    .join('\n');
}

function extractEffectTags(value: string) {
  return formatEffectTextWithTags(value)
    .split('\n')
    .map(line => line.match(/^【([^】]+)】/)?.[1] || '')
    .filter(tag => SPIRIT_TRAIT_ORDER.includes(tag));
}

function normalizeCardType(value: string | undefined, fields: ParsedCardFields): CardType {
  const raw = (value || '').trim().toLowerCase();
  if (raw.includes('master') || raw.includes('主')) return 'master';
  if (raw.includes('trace') || raw.includes('痕')) return 'trace';
  if (fields.matrix) return 'spirit_resonance';
  if (raw.includes('resonance') || raw.includes('共鸣')) return 'spirit_resonance';
  if (fields['trace.effectText'] || fields['trace.cost'] || fields['trace.traceType']) return 'trace';
  if (fields['master.activeSkill'] || fields['master.passiveSkill'] || fields['master.triggerCondition']) return 'master';
  return 'spirit_normal';
}

function extractPlainTextFromXml(xml: string) {
  const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = Array.from(documentXml.getElementsByTagName('w:p'));
  return paragraphs.map(paragraph => {
    const chunks: string[] = [];
    paragraph.childNodes.forEach(run => {
      if (!(run instanceof Element)) return;
      Array.from(run.getElementsByTagName('w:t')).forEach(textNode => chunks.push(textNode.textContent || ''));
      if (run.getElementsByTagName('w:tab').length) chunks.push('\t');
      if (run.getElementsByTagName('w:br').length) chunks.push('\n');
    });
    return chunks.join('');
  }).filter(line => line.trim()).join('\n');
}

async function readDocxText(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('DOCX 文件缺少 word/document.xml');
  return extractPlainTextFromXml(await documentFile.async('string'));
}

function parseCardBlocks(text: string) {
  const blocks: ParsedCardFields[] = [];
  let current: ParsedCardFields = {};
  let lastKey = '';

  const pushCurrent = () => {
    if (Object.keys(current).length === 0) return;
    blocks.push(current);
    current = {};
    lastKey = '';
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[-=_*#]{3,}$/.test(line) || /^第?\s*\d+\s*[张份]?\s*卡/.test(line)) {
      pushCurrent();
      continue;
    }

    const match = line.match(/^([^:：=]{1,32})\s*[:：=]\s*(.*)$/);
    if (match) {
      const key = normalizeFieldKey(match[1]);
      if (key === 'name' && current.name) pushCurrent();
      current[key] = match[2].trim();
      lastKey = key;
      continue;
    }

    if (lastKey) current[lastKey] = `${current[lastKey]}\n${line}`.trim();
  }

  pushCurrent();
  return blocks;
}

function normalizeTextLines(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim());
}

function splitSimpleCardBlocks(text: string) {
  const blocks: string[][] = [];
  let current: string[] = [];
  const headerPattern = /^(.+?)\s*[|｜]\s*(\d+)\s*[|｜]\s*(.+)$/;

  const pushCurrent = () => {
    if (current.length === 0) return;
    blocks.push(current);
    current = [];
  };

  for (const line of normalizeTextLines(text)) {
    if (!line || /^[|｜]+$/.test(line)) continue;
    if (/^[-=_*#]{3,}$/.test(line)) {
      pushCurrent();
      continue;
    }
    if (headerPattern.test(line) && current.length > 0) {
      pushCurrent();
    }
    current.push(line);
  }

  pushCurrent();
  return blocks;
}

function parseBracketMeta(value: string) {
  const trimmed = value.replace(/^【/, '').replace(/】$/, '');
  return splitList(trimmed);
}

function isSimpleTraceKind(value: string) {
  const normalized = value.trim().toLowerCase();
  return ['痕', '痕迹', '痕迹卡', 'trace'].includes(normalized);
}

function parseSimpleCardBlocks(text: string) {
  return splitSimpleCardBlocks(text).map((lines, index) => {
    const fields: ParsedCardFields = {
      serialNumber: `AUTO-${String(index + 1).padStart(3, '0')}`,
    };

    const header = lines[0]?.match(/^(.+?)\s*[|｜]\s*(\d+)\s*[|｜]\s*(.+)$/);
    if (!header) return null;

    fields.name = header[1].trim();
    const cost = header[2].trim();
    const kindOrAttribute = header[3].trim();

    if (isSimpleTraceKind(kindOrAttribute)) {
      fields.cardType = '痕迹';
      fields['trace.cost'] = cost;

      let effectStartIndex = 1;
      if (lines[1]?.startsWith('【')) {
        const meta = parseBracketMeta(lines[1]);
        fields['trace.traceType'] = meta[0] || '';
        effectStartIndex = 2;
      } else if (lines[1] && !/[:：]/.test(lines[1])) {
        fields['trace.traceType'] = lines[1].trim();
        effectStartIndex = 2;
      }

      fields['trace.effectText'] = lines.slice(effectStartIndex).join('\n');
      return fields;
    }

    const stats = lines[1]?.match(/^(\d+)\s*[|｜]\s*(\d+)$/);
    if (!stats) return null;

    fields['spirit.cost'] = cost;
    fields.attribute = kindOrAttribute;
    fields['spirit.attack'] = stats[1].trim();
    fields['spirit.domainValue'] = stats[2].trim();

    let metaLine = '';
    let effectStartIndex = 2;
    if (lines[2] && !lines[2].startsWith('【')) {
      fields.matrix = lines[2];
      effectStartIndex = 3;
    }
    if (lines[effectStartIndex]?.startsWith('【')) {
      metaLine = lines[effectStartIndex];
      const meta = parseBracketMeta(metaLine);
      fields['spirit.race'] = meta[0] || '';
      fields['spirit.keywords'] = meta.slice(1).join('、');
      effectStartIndex += 1;
    }

    const effectLines = lines.slice(effectStartIndex);
    fields['spirit.effectText'] = effectLines.join('\n');
    fields.cardType = fields.matrix ? '共鸣域灵' : '普通域灵';

    return fields;
  }).filter(Boolean) as ParsedCardFields[];
}

function parseImportText(text: string) {
  const fieldBlocks = parseCardBlocks(text);
  if (fieldBlocks.some(block => block.name || block.cardType || block['spirit.effectText'] || block['trace.effectText'])) {
    return fieldBlocks;
  }
  return parseSimpleCardBlocks(text);
}

function fieldsToCardData(fields: ParsedCardFields): CardData {
  const card = JSON.parse(JSON.stringify(INITIAL_CARD_DATA)) as CardData;
  const cardType = normalizeCardType(fields.cardType, fields);

  card.cardType = cardType;
  card.name = fields.name || card.name;
  card.serialNumber = fields.serialNumber || card.serialNumber;
  card.image = fields.image || card.image;
  card.attribute = fields.attribute || card.attribute;
  card.flavorText = fields.flavorText || card.flavorText;
  card.imageScale = 1;
  card.imageOffset = { x: 0, y: 0 };

  if (fields.matrix) {
    card.matrix = parseMatrix(fields.matrix, card.matrix);
  }

  if (fields['master.state']) card.master.state = fields['master.state'];
  if (fields['master.triggerCondition']) card.master.triggerCondition = fields['master.triggerCondition'];
  if (fields['master.activeSkill']) card.master.activeSkill = fields['master.activeSkill'];
  if (fields['master.passiveSkill']) card.master.passiveSkill = fields['master.passiveSkill'];
  if (fields['master.maintenance']) card.master.maintenance = fields['master.maintenance'];

  if (fields['spirit.cost']) card.spirit.cost = parseNumber(fields['spirit.cost'], card.spirit.cost);
  if (fields['spirit.attributes']) card.spirit.attributes = splitList(fields['spirit.attributes']);
  const importedTraitValue = fields['spirit.trait'] || fields['spirit.keywords'];
  if (importedTraitValue) {
    const traits = normalizeKnownItems(importedTraitValue, SPIRIT_TRAIT_ORDER);
    card.spirit.trait = traits.join('/');
    card.spirit.keywords = traits;
  }
  if (fields['spirit.race']) card.spirit.race = fields['spirit.race'];
  if (fields['spirit.attack']) card.spirit.attack = parseNumber(fields['spirit.attack'], card.spirit.attack);
  if (fields['spirit.domainValue']) card.spirit.domainValue = parseNumber(fields['spirit.domainValue'], card.spirit.domainValue);
  if (fields['spirit.effectText']) {
    card.spirit.effectText = formatEffectTextWithTags(fields['spirit.effectText']);
    if (!importedTraitValue) {
      const traits = normalizeKnownItems(extractEffectTags(card.spirit.effectText).join('、'), SPIRIT_TRAIT_ORDER);
      if (traits.length > 0) {
        card.spirit.trait = traits.join('/');
        card.spirit.keywords = traits;
      }
    }
  }

  if (!fields['spirit.attributes'] && fields.attribute) card.spirit.attributes = splitList(fields.attribute);

  if (fields['trace.traceType']) card.trace.traceType = fields['trace.traceType'];
  if (fields['trace.cost']) card.trace.cost = parseNumber(fields['trace.cost'], card.trace.cost);
  if (fields['trace.effectCost']) card.trace.effectCost = fields['trace.effectCost'];
  if (fields['trace.canUseOnOpponentTurn']) card.trace.canUseOnOpponentTurn = parseBoolean(fields['trace.canUseOnOpponentTurn']);
  if (fields['trace.extraCost']) card.trace.extraCost = fields['trace.extraCost'];
  if (fields['trace.effectText']) card.trace.effectText = formatEffectTextWithTags(fields['trace.effectText']);

  return card;
}

function makeSavedCard(cardData: CardData): SavedCard {
  return {
    id: 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
    createdAt: Date.now(),
    cardData,
  };
}

// --- Components ---

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

const getMatrixLabel = (index: number) => {
  if (index < 8) return index - 8;
  return index - 7;
};

const MatrixDisplay = ({ matrix, size = "small" }: { matrix: number[], size?: "small" | "large" }) => {
  const cellSize = size === "small" ? "w-2.5 h-2.5" : "w-10 h-10";
  const fontSize = size === "small" ? "text-[5.5px]" : "text-[10px]";
  return (
    <div className={cn("matrix-grid bg-black/20 p-0.5 rounded-sm", size === "large" ? "gap-1" : "gap-0.5")}>
      {matrix.map((val, i) => (
        <div 
          key={i} 
          className={cn(
            cellSize, 
            "rounded-full transition-colors flex items-center justify-center border border-white/5",
            val === 0 ? "bg-white/10" : "bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.8)]"
          )} 
        >
          <span className={cn(fontSize, val === 0 ? "text-white/30" : "text-white font-black")}>
            {getMatrixLabel(i)}
          </span>
        </div>
      ))}
    </div>
  );
};

const CARD_WIDTH = 380;
const CARD_HEIGHT = Math.round(CARD_WIDTH * 86 / 59); // 554
const A4_EXPORT_WIDTH = 1240;
const A4_EXPORT_HEIGHT = Math.round(A4_EXPORT_WIDTH * 297 / 210);
const A4_MAX_CARDS = 12;
const A4_PADDING = 70;
const A4_GAP = 24;

function getA4Layout(count: number) {
  const normalizedCount = Math.max(1, Math.min(A4_MAX_CARDS, count));
  const cardRatio = CARD_WIDTH / CARD_HEIGHT;
  let best = {
    cols: 1,
    rows: normalizedCount,
    cardWidth: 0,
    cardHeight: 0,
    area: 0,
  };

  for (let cols = 1; cols <= Math.min(4, normalizedCount); cols++) {
    const rows = Math.ceil(normalizedCount / cols);
    const availableWidth = A4_EXPORT_WIDTH - A4_PADDING * 2 - A4_GAP * (cols - 1);
    const availableHeight = A4_EXPORT_HEIGHT - A4_PADDING * 2 - A4_GAP * (rows - 1);
    const cardWidth = Math.min(availableWidth / cols, (availableHeight / rows) * cardRatio);
    const cardHeight = cardWidth / cardRatio;
    const area = cardWidth * cardHeight;

    if (area > best.area) {
      best = { cols, rows, cardWidth, cardHeight, area };
    }
  }

  return best;
}

const CardPreview = React.forwardRef<HTMLDivElement, {
  data: CardData,
  assets: AssetLibrary,
  showGrid?: boolean,
  forExport?: boolean,
  onImageAdjust?: (scale: number, offset: { x: number, y: number }) => void
}>(({ data, assets, showGrid, forExport, onImageAdjust }, ref) => {
  const formatText = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      // Format keywords like 【登场】 into black boxes without brackets
      const formattedLine = line.replace(/【(.*?)】/g, (match, p1) => {
        const keywords = ['限制', '登场', '共鸣', '战斗', '吟唱', '遗言', '普通', '结界', '痕迹', '退场', '领域', '发动条件', '效果'];
        if (keywords.includes(p1)) {
          return `<span class="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[6px] h-[9px] inline-flex items-center justify-center relative -top-[0.5px] align-middle leading-none">${p1}</span>`;
        }
        return `<span class="text-accent font-bold">【${p1}】</span>`;
      });
      return <p key={i} className="mb-0.5 leading-[1.3] text-justify break-all" dangerouslySetInnerHTML={{ __html: formattedLine }} />;
    });
  };

  const templateImg = assets.templates[data.cardType];
  const attrIcon = assets.attributes[data.attribute];
  const costValue = (data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') ? data.spirit.cost : data.trace.cost;
  const costIcon = assets.costs[costValue];

  const [illustrationScale, setIllustrationScale] = useState(data.imageScale ?? 1);
  const [illustrationOffset, setIllustrationOffset] = useState(data.imageOffset ?? { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setIllustrationScale(data.imageScale ?? 1);
    setIllustrationOffset(data.imageOffset ?? { x: 0, y: 0 });
  }, [data.image, data.imageScale, data.imageOffset]);

  const handleWheel = (e: React.WheelEvent) => {
    // Zooming
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const nextScale = Math.max(0.1, Math.min(10, illustrationScale + delta));
    setIllustrationScale(nextScale);
    onImageAdjust?.(nextScale, illustrationOffset);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - illustrationOffset.x, y: e.clientY - illustrationOffset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const nextOffset = {
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    };
    setIllustrationOffset(nextOffset);
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      onImageAdjust?.(illustrationScale, illustrationOffset);
    }
  };

  return (
    <div 
      ref={ref}
      className={cn(
        "relative bg-white rounded-[12px] overflow-hidden shadow-2xl flex flex-col font-sans text-neutral-900 select-none",
        !forExport && "aspect-[59/86] w-full max-w-[380px]"
      )}
      style={forExport ? { width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` } : undefined}
      id="card-preview"
    >
      {/* 0. Base Template Background */}
      <div className="absolute inset-0 z-0">
        {templateImg ? (
          <img 
            src={getProxiedUrl(templateImg)} 
            alt="template" 
            className="w-full h-full object-cover pointer-events-none"
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
          />
        ) : null}
      </div>

      {/* 1. Illustration Area (The Green Frame) */}
      <div 
        className="absolute top-[9.3%] left-[4.95%] right-[5.5%] h-[56.5%] overflow-hidden z-1 cursor-move rounded-[4px]"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {data.image ? (
          <img 
            src={getProxiedUrl(data.image)} 
            alt={data.name} 
            className="w-full h-full object-cover pointer-events-none select-none"
            style={{
              transform: `translate(${illustrationOffset.x}px, ${illustrationOffset.y}px) scale(${illustrationScale})`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
          />
        ) : (
          <div className="w-full h-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">
            等待添加插画...
          </div>
        )}
      </div>

      {/* 2. Title & Cost Overlay (Top) */}
      <div className="absolute top-[1.2%] left-[5%] right-[2%] h-[5.5%] flex items-center justify-between z-10">
        <h2 className="text-[15px] font-black tracking-tighter text-neutral-900 drop-shadow-sm truncate max-w-[65%] leading-[1.2] py-0.5">
          {data.name}
        </h2>
        <div className="flex items-center">
          <div className="w-[30px] h-[30px] flex items-center justify-center overflow-hidden z-10">
            {costIcon ? (
              <img src={getProxiedUrl(costIcon)} alt={`cost-${costValue}`} className="w-full h-full object-contain" referrerPolicy="no-referrer" crossOrigin="anonymous" />
            ) : (
              <span className="text-[18px] font-black text-neutral-900">{costValue}</span>
            )}
          </div>
          <div className="w-[30px] h-[30px] flex items-center justify-center overflow-hidden ml-[-8px] z-20">
            {attrIcon ? (
              <img src={getProxiedUrl(attrIcon)} alt={data.attribute} className="w-full h-full object-contain" referrerPolicy="no-referrer" crossOrigin="anonymous" />
            ) : (
              <span className="text-[14px] font-black text-neutral-900">{data.attribute}</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Type / Stats Line (Middle Bar) */}
      <div className="absolute top-[66.8%] left-[4%] right-[7%] h-[4%] flex items-center justify-between z-10 whitespace-nowrap">
        <div className="text-[10px] font-medium text-neutral-900 text-left tracking-[-0.08em] leading-none whitespace-nowrap">
          {data.cardType === 'master' && <span>【域主 / {data.master.state}】</span>}
          {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && (
            <span>【{data.spirit.race} / {data.spirit.trait}】</span>
          )}
          {data.cardType === 'trace' && <span>【痕迹 / {data.trace.traceType}】</span>}
        </div>
        {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && (
          <div className="text-[10px] font-medium text-neutral-900 text-right tracking-[-0.08em] leading-none whitespace-nowrap">
            zp: {data.spirit.domainValue} / atk: {data.spirit.attack}
          </div>
        )}
      </div>

      {/* 4. Effect Area (Bottom Box) */}
      <div className="absolute top-[72%] left-[6%] right-[34%] bottom-[9%] py-0.5 text-[7px] leading-[1.45] text-neutral-900 font-medium overflow-hidden z-10 break-all whitespace-pre-wrap">
        {data.cardType === 'master' && (
          <div className="space-y-1">
            {data.master.triggerCondition && (
              <div className="flex items-start">
                <span className="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[6px] h-[9px] inline-flex items-center justify-center relative top-[1px] shrink-0">觉醒条件</span>
                <span className="flex-1">{data.master.triggerCondition}</span>
              </div>
            )}
            {data.master.activeSkill && (
              <div className="flex items-start">
                <span className="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[6px] h-[9px] inline-flex items-center justify-center relative top-[1px] shrink-0">主动</span>
                <span className="flex-1">{data.master.activeSkill}</span>
              </div>
            )}
            {data.master.passiveSkill && (
              <div className="flex items-start">
                <span className="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[6px] h-[9px] inline-flex items-center justify-center relative top-[1px] shrink-0">被动</span>
                <span className="flex-1">{data.master.passiveSkill}</span>
              </div>
            )}
          </div>
        )}
        {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && formatText(data.spirit.effectText)}
        {data.cardType === 'trace' && (
          <div className="space-y-1">
            {formatText(data.trace.effectText)}
          </div>
        )}
      </div>

      {/* 5. Footer Area (Serial & Matrix) */}
      <div className="absolute bottom-[1.5%] left-[6%] right-[6%] h-[3%] flex items-center justify-end z-10">
        <div className="text-[7px] font-mono text-neutral-900 opacity-70">
          {data.serialNumber}
        </div>
      </div>

      {/* 6. Resonance Matrix (Bottom Right Box) */}
      {(data.cardType === 'master' || data.cardType === 'spirit_resonance') && (
        <div className="absolute bottom-[12%] right-[9%] z-20 scale-[0.8] origin-bottom-right">
          <MatrixDisplay matrix={data.matrix} />
        </div>
      )}

      {/* 7. Coordinate Grid Overlay (Chessboard Style) */}
      {showGrid && (
        <div className="absolute inset-0 z-[100] pointer-events-none overflow-hidden select-none">
          {/* Grid Lines */}
          <div 
            className="absolute inset-0 opacity-30" 
            style={{ 
              backgroundImage: 'linear-gradient(rgba(255,0,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,0,0,0.3) 1px, transparent 1px)',
              backgroundSize: '5% 5%' 
            }} 
          />
          {/* Column Labels (A-T) */}
          <div className="absolute top-0 left-0 right-0 flex h-full">
            {"ABCDEFGHIJKLMNOPQRST".split("").map((char, i) => (
              <div key={char} className="flex-1 flex flex-col items-start pl-0.5">
                <span className="text-[7px] font-mono font-black text-red-500/60">{char}</span>
              </div>
            ))}
          </div>
          {/* Row Labels (1-20) */}
          <div className="absolute top-0 left-0 bottom-0 flex flex-col w-full">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex-1 flex items-start pt-0.5 pl-0.5">
                <span className="text-[7px] font-mono font-black text-red-500/60">{i + 1}</span>
              </div>
            ))}
          </div>
          {/* Cell Highlight Helper (Optional: can add hover effect if needed, but static for now) */}
        </div>
      )}
    </div>
  );
});

export default function App() {
  const [cardData, setCardData] = useState<CardData>(INITIAL_CARD_DATA);
  const [assets, setAssets] = useState<AssetLibrary>(INITIAL_ASSETS);
  const [activeTab, setActiveTab] = useState<'editor' | 'library' | 'cards_library'>('editor');
  const [zoomLevel, setZoomLevel] = useState(2.6);
  const [showGrid, setShowGrid] = useState(false);
  
  // Card library states
  const [savedCards, setSavedCards] = useState<SavedCard[]>(() => {
    try {
      const saved = localStorage.getItem('spirit_card_library');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isExportingBatch, setIsExportingBatch] = useState(false);
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 });
  const [batchExportCard, setBatchExportCard] = useState<CardData | null>(null);
  const [a4CardCount, setA4CardCount] = useState(9);
  const [a4ExportCards, setA4ExportCards] = useState<CardData[]>([]);

  const previewRef = useRef<HTMLDivElement>(null);
  const effectTextRef = useRef<HTMLTextAreaElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const batchExportRef = useRef<HTMLDivElement>(null);
  const a4SheetRef = useRef<HTMLDivElement>(null);

  // Sync saved cards to localStorage
  useEffect(() => {
    localStorage.setItem('spirit_card_library', JSON.stringify(savedCards));
  }, [savedCards]);

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

  const handleImageAdjust = (scale: number, offset: { x: number, y: number }) => {
    setCardData(prev => ({
      ...prev,
      imageScale: scale,
      imageOffset: offset
    }));
  };

  const handleExport = async () => {
    const cardEl = previewRef.current;
    if (!cardEl) return;

    try {
      const dataUrl = await toPng(cardEl, {
        pixelRatio: 3,
        cacheBust: true,
        filter: (node: Element) => {
          if (node instanceof HTMLElement && node.className && typeof node.className === 'string' && node.className.includes('z-[100]')) {
            return false;
          }
          return true;
        },
      });

      const link = document.createElement('a');
      link.download = `${cardData.name || 'card'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败，可能是由于某些图片源不支持跨域访问。请尝试更换图片源或手动截图。');
    }
  };

  const handleReset = () => {
    if (window.confirm('确定要重置当前卡牌和素材库吗？')) {
      setCardData(INITIAL_CARD_DATA);
      setAssets(INITIAL_ASSETS);
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
        if (json.cardData) setCardData(json.cardData);
        if (json.assets) setAssets(json.assets);
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
            cardData: JSON.parse(JSON.stringify(cardData))
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
        cardData: JSON.parse(JSON.stringify(cardData))
      };
      setSavedCards(prev => [newCard, ...prev]);
      setEditingCardId(newCard.id); // switch into editing mode for this added card
      alert(`已成功将高级卡牌【${cardName}】添加至您的牌库！`);
    }
  };

  const loadCardFromLibrary = (saved: SavedCard) => {
    setCardData(JSON.parse(JSON.stringify(saved.cardData)));
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
      cardData: {
        ...JSON.parse(JSON.stringify(saved.cardData)),
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

  const waitForImages = async (container: HTMLElement) => {
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(images.map(image => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }));
  };

  const handleExportSingleCard = async (card: CardData) => {
    setBatchExportCard(card);

    await new Promise(resolve => setTimeout(resolve, 200));

    if (!batchExportRef.current) {
      setBatchExportCard(null);
      alert('导出环境未就绪，请重试！');
      return;
    }

    try {
      const dataUrl = await toPng(batchExportRef.current, {
        pixelRatio: 3,
        cacheBust: true,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      });

      const link = document.createElement('a');
      link.download = `${card.name || 'card'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败，可能是存在跨域渲染受限图片！');
    } finally {
      setBatchExportCard(null);
    }
  };

  const handleBatchExport = async () => {
    if (savedCards.length === 0) {
      alert('您的牌库中无任何卡牌！');
      return;
    }

    const confirmExport = window.confirm(`准备开始批量导出牌库中的 ${savedCards.length} 张卡牌为高品质PNG。网页将逐一绘制并下载，可能会触发浏览器的多文件下载授权，请点击“允许/同意”。确定开始吗？`);
    if (!confirmExport) return;

    setIsExportingBatch(true);
    setExportProgress({ current: 0, total: savedCards.length });

    try {
      for (let i = 0; i < savedCards.length; i++) {
        const item = savedCards[i];
        setExportProgress({ current: i + 1, total: savedCards.length });
        setBatchExportCard(item.cardData);

        await new Promise(resolve => setTimeout(resolve, 350));

        if (!batchExportRef.current) continue;

        const dataUrl = await toPng(batchExportRef.current, {
          pixelRatio: 3,
          cacheBust: true,
        });

        const link = document.createElement('a');
        link.download = `${item.cardData.name || 'card'}_${item.cardData.serialNumber || 'un'}.png`;
        link.href = dataUrl;
        link.click();

        await new Promise(resolve => setTimeout(resolve, 200));
      }
      alert('所有卡牌已生成渲染任务！请检查浏览器的下载纪录。');
    } catch (err) {
      console.error('Batch export failed:', err);
      alert('批量导出发生错误，可能因为某些插画源无法跨域：' + err);
    } finally {
      setIsExportingBatch(false);
      setBatchExportCard(null);
    }
  };

  const handleExportA4Sheet = async () => {
    if (savedCards.length === 0) {
      alert('您的牌库中无任何卡牌！');
      return;
    }

    const count = Math.max(1, Math.min(A4_MAX_CARDS, savedCards.length, Number(a4CardCount) || 1));
    const cards = savedCards.slice(0, count).map(item => JSON.parse(JSON.stringify(item.cardData)) as CardData);
    setA4CardCount(count);
    setA4ExportCards(cards);

    await new Promise(resolve => setTimeout(resolve, 500));

    if (!a4SheetRef.current) {
      setA4ExportCards([]);
      alert('A4 导出环境未就绪，请重试！');
      return;
    }

    try {
      await waitForImages(a4SheetRef.current);
      const dataUrl = await toPng(a4SheetRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        width: A4_EXPORT_WIDTH,
        height: A4_EXPORT_HEIGHT,
        backgroundColor: '#ffffff',
      });

      const link = document.createElement('a');
      link.download = `A4_cards_${count}_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('A4 export failed:', err);
      alert('A4 整页导出失败，可能是存在跨域渲染受限图片！');
    } finally {
      setA4ExportCards([]);
    }
  };

  const handleExportLibraryJson = () => {
    if (savedCards.length === 0) {
      alert('您的牌库暂无卡牌数据！');
      return;
    }
    const blob = new Blob([JSON.stringify(savedCards, null, 2)], { type: 'application/json' });
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
        if (Array.isArray(json)) {
          // simple schema audit
          const valid = json.every(x => x.cardData && (x.id || x.createdAt));
          if (!valid) {
            alert('无效的牌库数据。数据字段格式不正确。');
            return;
          }
          const append = window.confirm(`检测到包含 ${json.length} 张卡牌的文件。点击【确定】将它们【追加】到当前的牌库中；或者点击【取消】将【覆盖并重置】现有牌库。`);
          
          const normalized = json.map(x => ({
            ...x,
            id: x.id ? `${x.id}_${Math.random().toString(36).substring(2, 5)}` : 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5),
            createdAt: x.createdAt || Date.now()
          }));

          if (append) {
            setSavedCards(prev => [...prev, ...normalized]);
          } else {
            setSavedCards(normalized);
          }
          alert(`成功加载并处理了 ${json.length} 张卡牌！`);
        } else {
          alert('数据根节点应该为一个包含卡牌对象的 JSON 数组。');
        }
      } catch (err) {
        alert('解析文件遇到错误：' + err);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // clean input
  };

  const handleBatchImportCards = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const lowerName = file.name.toLowerCase();
      const text = lowerName.endsWith('.docx')
        ? await readDocxText(file)
        : await file.text();

      let importedCards: SavedCard[] = [];

      if (lowerName.endsWith('.json')) {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          importedCards = json
            .map(item => item.cardData ? makeSavedCard(item.cardData) : null)
            .filter(Boolean) as SavedCard[];
        } else if (json.cardData) {
          importedCards = [makeSavedCard(json.cardData)];
        }
      } else {
        importedCards = parseImportText(text)
          .map(fieldsToCardData)
          .map(makeSavedCard);
      }

      if (importedCards.length === 0) {
        alert('没有识别到可导入的卡牌。请确认文档使用“字段名：内容”或简化段落格式。');
        return;
      }

      const append = window.confirm(`识别到 ${importedCards.length} 张卡牌。点击【确定】追加到当前牌库；点击【取消】覆盖当前牌库。`);
      if (append) {
        setSavedCards(prev => [...importedCards, ...prev]);
      } else {
        setSavedCards(importedCards);
      }

      setCardData(JSON.parse(JSON.stringify(importedCards[0].cardData)));
      setEditingCardId(importedCards[0].id);
      setActiveTab('cards_library');
      alert(`已成功批量导入 ${importedCards.length} 张卡牌。`);
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
      setEditingCardId(null);
    }
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
    
    const fieldPath = (cardData.cardType === 'spirit_normal' || cardData.cardType === 'spirit_resonance') ? 'spirit.effectText' : 'trace.effectText';
    updateField(fieldPath, newText);

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

  return (
    <div className="light-app min-h-screen flex flex-col bg-neutral-950 text-neutral-200 font-sans">
      {/* Top Action Bar */}
      <header className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-neutral-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center shadow-lg shadow-accent/20">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight">域·卡牌生成器 <span className="text-[10px] font-mono opacity-50 ml-2">v1.1</span></h1>
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
                    cardData: JSON.parse(JSON.stringify(cardData))
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

          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white px-4 py-1.5 rounded-lg font-bold text-xs transition-all shadow-lg shadow-accent/20 active:scale-95"
          >
            <Download className="w-4 h-4" />
            导出当前卡
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left: Preview */}
        <section className="w-1/2 flex items-center justify-center p-12 bg-neutral-950 relative overflow-y-auto custom-scrollbar">
          {/* Zoom Controls Overlay */}
          <div className="absolute top-6 left-6 z-20 flex items-center gap-2 bg-neutral-900/80 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5 shadow-xl">
            <button 
              onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.1))}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white"
              title="缩小"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <input 
              type="range" 
              min="0.5" 
              max="5.0" 
              step="0.1" 
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              className="w-24 accent-accent"
            />
            <button 
              onClick={() => setZoomLevel(Math.min(5.0, zoomLevel + 0.1))}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white"
              title="放大"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <button 
              onClick={() => setZoomLevel(2.6)}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white"
              title="重置缩放"
            >
              <Maximize className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-mono font-bold text-neutral-500 min-w-[40px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>

          <div className="sticky top-12 py-10">
            <div className="transition-transform duration-300 ease-out" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}>
              <CardPreview ref={previewRef} data={cardData} assets={assets} showGrid={showGrid} onImageAdjust={handleImageAdjust} />
            </div>
            <p className="mt-20 text-center text-xs text-neutral-500 font-mono opacity-50">
              5.9cm x 8.6cm • HIGH RESOLUTION (2X)
            </p>
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
                    <p className="text-[10px] text-neutral-500 mt-1">本地共存储了 {savedCards.length} 张卡牌</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {/* A4 Sheet Export */}
                    <div className="flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2 py-1 shadow-sm">
                      <span className="text-[10px] font-bold text-neutral-500">A4</span>
                      <input
                        type="number"
                        min={1}
                        max={Math.min(A4_MAX_CARDS, Math.max(1, savedCards.length))}
                        value={a4CardCount}
                        onChange={(event) => {
                          const value = Number(event.target.value) || 1;
                          setA4CardCount(Math.max(1, Math.min(A4_MAX_CARDS, value)));
                        }}
                        className="w-11 bg-neutral-100 border border-neutral-300 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-neutral-900 outline-none focus:border-accent"
                        title="A4 页面内排版的卡牌数量"
                      />
                      <button
                        onClick={handleExportA4Sheet}
                        disabled={savedCards.length === 0}
                        className={cn(
                          "flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md transition-all",
                          savedCards.length === 0
                            ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                            : "bg-neutral-900 hover:bg-neutral-800 text-white active:scale-95"
                        )}
                        title="把牌库前 N 张卡牌排版到一张 A4 白底 PNG 中导出"
                      >
                        <FileText className="w-3 h-3" />
                        A4导出
                      </button>
                    </div>

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
                      批量导出
                    </button>
                    
                    {/* Word/Text batch import button */}
                    <label
                      className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-700/80 border border-emerald-400/20 hover:bg-emerald-600 text-white cursor-pointer active:scale-95 transition-all"
                      title="从 Word、TXT 或 JSON 批量生成并导入卡牌"
                    >
                      <FileText className="w-3 h-3" />
                      Word导入
                      <input type="file" accept=".docx,.txt,.md,.json" onChange={handleBatchImportCards} className="hidden" />
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
                      导出
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
                ) : (
                  <div className="grid grid-cols-1 gap-2.5">
                    {savedCards.map((item) => {
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
                              <span className="text-[10px] font-mono text-neutral-500 shrink-0">
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
                          <div className="flex items-center gap-1 ml-1 shrink-0">
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
                              onClick={() => handleExportSingleCard(item.cardData)}
                              className="p-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent hover:text-white transition"
                              title="将此卡片渲染导出为高保真 PNG"
                            >
                              <Download className="w-3.5 h-3.5" />
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
                        className="w-full bg-neutral-800 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-accent transition-colors"
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
                                {['人界', '天界', '魔界', '机界', '精灵界', '兽界', '龙界'].map(r => (
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
                        value={(cardData.cardType === 'spirit_normal' || cardData.cardType === 'spirit_resonance') ? cardData.spirit.effectText : cardData.trace.effectText}
                        onChange={(e) => updateField((cardData.cardType === 'spirit_normal' || cardData.cardType === 'spirit_resonance') ? 'spirit.effectText' : 'trace.effectText', e.target.value)}
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
        className="fixed pointer-events-none" style={{ left: '5000px', top: '1000px', width: `${CARD_WIDTH}px`, overflow: 'visible' }}
      >
        <div ref={batchExportRef} style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px`, transform: 'none', transition: 'none', position: 'relative' }}>
          {batchExportCard && (
            <CardPreview data={batchExportCard} assets={assets} showGrid={false} forExport />
          )}
        </div>
      </div>

      {/* Off-screen A4 sheet export */}
      <div
        className="fixed pointer-events-none"
        style={{ left: '5000px', top: '1800px', width: `${A4_EXPORT_WIDTH}px`, overflow: 'visible' }}
      >
        {a4ExportCards.length > 0 && (() => {
          const layout = getA4Layout(a4ExportCards.length);
          const scale = layout.cardWidth / CARD_WIDTH;

          return (
            <div
              ref={a4SheetRef}
              style={{
                width: `${A4_EXPORT_WIDTH}px`,
                height: `${A4_EXPORT_HEIGHT}px`,
                background: '#ffffff',
                padding: `${A4_PADDING}px`,
                boxSizing: 'border-box',
                display: 'grid',
                gridTemplateColumns: `repeat(${layout.cols}, ${layout.cardWidth}px)`,
                gridTemplateRows: `repeat(${layout.rows}, ${layout.cardHeight}px)`,
                gap: `${A4_GAP}px`,
                alignContent: 'center',
                justifyContent: 'center',
              }}
            >
              {a4ExportCards.map((card, index) => (
                <div
                  key={`${card.serialNumber || card.name || 'card'}-${index}`}
                  style={{
                    width: `${layout.cardWidth}px`,
                    height: `${layout.cardHeight}px`,
                    overflow: 'hidden',
                    outline: '1px dashed rgba(15, 23, 42, 0.35)',
                    background: '#ffffff',
                  }}
                >
                  <div
                    style={{
                      width: `${CARD_WIDTH}px`,
                      height: `${CARD_HEIGHT}px`,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <CardPreview data={card} assets={assets} showGrid={false} forExport />
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

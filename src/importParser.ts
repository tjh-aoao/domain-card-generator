import JSZip from 'jszip';
import { deepClone } from './cardData';
import { CardData, CardType, INITIAL_CARD_DATA } from './types';

export type ParsedCardFields = Record<string, string>;

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

export const SPIRIT_TRAIT_ORDER = ['限制', '登场', '共鸣', '战斗', '吟唱', '遗言'];

const EFFECT_TAGS = [...SPIRIT_TRAIT_ORDER, '普通', '结界', '痕迹', '退场', '领域', '发动条件', '效果'];
const MATRIX_LABELS = [-8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8];

function normalizeFieldKey(key: string) {
  const normalized = key.trim().replace(/\s+/g, '').toLowerCase();
  for (const [target, aliases] of FIELD_ALIASES) {
    if (aliases.some(alias => alias.toLowerCase() === normalized)) return target;
  }
  return key.trim();
}

export function splitList(value: string) {
  return value.split(/[,\u3001，/|；;]+/).map(item => item.trim()).filter(Boolean);
}

function parseNumber(value: string, fallback: number) {
  const match = value.match(/-?\d+/);
  return match ? Number(match[0]) : fallback;
}

function parseBoolean(value: string) {
  return /^(true|yes|y|1|是|可|可以|能|速攻|对方回合)$/i.test(value.trim());
}

export function parseMatrix(value: string, fallback: number[]) {
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

export function formatEffectTextWithTags(value: string) {
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

export function extractPlainTextFromXml(xml: string) {
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

export async function readDocxText(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('DOCX 文件缺少 word/document.xml');
  return extractPlainTextFromXml(await documentFile.async('string'));
}

export function parseCardBlocks(text: string) {
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

export function parseImportText(text: string) {
  const fieldBlocks = parseCardBlocks(text);
  if (fieldBlocks.some(block =>
    block.name ||
    block.cardType ||
    block.serialNumber ||
    block.matrix ||
    block['spirit.cost'] ||
    block['spirit.attack'] ||
    block['spirit.domainValue'] ||
    block['trace.cost'] ||
    block['trace.traceType'] ||
    block['master.activeSkill'] ||
    block['master.passiveSkill'] ||
    block['master.triggerCondition']
  )) {
    return fieldBlocks;
  }
  return parseSimpleCardBlocks(text);
}

export function fieldsToCardData(fields: ParsedCardFields): CardData {
  const card = deepClone(INITIAL_CARD_DATA);
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

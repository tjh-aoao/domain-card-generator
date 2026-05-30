import { AssetLibrary, CardData, CardType, INITIAL_ASSETS, INITIAL_CARD_DATA, SavedCard } from './types';

const CARD_TYPES: CardType[] = ['master', 'spirit_normal', 'spirit_resonance', 'trace'];

export function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

function normalizeMatrix(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback;
  const matrix = value.slice(0, 16).map(item => item === 1 ? 1 : 0);
  while (matrix.length < 16) matrix.push(0);
  return matrix;
}

export function normalizeCardData(value: unknown): CardData | null {
  if (!isRecord(value)) return null;

  const base = deepClone(INITIAL_CARD_DATA);
  const master = isRecord(value.master) ? value.master : {};
  const spirit = isRecord(value.spirit) ? value.spirit : {};
  const trace = isRecord(value.trace) ? value.trace : {};
  const imageOffset = isRecord(value.imageOffset) ? value.imageOffset : {};
  const rawCardType = value.cardType;

  return {
    ...base,
    name: asString(value.name, base.name),
    cardType: typeof rawCardType === 'string' && CARD_TYPES.includes(rawCardType as CardType) ? rawCardType as CardType : base.cardType,
    image: asString(value.image, base.image),
    matrix: normalizeMatrix(value.matrix, base.matrix),
    attribute: asString(value.attribute, base.attribute),
    serialNumber: asString(value.serialNumber, base.serialNumber),
    flavorText: asString(value.flavorText, base.flavorText),
    imageScale: Math.max(0.1, Math.min(10, asNumber(value.imageScale, base.imageScale ?? 1))),
    imageOffset: {
      x: asNumber(imageOffset.x, base.imageOffset?.x ?? 0),
      y: asNumber(imageOffset.y, base.imageOffset?.y ?? 0),
    },
    master: {
      state: asString(master.state, base.master.state),
      triggerCondition: asString(master.triggerCondition, base.master.triggerCondition),
      activeSkill: asString(master.activeSkill, base.master.activeSkill),
      passiveSkill: asString(master.passiveSkill, base.master.passiveSkill),
      maintenance: asString(master.maintenance, base.master.maintenance),
    },
    spirit: {
      cost: asNumber(spirit.cost, base.spirit.cost),
      attributes: asStringArray(spirit.attributes, base.spirit.attributes),
      trait: asString(spirit.trait, base.spirit.trait),
      keywords: asStringArray(spirit.keywords, base.spirit.keywords),
      race: asString(spirit.race, base.spirit.race),
      attack: asNumber(spirit.attack, base.spirit.attack),
      domainValue: asNumber(spirit.domainValue, base.spirit.domainValue),
      effectText: asString(spirit.effectText, base.spirit.effectText),
    },
    trace: {
      traceType: asString(trace.traceType, base.trace.traceType),
      cost: asNumber(trace.cost, base.trace.cost),
      effectCost: asString(trace.effectCost, base.trace.effectCost),
      canUseOnOpponentTurn: asBoolean(trace.canUseOnOpponentTurn, base.trace.canUseOnOpponentTurn),
      extraCost: asString(trace.extraCost, base.trace.extraCost),
      effectText: asString(trace.effectText, base.trace.effectText),
    },
  };
}

function normalizeStringMap<T extends Record<string, string>>(defaults: T, value: unknown): T {
  const next = { ...defaults };
  if (!isRecord(value)) return next;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      next[key as keyof T] = item as T[keyof T];
    }
  }

  return next;
}

function normalizeCostMap(defaults: AssetLibrary['costs'], value: unknown): AssetLibrary['costs'] {
  const next = { ...defaults };
  if (!isRecord(value)) return next;

  for (const [key, item] of Object.entries(value)) {
    const cost = Number(key);
    if (Number.isInteger(cost) && typeof item === 'string') {
      next[cost] = item;
    }
  }

  return next;
}

export function normalizeAssetLibrary(value: unknown): AssetLibrary {
  if (!isRecord(value)) return deepClone(INITIAL_ASSETS);

  return {
    templates: normalizeStringMap(INITIAL_ASSETS.templates, value.templates),
    attributes: normalizeStringMap(INITIAL_ASSETS.attributes, value.attributes),
    costs: normalizeCostMap(INITIAL_ASSETS.costs, value.costs),
  };
}

export function normalizeSavedCard(value: unknown): SavedCard | null {
  if (!isRecord(value)) return null;
  const cardData = normalizeCardData(value.cardData);
  if (!cardData) return null;

  return {
    id: asString(value.id, 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8)),
    createdAt: asNumber(value.createdAt, Date.now()),
    cardData,
  };
}

export function cloneCardData(cardData: CardData) {
  return deepClone(cardData);
}

export function makeSavedCard(cardData: CardData): SavedCard {
  return {
    id: 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8),
    createdAt: Date.now(),
    cardData: cloneCardData(cardData),
  };
}

import assert from 'node:assert/strict';
import { cloneCardData, normalizeAssetLibrary, normalizeCardData, normalizeSavedCard } from '../src/cardData.ts';
import { INITIAL_ASSETS, INITIAL_CARD_DATA } from '../src/types.ts';

const partialCard = normalizeCardData({
  name: '测试卡',
  cardType: 'trace',
  matrix: [1, 0, 1, 'bad', 1],
  imageScale: 99,
  imageOffset: { x: 12, y: 'bad' },
  spirit: {
    cost: 'not-a-number',
    keywords: ['共鸣', 12, '遗言'],
  },
});

assert(partialCard, 'partial card should normalize');
assert.equal(partialCard.name, '测试卡');
assert.equal(partialCard.cardType, 'trace');
assert.equal(partialCard.matrix.length, 16);
assert.deepEqual(partialCard.matrix.slice(0, 5), [1, 0, 1, 0, 1]);
assert.equal(partialCard.imageScale, 10);
assert.deepEqual(partialCard.imageOffset, { x: 12, y: 0 });
assert.equal(partialCard.spirit.cost, INITIAL_CARD_DATA.spirit.cost);
assert.deepEqual(partialCard.spirit.keywords, ['共鸣', '遗言']);

const invalidCard = normalizeCardData(null);
assert.equal(invalidCard, null);

const savedCard = normalizeSavedCard({
  id: 'saved-1',
  createdAt: 123,
  cardData: { name: '牌库卡' },
});

assert(savedCard, 'saved card should normalize');
assert.equal(savedCard.id, 'saved-1');
assert.equal(savedCard.createdAt, 123);
assert.equal(savedCard.cardData.name, '牌库卡');

const cloned = cloneCardData(INITIAL_CARD_DATA);
cloned.name = '克隆改名';
assert.notEqual(cloned.name, INITIAL_CARD_DATA.name);

const assets = normalizeAssetLibrary({
  templates: { trace: 'https://example.com/trace.png', master: 12 },
  attributes: { 测试: 'data:image/png;base64,abc' },
  costs: { 1: 'https://example.com/1.png', bad: 'ignored' },
});

assert.equal(assets.templates.trace, 'https://example.com/trace.png');
assert.equal(assets.templates.master, INITIAL_ASSETS.templates.master);
assert.equal(assets.attributes['测试'], 'data:image/png;base64,abc');
assert.equal(assets.costs[1], 'https://example.com/1.png');

console.log('cardData normalize tests passed');

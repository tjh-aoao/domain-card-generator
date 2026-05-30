import assert from 'node:assert/strict';
import { fieldsToCardData, formatEffectTextWithTags, parseCardBlocks, parseImportText, parseMatrix } from '../src/importParser.ts';
import { INITIAL_CARD_DATA } from '../src/types.ts';

const fieldBlocks = parseCardBlocks(`
名称：星火旅人
类型：普通域灵
编号：SP-001
属性：红、白
费用：3
攻击：1600
域值：400
种族：人界域
效果：共鸣：抽1张卡
遗言：造成1点伤害
`);

assert.equal(fieldBlocks.length, 1);
assert.equal(fieldBlocks[0].name, '星火旅人');
assert.equal(fieldBlocks[0]['spirit.cost'], '3');
assert.equal(fieldBlocks[0]['spirit.attack'], '1600');

const fieldCard = fieldsToCardData(fieldBlocks[0]);
assert.equal(fieldCard.name, '星火旅人');
assert.equal(fieldCard.cardType, 'spirit_normal');
assert.deepEqual(fieldCard.spirit.attributes, ['红', '白']);
assert.equal(fieldCard.spirit.cost, 3);
assert.equal(fieldCard.spirit.attack, 1600);
assert.equal(fieldCard.spirit.domainValue, 400);
assert(fieldCard.spirit.effectText.includes('【共鸣】 抽1张卡'));

const simpleCards = parseImportText(`
青岚守卫 | 2 | 蓝
1200 | 300
-8, -7, 1
【人界域、登场、共鸣】
登场：查看牌库顶1张牌

瞬光 | 1 | 痕迹
【普通】
效果：抽1张卡
`).map(fieldsToCardData);

assert.equal(simpleCards.length, 2);
assert.equal(simpleCards[0].cardType, 'spirit_resonance');
assert.equal(simpleCards[0].serialNumber, 'AUTO-001');
assert.equal(simpleCards[0].spirit.cost, 2);
assert.equal(simpleCards[0].spirit.race, '人界域');
assert.deepEqual(simpleCards[0].spirit.keywords, ['登场', '共鸣']);
assert.equal(simpleCards[0].matrix[0], 1);
assert.equal(simpleCards[0].matrix[1], 1);
assert.equal(simpleCards[0].matrix[8], 1);
assert.equal(simpleCards[1].cardType, 'trace');
assert.equal(simpleCards[1].trace.cost, 1);
assert.equal(simpleCards[1].trace.traceType, '普通');
assert.equal(simpleCards[1].trace.effectText, '【效果】 抽1张卡');

assert.deepEqual(
  parseMatrix('1010101010101010', INITIAL_CARD_DATA.matrix),
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]
);

assert.deepEqual(
  parseMatrix('-8, -1, 8', INITIAL_CARD_DATA.matrix).filter(Boolean).length,
  3
);

assert.equal(
  formatEffectTextWithTags('条件：自身登场\n效果：抽1张卡'),
  '【发动条件】 自身登场\n【效果】 抽1张卡'
);

console.log('import parser tests passed');

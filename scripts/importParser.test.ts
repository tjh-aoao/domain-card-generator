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

const fullWidthMatrixCards = parseImportText(`
机降灵-埃克西亚｜2｜红
1500｜200
2｜5｜7
【机界域｜登场｜共鸣】
登场：选择自己场上1只战斗状态的域灵，让其攻击力上升500。
共鸣：支付1点域能，抽1张卡。

机降驱动｜1｜痕迹
【通常】
效果：选择1张手牌，将其返回卡组。
`).map(fieldsToCardData);

assert.equal(fullWidthMatrixCards.length, 2);
assert.equal(fullWidthMatrixCards[0].cardType, 'spirit_resonance');
assert.equal(fullWidthMatrixCards[0].spirit.race, '机界域');
assert.deepEqual(fullWidthMatrixCards[0].spirit.keywords, ['登场', '共鸣']);
assert.equal(fullWidthMatrixCards[0].matrix[9], 1);
assert.equal(fullWidthMatrixCards[0].matrix[12], 1);
assert.equal(fullWidthMatrixCards[0].matrix[14], 1);
assert(fullWidthMatrixCards[0].spirit.effectText.includes('【登场】 选择自己场上1只战斗状态的域灵'));
assert.equal(fullWidthMatrixCards[1].cardType, 'trace');

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

const noEffectHeader = '裂天龙｜5｜白\n3200｜80\n【龙界域｜无效果】';
const noEffectFields = '名称：裂天龙\n类型：普通域灵\n属性：白\n费用：5\n攻击力：3200\n域值：80\n种族：龙界域\n特性：无效果';
for (const text of [noEffectHeader, `${noEffectHeader}\n无效果`, noEffectFields, `${noEffectFields}\n效果：`, `${noEffectFields}\n效果：无效果`]) {
  const imported = parseImportText(text).map(fieldsToCardData);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, '裂天龙');
  assert.equal(imported[0].spirit.effectText, '无效果');
  assert.equal(imported[0].spirit.attack, 3200);
  assert.equal(imported[0].spirit.domainValue, 80);
  assert.deepEqual(imported[0].spirit.keywords, ['无效果']);
}

const blankNoEffect = fieldsToCardData({
  cardType: '普通域灵', 'spirit.trait': '无效果', 'spirit.effectText': '  \n  ',
});
assert.equal(blankNoEffect.spirit.effectText, '无效果');

// Preserve explicitly supplied text even when the source has a conflicting tag.
const conflictingNoEffect = fieldsToCardData({
  cardType: '普通域灵', 'spirit.trait': '无效果', 'spirit.effectText': '登场：抽1张卡。',
});
assert.equal(conflictingNoEffect.spirit.effectText, '【登场】 抽1张卡。');

// Original master labels must route to separate sections without rewriting text.
const originalAwake = '一回合一次，从手牌中将1张卡丢弃，然后根据那张卡的费用翻开牌库上方对应数量的卡，从中选择1只机界域域灵加入手牌，其余卡则按任意顺序返回牌库上方。';
const originalDesperate = '一回合一次，直到回合结束，下次自己召唤机界域域灵的时候，可以将那只域灵召唤费用变为1。';
const originalMaster = parseImportText(`名称：破旧电脑＝匠客\n编号：ZW/YZ01-JYZZ001\n觉醒条件：自己的域值大于等于200。\n觉醒技能：${originalAwake}\n绝境条件：对手的域值至少比自己多200。\n绝境技能：${originalDesperate}`).map(fieldsToCardData);
assert.equal(originalMaster.length, 1);
assert.equal(originalMaster[0].cardType, 'master');
assert.equal(originalMaster[0].serialNumber, 'ZW/YZ01-JYZZ001');
assert.equal(originalMaster[0].master.triggerCondition, '自己的域值大于等于200。');
assert.equal(originalMaster[0].master.desperateAwakening, '对手的域值至少比自己多200。');
assert.equal(originalMaster[0].master.activeSkill, originalAwake);
assert.equal(originalMaster[0].master.passiveSkill, originalDesperate);
const originalGodo = '自己场上的“大师级魔像衍生物”不会被效果破坏，同一个回合中可以额外进行2次攻击。';
const godoImport = parseImportText(`名称：魔像大师 戈多\n绝境条件：对手的域值至少超过自己200。\n绝境效果：${originalGodo}`).map(fieldsToCardData)[0];
assert.equal(godoImport.master.desperateAwakening, '对手的域值至少超过自己200。');
assert.equal(godoImport.master.passiveSkill, originalGodo);
for (const label of ['绝境条件', '绝境觉醒', 'desperateAwakening']) {
  const imported = parseImportText(`${label}：原始条件。`).map(fieldsToCardData);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].cardType, 'master');
  assert.equal(imported[0].master.desperateAwakening, '原始条件。');
}
const legacyMaster = fieldsToCardData(parseImportText('名称：旧格式域主\n触发条件：原条件。\n主动技能：原技能。\n被动技能：原绝境技能。')[0]);
assert.equal(legacyMaster.master.triggerCondition, '原条件。');
assert.equal(legacyMaster.master.activeSkill, '原技能。');
assert.equal(legacyMaster.master.passiveSkill, '原绝境技能。');

const bracketMaster = parseImportText(`名称：破旧电脑＝匠客\n编号：ZW/YZ01-JYZZ001\n【普通觉醒】自己的域值大于等于200。\n【觉醒技能】${originalAwake}\n【绝境觉醒】对手的域值至少比自己多200。\n【绝境技能】${originalDesperate}`).map(fieldsToCardData)[0];
assert.deepEqual(bracketMaster, originalMaster[0]);
const bracketTokenSkill = '一回合一次，在自己场上生成一只“大师级魔像衍生物”（魔界域·红·5费·衍生物·ATK：3000/ZP：50）。';
assert.equal(fieldsToCardData(parseImportText(`【觉醒技能】${bracketTokenSkill}`)[0]).master.activeSkill, bracketTokenSkill);

console.log('import parser tests passed');

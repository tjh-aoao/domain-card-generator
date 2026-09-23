import assert from 'node:assert/strict';
import { matchCardImages, withImportedImage } from '../src/imageImport.ts';
import { INITIAL_CARD_DATA, type SavedCard } from '../src/types.ts';

const card = (id: string, name: string, image = ''): SavedCard => ({
  id, createdAt: 123, groupId: 'series-a',
  cardData: { ...INITIAL_CARD_DATA, name, image, imageScale: 2, imageOffset: { x: 5, y: 8 } },
});
const cards = [card('a', '幻王·奥斯维尔', 'old.png'), card('b', 'Fire Dragon'), card('c', '版本.二')];
const files = (...names: string[]) => names.map(name => ({ name }));

const matches = matchCardImages(files(' 幻王·奥斯维尔 .PNG', 'ＦＩＲＥ Dragon.jpg', '版本.二.webp'), cards);
assert.deepEqual(matches.map(row => [row.status, row.card?.id]), [['matched', 'a'], ['matched', 'b'], ['matched', 'c']]);
assert.deepEqual(matchCardImages(files('幻王·奥斯维尔.jpg', '幻王·奥斯维尔.png'), cards).map(row => row.status), ['duplicate-image', 'duplicate-image']);
assert.equal(matchCardImages(files('Fire Dragon.png'), [...cards, card('d', 'fire dragon')])[0].status, 'duplicate-card');
assert.deepEqual(matchCardImages(files('不存在.png', 'FireDragon.png', 'Fire Dragon.txt', '.png'), cards).map(row => row.status), ['unmatched', 'unmatched', 'unsupported', 'unmatched']);
assert.equal(matchCardImages(files('幻王奥斯维尔.png'), cards)[0].status, 'unmatched', 'punctuation must not be silently removed');
assert.deepEqual(matchCardImages(files('幻王·奥斯维尔.png', 'Fire Dragon.png'), cards, false).map(row => row.status), ['existing', 'matched']);
assert.deepEqual(matchCardImages(files('Fire Dragon.png', 'Fire Dragon.txt'), cards).map(row => row.status), ['matched', 'unsupported']);
assert.equal(matchCardImages(files('幻王·奥斯维尔.png'), [cards[1]])[0].status, 'unmatched', 'only the supplied group is eligible');
assert.equal(matchCardImages(files(' .png'), [card('empty', '')])[0].status, 'unmatched');
assert.equal(matchCardImages(files('Fire Dragon.constructor'), cards)[0].status, 'unsupported');
assert.deepEqual(matchCardImages([], cards), []);

const before = structuredClone(cards[0]);
const updated = withImportedImage(cards[0].cardData, 'data:image/png;base64,new');
assert.equal(updated.image, 'data:image/png;base64,new');
assert.equal(updated.imageScale, 1);
assert.deepEqual(updated.imageOffset, { x: 0, y: 0 });
assert.deepEqual({ ...updated, image: before.cardData.image, imageScale: before.cardData.imageScale, imageOffset: before.cardData.imageOffset }, before.cardData);
assert.deepEqual(cards[0], before, 'the source card must remain unchanged');
console.log('imageImport matching tests passed');

export const CARD_WIDTH = 380;
export const CARD_HEIGHT = Math.round(CARD_WIDTH * 86 / 59);
export const A4_EXPORT_WIDTH = 1240;
export const A4_EXPORT_HEIGHT = Math.round(A4_EXPORT_WIDTH * 297 / 210);
export const A4_MAX_CARDS = 12;
export const A4_PADDING = 70;
export const A4_GAP = 24;

export const getMatrixLabel = (index: number) => {
  if (index < 8) return index - 8;
  return index - 7;
};

export function getA4Layout(count: number) {
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

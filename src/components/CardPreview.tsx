import React, { useEffect, useState } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, getMatrixLabel } from '../cardLayout';
import { cn } from '../cn';
import { getProxiedUrl } from '../imageProxy';
import { AssetLibrary, CardData } from '../types';

const MatrixDisplay = ({ matrix, size = 'small' }: { matrix: number[], size?: 'small' | 'large' }) => {
  const cellSize = size === 'small' ? 'w-2.5 h-2.5' : 'w-10 h-10';
  const fontSize = size === 'small' ? 'text-[5.5px]' : 'text-[10px]';
  const cells = Array.isArray(matrix) ? matrix : Array(16).fill(0);
  return (
    <div className={cn('matrix-grid bg-black/20 p-0.5 rounded-sm', size === 'large' ? 'gap-1' : 'gap-0.5')}>
      {cells.map((val, i) => (
        <div
          key={i}
          className={cn(
            cellSize,
            'rounded-full transition-colors flex items-center justify-center border border-white/5',
            val === 0 ? 'bg-white/10' : 'bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.8)]'
          )}
        >
          <span className={cn(fontSize, val === 0 ? 'text-white/30' : 'text-white font-black')}>
            {getMatrixLabel(i)}
          </span>
        </div>
      ))}
    </div>
  );
};

export const CardPreview = React.forwardRef<HTMLDivElement, {
  data: CardData,
  assets: AssetLibrary,
  showGrid?: boolean,
  forExport?: boolean,
  exportWidth?: number,
  onImageAdjust?: (scale: number, offset: { x: number, y: number }) => void
}>(({ data, assets, showGrid, forExport, exportWidth = CARD_WIDTH, onImageAdjust }, ref) => {
  const effectText =
    data.cardType === 'master'
      ? [data.master?.triggerCondition, data.master?.activeSkill, data.master?.passiveSkill].filter(Boolean).join('\n')
      : data.cardType === 'trace'
        ? data.trace?.effectText ?? ''
        : data.spirit?.effectText ?? '';
  const effectPlainLength = effectText.replace(/\s/g, '').length;
  const effectLineCount = effectText ? effectText.split('\n').length : 0;
  const effectTagCount = (effectText.match(/【.*?】/g) || []).length;
  const effectPressure =
    effectPlainLength +
    effectLineCount * 8 +
    effectTagCount * 5 +
    (data.cardType === 'spirit_resonance' ? 24 : 0);
  const effectTypography =
    effectPressure > 210
      ? { fontSize: 9, lineHeight: 1.08, labelFontSize: 8, labelHeight: 10, labelPaddingX: 2, paragraphMarginBottom: 0 }
      : effectPressure > 160
        ? { fontSize: 10, lineHeight: 1.12, labelFontSize: 9, labelHeight: 11, labelPaddingX: 3, paragraphMarginBottom: 1 }
        : effectPressure > 120
          ? { fontSize: 11, lineHeight: 1.18, labelFontSize: 10, labelHeight: 12, labelPaddingX: 3, paragraphMarginBottom: 1 }
          : { fontSize: 12, lineHeight: 1.25, labelFontSize: 11, labelHeight: 14, labelPaddingX: 4, paragraphMarginBottom: 2 };

  const renderFormattedLine = (line: string) => {
    const keywords = ['限制', '登场', '共鸣', '战斗', '吟唱', '遗言', '普通', '结界', '痕迹', '退场', '领域', '发动条件', '效果'];
    const pattern = /【(.*?)】/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      const [raw, label] = match;
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }

      parts.push(
        keywords.includes(label) ? (
          <span
            key={`${match.index}-${label}`}
            className="bg-neutral-900 text-white rounded-[2px] font-black mr-1 inline-flex items-center justify-center relative -top-[0.5px] align-middle leading-none"
            style={{
              fontSize: `${effectTypography.labelFontSize}px`,
              height: `${effectTypography.labelHeight}px`,
              paddingLeft: `${effectTypography.labelPaddingX}px`,
              paddingRight: `${effectTypography.labelPaddingX}px`,
            }}
          >
            {label}
          </span>
        ) : (
          <span key={`${match.index}-${label}`} className="text-accent font-bold">
            {raw}
          </span>
        )
      );

      lastIndex = match.index + raw.length;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return parts.length > 0 ? parts : line;
  };

  const formatText = (text?: string) => {
    if (!text) return null;
    return String(text).split('\n').map((line, i) => (
      <p
        key={i}
        className="text-justify break-words [word-break:normal] [overflow-wrap:break-word] [text-align-last:auto] [text-justify:inter-character] [text-wrap:pretty]"
        style={{
          lineHeight: effectTypography.lineHeight,
          marginBottom: `${effectTypography.paragraphMarginBottom}px`,
        }}
      >
        {renderFormattedLine(line)}
      </p>
    ));
  };

  const templateImg = assets.templates[data.cardType];
  const displayedAttribute = data.cardType === 'trace' ? '痕迹' : data.attribute;
  const attrIcon = assets.attributes[displayedAttribute] || assets.attributes[data.attribute];
  const isSpiritCard = data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance';
  const costValue = isSpiritCard ? data.spirit?.cost : data.trace?.cost;
  const normalizedCostValue = Number.isFinite(costValue) ? Number(costValue) : 0;
  const costIcon = normalizedCostValue ? assets.costs[normalizedCostValue] : undefined;
  const showCost = data.cardType !== 'master';

  const [illustrationScale, setIllustrationScale] = useState(data.imageScale ?? 1);
  const [illustrationOffset, setIllustrationOffset] = useState(data.imageOffset ?? { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setIllustrationScale(data.imageScale ?? 1);
    setIllustrationOffset(data.imageOffset ?? { x: 0, y: 0 });
  }, [data.image, data.imageScale, data.imageOffset]);

  const handleWheel = (e: React.WheelEvent) => {
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

  const renderAssetIcon = (src: string, alt: string, key: string) => (
    <img
      key={key}
      src={getProxiedUrl(src)}
      alt={alt}
      className="w-full h-full object-cover object-center"
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
    />
  );

  return (
    <div
      ref={ref}
      className={cn(
        'relative bg-white rounded-[12px] overflow-hidden shadow-2xl flex flex-col font-sans text-neutral-900 select-none',
        !forExport && 'aspect-[59/86] w-full max-w-[380px]'
      )}
      style={forExport ? { width: `${exportWidth}px`, height: `${Math.round(exportWidth * 86 / 59)}px` } : undefined}
      id="card-preview"
    >
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

      <div className="absolute top-[1.2%] left-[5%] right-[4%] h-[5.5%] flex items-center justify-between z-10">
        <h2 className="text-[20px] font-black tracking-tighter text-neutral-900 drop-shadow-sm truncate max-w-[65%] leading-[1.15] py-0.5">
          {data.name}
        </h2>
        <div className="flex items-center">
          {showCost && (
            <div className="w-[30px] h-[30px] flex items-center justify-center overflow-hidden z-10">
              {costIcon ? (
                renderAssetIcon(costIcon, `cost-${normalizedCostValue}`, `cost-${normalizedCostValue}-${costIcon}`)
              ) : (
                <span className="text-[18px] font-black text-neutral-900">{normalizedCostValue || ''}</span>
              )}
            </div>
          )}
          <div className="w-[30px] h-[30px] flex items-center justify-center overflow-hidden ml-[-2px] z-20">
            {attrIcon ? (
              renderAssetIcon(attrIcon, displayedAttribute, `attr-${displayedAttribute}-${attrIcon}`)
            ) : (
              <span className="text-[14px] font-black text-neutral-900">{displayedAttribute}</span>
            )}
          </div>
        </div>
      </div>

      <div className="absolute top-[66.8%] left-[4%] right-[7%] h-[4%] flex items-center justify-between z-10 whitespace-nowrap">
        <div className="text-[15px] font-medium text-neutral-900 text-left tracking-[-0.08em] leading-none whitespace-nowrap">
          {data.cardType === 'master' && <span>【域主 / {data.master?.state ?? ''}】</span>}
          {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && (
            <span>【{data.spirit?.race ?? ''} / {data.spirit?.trait ?? ''}】</span>
          )}
          {data.cardType === 'trace' && <span>【痕迹 / {data.trace?.traceType ?? ''}】</span>}
        </div>
        {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && (
          <div className="text-[15px] font-medium text-neutral-900 text-right tracking-[-0.08em] leading-none whitespace-nowrap">
            ZP: {data.spirit?.domainValue ?? 0} / ATK: {data.spirit?.attack ?? 0}
          </div>
        )}
      </div>

      <div
        className="absolute top-[72%] left-[6%] right-[34%] bottom-[9%] py-0.5 text-neutral-900 font-medium overflow-hidden z-10 break-words whitespace-pre-wrap [word-break:normal] [overflow-wrap:break-word] [text-justify:inter-character] [text-wrap:pretty]"
        style={{
          fontSize: `${effectTypography.fontSize}px`,
          lineHeight: effectTypography.lineHeight,
        }}
      >
        {data.cardType === 'master' && (
          <div className="space-y-1">
            {data.master?.triggerCondition && (
              <div className="flex items-start">
                <span className="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[11px] h-[14px] inline-flex items-center justify-center relative top-[1px] shrink-0">觉醒条件</span>
                <span className="flex-1">{data.master.triggerCondition}</span>
              </div>
            )}
            {data.master?.activeSkill && (
              <div className="flex items-start">
                <span className="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[11px] h-[14px] inline-flex items-center justify-center relative top-[1px] shrink-0">主动</span>
                <span className="flex-1">{data.master.activeSkill}</span>
              </div>
            )}
            {data.master?.passiveSkill && (
              <div className="flex items-start">
                <span className="bg-neutral-900 text-white px-1 rounded-[2px] font-black mr-1 text-[11px] h-[14px] inline-flex items-center justify-center relative top-[1px] shrink-0">被动</span>
                <span className="flex-1">{data.master.passiveSkill}</span>
              </div>
            )}
          </div>
        )}
        {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && formatText(data.spirit?.effectText)}
        {data.cardType === 'trace' && (
          <div>
            {formatText(data.trace?.effectText)}
          </div>
        )}
      </div>

      <div className="absolute bottom-[1.5%] left-[6%] right-[6%] h-[3%] flex items-center justify-end z-10">
        <div className="text-[10px] text-neutral-900 opacity-70">
          {data.serialNumber}
        </div>
      </div>

      {data.cardType === 'spirit_resonance' && (
        <div className="absolute bottom-[10%] right-[7%] z-20 scale-[1.8] origin-bottom-right">
          <MatrixDisplay matrix={data.matrix} />
        </div>
      )}

      {showGrid && (
        <div className="absolute inset-0 z-[100] pointer-events-none overflow-hidden select-none">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,0,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,0,0,0.3) 1px, transparent 1px)',
              backgroundSize: '5% 5%'
            }}
          />
          <div className="absolute top-0 left-0 right-0 flex h-full">
            {'ABCDEFGHIJKLMNOPQRST'.split('').map((char) => (
              <div key={char} className="flex-1 flex flex-col items-start pl-0.5">
                <span className="text-[7px] font-mono font-black text-red-500/60">{char}</span>
              </div>
            ))}
          </div>
          <div className="absolute top-0 left-0 bottom-0 flex flex-col w-full">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex-1 flex items-start pt-0.5 pl-0.5">
                <span className="text-[7px] font-mono font-black text-red-500/60">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, getMatrixLabel } from '../cardLayout';
import { cn } from '../cn';
import { getProxiedUrl } from '../imageProxy';
import { AssetLibrary, CardData, INITIAL_ASSETS } from '../types';

const stripUrlVersion = (value: string) => value.split(/[?#]/)[0];

const isKnownNormalSpiritTemplate = (value: string) => {
  if (!value) return false;
  if (stripUrlVersion(value) === stripUrlVersion(INITIAL_ASSETS.templates.spirit_normal)) return true;

  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('普通域灵底图');
  } catch {
    return value.includes('%E6%99%AE%E9%80%9A%E5%9F%9F%E7%81%B5%E5%BA%95%E5%9B%BE');
  }
};

const isNormalSpiritTemplateUrl = (value: string) => {
  if (!value) return false;
  if (stripUrlVersion(value) === stripUrlVersion(INITIAL_ASSETS.templates.spirit_normal)) return true;
  if (value.includes('%E6%99%AE%E9%80%9A%E5%9F%9F%E7%81%B5%E5%BA%95%E5%9B%BE')) return true;

  try {
    return decodeURIComponent(value).includes('\u666e\u901a\u57df\u7075\u5e95\u56fe');
  } catch {
    return false;
  }
};

const isKnownResonanceSpiritTemplate = (value: string) =>
  Boolean(value) && stripUrlVersion(value) === stripUrlVersion(INITIAL_ASSETS.templates.spirit_resonance);

const MatrixDisplay = ({
  matrix,
  size = 'small',
}: {
  matrix: number[],
  size?: 'small' | 'large',
}) => {
  const cellSize = size === 'small' ? 'w-2.5 h-2.5' : 'w-10 h-10';
  const fontSize = size === 'small' ? 'text-[5.5px]' : 'text-[10px]';
  const cells = Array.isArray(matrix) ? matrix : Array(16).fill(0);
  return (
    <div className={cn('matrix-grid p-0.5 rounded-sm bg-black/20', size === 'large' ? 'gap-1' : 'gap-0.5')}>
      {cells.map((val, i) => {
        const isActive = val === 1;
        return (
          <div
            key={i}
            className={cn(
              cellSize,
              'rounded-full flex items-center justify-center border border-white/5',
              isActive ? 'bg-red-600' : 'bg-white/10'
            )}
          >
            <span className={cn(fontSize, isActive ? 'text-white font-black' : 'text-white/30')}>
              {getMatrixLabel(i)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const toDisplaySlash = (value?: string) => (value ?? '').replace(/\//g, '／');

const CardName = ({ name, className, style }: {
  name: string;
  className: string;
  style?: React.CSSProperties;
}) => {
  const containerRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      text.style.letterSpacing = '0px';
      text.style.transform = '';
      // Use layout widths so preview/export transforms do not affect fitting.
      const naturalWidth = text.offsetWidth;
      const gaps = Math.max(1, Array.from(name).length - 1);
      const fontSize = parseFloat(getComputedStyle(text).fontSize);
      const availableWidth = Math.max(0, container.clientWidth - 2);
      const spacing = Math.max(-fontSize * 0.25,
        Math.min(-fontSize * 0.05, (availableWidth - naturalWidth) / gaps));
      text.style.letterSpacing = `${spacing}px`;
      // Extremely long names need a horizontal fit after spacing reaches its limit.
      // Negative tracking also shortens the last advance; reserve that glyph's edge.
      const textWidth = text.offsetWidth - spacing;
      if (textWidth > availableWidth) {
        text.style.transform = `scaleX(${availableWidth / textWidth})`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    document.fonts.ready.then(fit);
    document.fonts.addEventListener('loadingdone', fit);
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', fit);
    };
  }, [name]);

  return (
    <h2 ref={containerRef} className={className} style={style}>
      <span ref={textRef} className="inline-block whitespace-nowrap origin-left">{name}</span>
    </h2>
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
      ? [data.master?.triggerCondition, data.master?.activeSkill, data.master?.desperateAwakening, data.master?.passiveSkill].filter(Boolean).join('\n')
      : data.cardType === 'trace'
        ? data.trace?.effectText ?? ''
        : data.spirit?.effectText ?? '';
  const effectPlainLength = effectText.replace(/\s/g, '').length;
  const effectLineCount = effectText ? effectText.split('\n').length : 0;
  const effectTagCount = (effectText.match(/【.*?】/g) || []).length;
  const masterSkillCount = data.cardType === 'master'
    ? [data.master?.triggerCondition, data.master?.activeSkill, data.master?.desperateAwakening, data.master?.passiveSkill].filter(Boolean).length
    : 0;
  const effectPressure =
    effectPlainLength +
    effectLineCount * 8 +
    effectTagCount * 5 +
    masterSkillCount * 6 +
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
      const keywords = ['无效果', '限制', '登场', '共鸣', '战斗', '吟唱', '遗言', '普通', '结界', '痕迹', '退场', '领域', '发动条件', '效果'];
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

  const rawTemplateImg = assets.templates[data.cardType];
  const templateImg =
    data.cardType === 'spirit_normal'
      ? INITIAL_ASSETS.templates.spirit_normal
      : data.cardType === 'spirit_resonance' &&
          (isKnownResonanceSpiritTemplate(rawTemplateImg) || isNormalSpiritTemplateUrl(rawTemplateImg))
        ? INITIAL_ASSETS.templates.spirit_resonance
        : rawTemplateImg;
  const displayedAttribute = data.cardType === 'trace' ? '痕迹' : data.attribute;
  const attrIcon = assets.attributes[displayedAttribute] || assets.attributes[data.attribute];
  const isSpiritCard = data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance';
  const costValue = isSpiritCard ? data.spirit?.cost : data.trace?.cost;
  const normalizedCostValue = Number.isFinite(costValue) ? Number(costValue) : 0;
  const costIcon = normalizedCostValue ? assets.costs[normalizedCostValue] : undefined;
  const showCost = data.cardType !== 'master';
  const showAttribute = data.cardType !== 'master';
  const masterTextStrokeStyle =
    data.cardType === 'master'
      ? {
          WebkitTextStroke: '0.9px rgba(0,0,0,0.95)',
          textShadow: '0.9px 0 0 #000, -0.9px 0 0 #000, 0 0.9px 0 #000, 0 -0.9px 0 #000',
        }
      : undefined;
  const masterEffectTextStrokeStyle =
    data.cardType === 'master'
      ? {
          WebkitTextStroke: '0px transparent',
          textShadow:
            '0.55px 0 0 #000, -0.55px 0 0 #000, 0 0.55px 0 #000, 0 -0.55px 0 #000, 0.4px 0.4px 0 #000, -0.4px 0.4px 0 #000, 0.4px -0.4px 0 #000, -0.4px -0.4px 0 #000',
        }
      : undefined;
  const masterSkillLabelStyle = {
    WebkitTextStroke: '0px transparent',
    textShadow: 'none',
  };
  const masterSkillLabelSizeStyle = {
    ...masterSkillLabelStyle,
    fontSize: `${effectTypography.labelFontSize}px`,
    height: `${effectTypography.labelHeight}px`,
    paddingLeft: `${effectTypography.labelPaddingX}px`,
    paddingRight: `${effectTypography.labelPaddingX}px`,
  };

  const [illustrationScale, setIllustrationScale] = useState(data.imageScale ?? 1);
  const [illustrationOffset, setIllustrationOffset] = useState(data.imageOffset ?? { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setIllustrationScale(data.imageScale ?? 1);
    setIllustrationOffset(data.imageOffset ?? { x: 0, y: 0 });
  }, [data.image, data.imageScale, data.imageOffset]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
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
      data-fixed-colors
    >
      <div className="absolute inset-0 z-5 pointer-events-none">
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
        className="absolute top-[6%] left-[3.5%] right-[3.5%] h-[90%] overflow-hidden z-0 cursor-move rounded-[4px]"
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
            className="w-full h-full object-contain pointer-events-none select-none"
            style={{
              transform: `translate(${illustrationOffset.x}px, ${illustrationOffset.y}px) scale(${illustrationScale})`,
              transformOrigin: 'center',
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

      <div className="absolute top-[1.2%] left-[5%] right-[4%] h-[5.5%] flex items-center gap-2 z-10">
        <CardName
          name={data.name}
          className={cn(
            "text-[23px] font-black drop-shadow-sm flex-1 min-w-0 overflow-hidden leading-[1.15] py-0.5",
            data.cardType === 'trace' || data.cardType === 'master' ? 'text-white' : 'text-neutral-900'
          )}
          style={
            data.cardType === 'master'
              ? masterTextStrokeStyle
              : data.cardType === 'trace'
                ? { textShadow: '0 1px 2px rgba(0,0,0,0.75)' }
                : undefined
          }
        />
        <div className="flex items-center shrink-0">
          {showCost && (
            <div className="w-[32px] h-[32px] flex items-center justify-center overflow-hidden z-10">
              {costIcon ? (
                renderAssetIcon(costIcon, `cost-${normalizedCostValue}`, `cost-${normalizedCostValue}-${costIcon}`)
              ) : (
                <span className="text-[18px] font-black text-neutral-900">{normalizedCostValue || ''}</span>
              )}
            </div>
          )}
          {showAttribute && (
            <div className="w-[32px] h-[32px] flex items-center justify-center overflow-hidden ml-[-2px] z-20">
              {attrIcon ? (
                renderAssetIcon(attrIcon, displayedAttribute, `attr-${displayedAttribute}-${attrIcon}`)
              ) : (
                <span className="text-[14px] font-black text-neutral-900">{displayedAttribute}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {data.cardType !== 'master' && (
        <div className="absolute top-[66.8%] left-[4%] right-[34%] h-[4%] flex items-center z-10 whitespace-nowrap">
          <div className="text-[15px] font-medium text-neutral-900 text-left tracking-[-0.08em] leading-none whitespace-nowrap">
            {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && (
              <span>【{toDisplaySlash(data.spirit?.race)}／{toDisplaySlash(data.spirit?.trait)}】</span>
            )}
            {data.cardType === 'trace' && <span>【痕迹／{toDisplaySlash(data.trace?.traceType)}】</span>}
          </div>
        </div>
      )}

      {(data.cardType === 'spirit_normal' || data.cardType === 'spirit_resonance') && (
        <div className="absolute top-[62%] inset-x-0 h-[4%] z-10 whitespace-nowrap">
          <span
            className="absolute left-[64%] top-[63%] w-[4.5%] -translate-y-1/2 text-center text-[17px] font-bold text-white leading-none"
            style={{
              WebkitTextStroke: '0.65px rgba(0,0,0,0.95)',
              textShadow: '0.65px 0 0 #000, -0.65px 0 0 #000, 0 0.65px 0 #000, 0 -0.65px 0 #000',
            }}
          >
            {data.spirit?.domainValue ?? 0}
          </span>
          <span
            className="absolute right-[9%] top-[63%] w-[7%] -translate-y-1/2 text-center text-[17px] font-bold text-white leading-none"
            style={{
              WebkitTextStroke: '0.65px rgba(0,0,0,0.95)',
              textShadow: '0.65px 0 0 #000, -0.65px 0 0 #000, 0 0.65px 0 #000, 0 -0.65px 0 #000',
            }}
          >
            {data.spirit?.attack ?? 0}
          </span>
        </div>
      )}

      <div
        className={cn(
          "absolute top-[72%] left-[6%] bottom-[9%] py-0.5 font-medium overflow-hidden z-10 break-words whitespace-pre-wrap [word-break:normal] [overflow-wrap:break-word] [text-justify:inter-character] [text-wrap:pretty]",
          data.cardType === 'master' ? 'w-[335px]' : data.cardType === 'trace' ? 'w-[333px]' : 'right-[34%]',
          data.cardType === 'master' ? 'text-white' : 'text-neutral-900'
        )}
        style={{
          fontSize: `${effectTypography.fontSize}px`,
          lineHeight: effectTypography.lineHeight,
          ...(data.cardType === 'master' ? masterEffectTextStrokeStyle : {}),
        }}
      >
        {data.cardType === 'master' && (
          <div className={effectTypography.fontSize <= 10 ? 'space-y-0.5' : 'space-y-1'}>
            {data.master?.triggerCondition && (
              <div className="flex items-start">
                <span className="bg-white text-neutral-900 rounded-[2px] font-black mr-1 inline-flex items-center justify-center relative top-[1px] shrink-0" style={masterSkillLabelSizeStyle}>普通觉醒</span>
                <span className="flex-1 min-w-0 block text-justify break-words [word-break:normal] [overflow-wrap:break-word] [text-align-last:auto] [text-justify:inter-character]">{data.master.triggerCondition}</span>
              </div>
            )}
            {data.master?.activeSkill && (
              <div className="flex items-start">
                <span className="bg-white text-neutral-900 rounded-[2px] font-black mr-1 inline-flex items-center justify-center relative top-[1px] shrink-0" style={masterSkillLabelSizeStyle}>觉醒技能</span>
                <span className="flex-1 min-w-0 block text-justify break-words [word-break:normal] [overflow-wrap:break-word] [text-align-last:auto] [text-justify:inter-character]">{data.master.activeSkill}</span>
              </div>
            )}
            {data.master?.desperateAwakening && (
              <div className="flex items-start">
                <span className="bg-white text-neutral-900 rounded-[2px] font-black mr-1 inline-flex items-center justify-center relative top-[1px] shrink-0" style={masterSkillLabelSizeStyle}>绝境觉醒</span>
                <span className="flex-1 min-w-0 block text-justify break-words [word-break:normal] [overflow-wrap:break-word] [text-align-last:auto] [text-justify:inter-character]">{data.master.desperateAwakening}</span>
              </div>
            )}
            {data.master?.passiveSkill && (
              <div className="flex items-start">
                <span className="bg-white text-neutral-900 rounded-[2px] font-black mr-1 inline-flex items-center justify-center relative top-[1px] shrink-0" style={masterSkillLabelSizeStyle}>绝境技能</span>
                <span className="flex-1 min-w-0 block text-justify break-words [word-break:normal] [overflow-wrap:break-word] [text-align-last:auto] [text-justify:inter-character]">{data.master.passiveSkill}</span>
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

      <div className="absolute bottom-[1%] left-[6%] right-[6%] h-[3%] flex items-center justify-start z-10">
        <div className="text-[12px] font-medium text-neutral-900 opacity-70">
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

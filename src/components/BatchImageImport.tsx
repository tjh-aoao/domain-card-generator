import { useEffect, useMemo, useRef, useState } from 'react';
import type { SavedCard } from '../types';
import { IMAGE_IMPORT_ACCEPT, matchCardImages, readCardImage, type ImageMatchStatus } from '../imageImport';

const STATUS_LABELS: Record<ImageMatchStatus, string> = {
  matched: '可导入', unsupported: '不支持的格式', unmatched: '未找到同名卡牌',
  'duplicate-card': '卡牌重名，请先选择分组或修改卡名',
  'duplicate-image': '图片重名，请每张卡只选择一张图片', existing: '保留已有插画',
};

interface Props {
  cards: SavedCard[];
  groupName: string;
  onApply: (images: Map<string, string>) => Promise<string | null>;
  onClose: () => void;
}

export function BatchImageImport({ cards, groupName, onApply, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<Record<number, string>>({});
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const rows = useMemo(() => matchCardImages(files, cards, replaceExisting), [files, cards, replaceExisting]);
  const matches = rows.filter(row => row.status === 'matched');

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const applyImages = async () => {
    if (busyRef.current || !matches.length || importedIds.size) return;
    busyRef.current = true;
    setBusy(true);
    setProgress(0);
    setMessage('');
    setFailures({});
    const images = new Map<string, string>();
    const errors: Record<number, string> = {};
    try {
      // Read sequentially to avoid decoding an entire folder of large images at once.
      for (const [index, row] of matches.entries()) {
        try {
          images.set(row.card!.id, await readCardImage(files[row.fileIndex]));
        } catch {
          errors[row.fileIndex] = '图片损坏、无法读取或浏览器不支持';
        }
        setProgress(index + 1);
      }
      setFailures(errors);
      if (!images.size) {
        setMessage('没有可导入的图片，请检查下方失败原因。');
        return;
      }
      const error = await onApply(images);
      if (error) {
        setMessage(error);
        return;
      }
      setImportedIds(new Set(images.keys()));
      setMessage(`已导入并保存 ${images.size} 张插画，跳过 ${files.length - images.size} 个文件。`);
    } catch {
      setMessage('导入失败，请重新选择图片后重试。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="batch-image-title"
      onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose(); }}
      className="fixed inset-0 m-auto w-[min(44rem,calc(100%-2rem))] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-6 text-neutral-200 shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="batch-image-title" className="text-lg font-bold">批量导入图片</h2>
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm disabled:opacity-40">关闭</button>
      </div>
      <p className="mt-3 text-sm">匹配范围：{groupName} · {cards.length} 张卡牌</p>
      <p className="mt-2 text-sm leading-relaxed text-neutral-400">
        先导入 TXT 卡牌，再选择图片。文件名去掉扩展名后需与卡牌名称一致，例如「幻王·奥斯维尔.png」。忽略首尾空格、英文大小写和全角/半角差异；保留名称中的标点与空格。
      </p>
      <p className="mt-2 text-xs leading-relaxed text-neutral-500">支持 PNG、JPG、WebP、GIF、BMP、AVIF。图片保留原始质量，保存到本机牌库，支持批量存储大图；也可通过“备份JSON”导出保存。</p>
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3 text-sm">
        <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()} className="rounded-lg bg-neutral-800 px-3 py-2 font-bold text-neutral-200 hover:text-accent disabled:opacity-40">
          选择图片（可多选）
        </button>
        <span className="text-neutral-400">{files.length ? `已选择 ${files.length} 个文件` : '尚未选择图片'}</span>
        <input
          ref={fileInputRef}
          aria-label="选择图片（可多选）"
          type="file" accept={IMAGE_IMPORT_ACCEPT} multiple disabled={busy}
          className="hidden"
          onChange={event => {
            setFiles(Array.from(event.target.files || []));
            event.target.value = '';
            setMessage('');
            setFailures({});
            setImportedIds(new Set());
          }}
        />
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={replaceExisting} disabled={busy || importedIds.size > 0} onChange={event => { setReplaceExisting(event.target.checked); setMessage(''); setFailures({}); }} />
        替换卡牌已有插画（包括默认图）
      </label>
      {files.length > 0 && (
        <>
          <p className="mt-4 text-sm font-bold">{importedIds.size
            ? `导入结果：已保存 ${importedIds.size} 张插画 · 跳过 ${files.length - importedIds.size} 个文件`
            : `匹配预览：匹配 ${matches.length} 张卡牌 · 跳过 ${files.length - matches.length} 个文件`}</p>
          <ul aria-label="图片匹配结果" className="mt-3 max-h-64 overflow-y-auto divide-y divide-white/10 rounded-lg border border-white/10">
            {rows.map(row => (
              <li key={row.fileIndex} className="p-3 text-sm break-words">
                <div className="font-medium">{row.fileName}{row.card ? ` → ${row.card.cardData.name}` : ''}</div>
                <div className="mt-1 text-xs text-neutral-400">
                  {failures[row.fileIndex] || (row.card && importedIds.has(row.card.id) ? '已保存' : STATUS_LABELS[row.status])}
                  {row.status === 'matched' && !importedIds.size && !failures[row.fileIndex] && row.card?.cardData.image ? ' · 将替换已有插画' : ''}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" aria-live="polite" className="mt-4 text-sm leading-relaxed">{busy ? progress === matches.length ? '正在保存图片，请稍候…' : `正在读取图片 ${progress} / ${matches.length}…` : message}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">导入后插画缩放和位置将重置，可在编辑器中调整。</p>
        <button type="button" onClick={applyImages} disabled={busy || !matches.length || importedIds.size > 0} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          {busy ? '导入中…' : importedIds.size ? '已完成导入' : `确认导入 ${matches.length} 张插画`}
        </button>
      </div>
    </dialog>
  );
}

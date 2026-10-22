import { useCallback, useEffect, useRef, useState } from 'react';
import { smartSelect, paintStroke } from './etaSelection';

export interface EtaPreview {
  width: number; height: number; step_um: number; low: number; high: number;
  source_sha256: string; iq: Float32Array; valid: Uint8Array;
}
export interface EtaSelection { preview: EtaPreview; mask: Uint8Array }
type Tool = 'smart-add' | 'smart-erase' | 'paint' | 'erase';

export default function EtaMaskEditor({ name, selection, onApply, onClose }: {
  name: string; selection: EtaSelection; onApply: (mask: Uint8Array) => void; onClose: () => void;
}) {
  const { preview } = selection;
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const mask = useRef<Uint8Array>(selection.mask.slice());
  const undo = useRef<Uint8Array[]>([]), redo = useRef<Uint8Array[]>([]);
  const dragging = useRef<[number, number] | null>(null);
  const [revision, setRevision] = useState(0), [tool, setTool] = useState<Tool>('smart-add');
  const [sensitivity, setSensitivity] = useState(15), [diameter, setDiameter] = useState(20);
  const [zoom, setZoom] = useState(100), [opacity, setOpacity] = useState(.55);
  const [selected, setSelected] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number; size: number } | null>(null);
  const validCount = preview.valid.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const historyLimit = Math.max(1, Math.min(15, Math.floor(32_000_000 / mask.current.length)));
  const remember = () => { undo.current.push(mask.current.slice()); if (undo.current.length > historyLimit) undo.current.shift(); redo.current = []; };
  const redraw = () => setRevision(value => value + 1);
  const undoEdit = useCallback(() => {
    if (!undo.current.length) return;
    redo.current.push(mask.current); mask.current = undo.current.pop()!;
    setRevision(value => value + 1);
  }, []);
  const redoEdit = useCallback(() => {
    if (!redo.current.length) return;
    undo.current.push(mask.current); mask.current = redo.current.pop()!;
    setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || (target instanceof HTMLInputElement && target.type !== 'range'))) return;
      const key = event.key.toLowerCase();
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) redoEdit(); else undoEdit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [undoEdit, redoEdit]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setViewportSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);
  // 100% fits the image's full height to the space left by the editor controls.
  const displayHeight = Math.max(1, viewportSize.height) * zoom / 100;
  const displayWidth = displayHeight * preview.width / preview.height;
  useEffect(() => {
    const context = canvas.current?.getContext('2d'); if (!context) return;
    const image = context.createImageData(preview.width, preview.height); let count = 0;
    const span = Math.max(1, preview.high - preview.low);
    for (let i = 0; i < mask.current.length; i++) {
      const shade = preview.valid[i] ? Math.max(0, Math.min(255, (preview.iq[i] - preview.low) / span * 255)) : 255;
      const picked = mask.current[i] === 1; if (picked) count++;
      image.data[i * 4] = picked ? shade * (1 - opacity) + 183 * opacity : shade;
      image.data[i * 4 + 1] = picked ? shade * (1 - opacity) + 78 * opacity : shade;
      image.data[i * 4 + 2] = picked ? shade * (1 - opacity) + 220 * opacity : shade;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0); setSelected(count);
  }, [preview, revision, opacity]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(preview.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * preview.width))),
      Math.max(0, Math.min(preview.height - 1, Math.floor((event.clientY - bounds.top) / bounds.height * preview.height)))];
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const [x, y] = point(event); remember();
    if (tool.startsWith('smart')) {
      const tolerance = (preview.high - preview.low) * sensitivity / 100;
      smartSelect(mask.current, preview.iq, preview.valid, preview.width, preview.height, x, y, tolerance, tool === 'smart-erase');
    } else {
      dragging.current = [x, y]; event.currentTarget.setPointerCapture(event.pointerId);
      paintStroke(mask.current, preview.valid, preview.width, preview.height, [x, y], [x, y], diameter, tool === 'erase');
    }
    redraw();
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCursor({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, size: diameter * bounds.width / preview.width });
    if (!dragging.current) return;
    const next = point(event);
    paintStroke(mask.current, preview.valid, preview.width, preview.height, dragging.current, next, diameter, tool === 'erase');
    dragging.current = next; redraw();
  };
  return <div role="dialog" aria-modal="true" aria-label="에타 영역 편집" className="fixed inset-0 z-50 bg-slate-950/80 p-3 md:p-6 flex items-center justify-center">
    <section className="bg-white rounded-2xl w-full max-w-6xl h-full max-h-full flex flex-col overflow-hidden shadow-xl">
      <header className="p-4 border-b flex items-center justify-between gap-3"><div><h2 className="font-bold">에타 영역 편집</h2><p className="text-xs text-slate-500 break-all">{name} · {preview.width} × {preview.height} · {preview.step_um.toPrecision(3)} µm/px</p></div><button aria-label="에타 편집 취소" onClick={onClose} className="px-3 py-2 text-sm">닫기</button></header>
      <div className="p-3 border-b bg-slate-50 flex flex-wrap gap-2">{([['smart-add', '스마트 영역 선택'], ['smart-erase', '스마트 지우개'], ['paint', '브러시'], ['erase', '지우개']] as [Tool, string][]).map(([key, label]) => <button key={key} onClick={() => { dragging.current = null; setTool(key); }} aria-pressed={tool === key} className={`rounded-lg px-3 py-2 text-xs font-semibold ${tool === key ? 'bg-purple-700 text-white' : 'bg-white border border-slate-200'}`}>{label}</button>)}<button disabled={!undo.current.length} title="실행 취소 (Ctrl+Z)" onClick={undoEdit} className="px-3 py-2 text-xs disabled:opacity-30">실행 취소</button><button disabled={!redo.current.length} title="다시 실행 (Ctrl+Shift+Z / Ctrl+Y)" onClick={redoEdit} className="px-3 py-2 text-xs disabled:opacity-30">다시 실행</button><button onClick={() => { remember(); mask.current.fill(0); redraw(); }} className="px-3 py-2 text-xs text-red-600">선택 초기화</button></div>
      <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs"><label>민감도 {sensitivity}%<input aria-label="스마트 선택 민감도" className="w-full accent-purple-700" type="range" min=".1" max="50" step=".1" value={sensitivity} onChange={event => setSensitivity(Number(event.target.value))} /></label><label>브러시 지름 {diameter}px<input aria-label="에타 브러시 크기" className="w-full accent-purple-700" type="range" min="1" max="200" value={diameter} onChange={event => setDiameter(Number(event.target.value))} /></label><label>확대 {zoom}% · 세로 기준<input aria-label="에타 편집 확대" className="w-full" type="range" min="25" max="400" step="25" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label><label>선택 색 농도 {Math.round(opacity * 100)}%<input aria-label="에타 선택 표시 농도" className="w-full" type="range" min=".1" max=".9" step=".05" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /></label></div>
      <p className="px-4 pb-3 text-xs text-slate-500">원본 IQ 맵에서 클릭한 점과 IQ가 비슷하고 연결된 영역을 선택합니다. 민감도가 높을수록 더 넓은 IQ 차이를 허용합니다. 보라색이 에타 선택 영역입니다.</p>
      <div ref={viewport} className="overflow-auto bg-slate-200 min-h-0 flex-1"><div className="relative" style={{ width: displayWidth, height: displayHeight, marginInline: displayWidth <= viewportSize.width ? 'auto' : 0 }}><canvas ref={canvas} width={preview.width} height={preview.height} onPointerDown={down} onPointerMove={move} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }} onPointerLeave={() => setCursor(null)} style={{ width: '100%', display: 'block', touchAction: 'none', cursor: 'crosshair', imageRendering: 'pixelated' }} />{cursor && !tool.startsWith('smart') && <div className="absolute border border-white rounded-full pointer-events-none shadow-[0_0_0_1px_black]" style={{ left: cursor.x - cursor.size / 2, top: cursor.y - cursor.size / 2, width: cursor.size, height: cursor.size }} />}</div></div>
      <footer className="p-4 flex justify-between items-center gap-3 border-t"><p className="text-sm font-semibold text-purple-800">선택 {(selected / Math.max(1, validCount) * 100).toFixed(3)} Area% <span className="text-xs font-normal">({selected.toLocaleString()}점)</span></p><button onClick={() => onApply(mask.current.slice())} className="px-5 py-2.5 rounded-xl bg-purple-700 text-white text-sm font-bold">선택 영역 적용</button></footer>
    </section>
  </div>;
}

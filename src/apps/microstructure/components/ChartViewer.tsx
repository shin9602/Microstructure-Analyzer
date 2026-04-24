import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
} from 'recharts';
import type { PeakDefinition, ParsedFile } from '../types';
import { ChevronDown, RotateCcw, Move, MousePointer2, ZoomIn, Download, Settings2, X } from 'lucide-react';

interface ChartViewerProps {
  files: ParsedFile[];
  activeFileId: string | null;
  onFileChange: (fileId: string) => void;
  peakDefinitions: PeakDefinition[];
  activePlane: string | null;
  onRangeSelect: (min: number, max: number) => void;
  onClearSelection: () => void;
  visibleReferenceMaterials?: string[];
  allMaterialDefinitions?: Record<string, PeakDefinition[]>;
  mode: 'pan' | 'select' | 'zoom';
  onModeChange: (mode: 'pan' | 'select' | 'zoom') => void;
  selectedCnTwoTheta?: number | null;
  gsFWHMData?: {
    fwhm: number;
    peak2Theta: number;
    left2Theta: number;
    right2Theta: number;
    halfMax: number;
  } | null;
  chartFixedRange?: [number, number] | null;
  twoThetaShift: number;
  onUpdateShift: (shift: number) => void;
}

type InteractionMode = 'pan' | 'select' | 'zoom';

const ChartViewer: React.FC<ChartViewerProps> = ({
  files,
  activeFileId,
  onFileChange,
  peakDefinitions,
  activePlane,
  onRangeSelect,
  onClearSelection,
  visibleReferenceMaterials = [],
  allMaterialDefinitions = {},
  mode,
  onModeChange,
  selectedCnTwoTheta = null,
  gsFWHMData = null,
  chartFixedRange = null,
  twoThetaShift,
  onUpdateShift
}) => {
  const dragStartRef = useRef<number | null>(null);
  const dragEndRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Zoom State
  const [left, setLeft] = useState<string | number>(chartFixedRange ? chartFixedRange[0] : 'dataMin');
  const [right, setRight] = useState<number | 'dataMin' | 'dataMax'>(chartFixedRange ? chartFixedRange[1] : 'dataMax');
  const [top, setTop] = useState<string | number>('dataMax');
  const [bottom, setBottom] = useState<string | number>('dataMin');

  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Panning State
  const isDraggingRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false); // To disable tooltip
  const [isRawMode, setIsRawMode] = useState(false); // Default 1/5 sampled for performance
  const dragStartViewRef = useRef<{ left: number, right: number } | null>(null);
  const dragStartPosXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const ABS_MIN = 20;
  const ABS_MAX = 130;

  // Track container size
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const updateSize = () => {
      if (chartContainerRef.current) {
        const { width, height } = chartContainerRef.current.getBoundingClientRect();
        setChartSize({ width: Math.round(width), height: Math.round(height) });
      }
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(chartContainerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Sync with fixed range
  useLayoutEffect(() => {
    if (chartFixedRange) {
      setLeft(chartFixedRange[0]);
      setRight(chartFixedRange[1]);
    } else {
      setLeft('dataMin');
      setRight('dataMax');
    }
    setTop('dataMax');
    setBottom('dataMin');
    setRefAreaLeft(null);
    setRefAreaRight(null);
    dragStartRef.current = null;
    dragEndRef.current = null;
  }, [chartFixedRange]);

  // Download settings
  const ASPECT_RATIOS = [
    { label: '16:9', w: 1920, h: 1080, desc: '1920×1080' },
    { label: '4:3', w: 1600, h: 1200, desc: '1600×1200' },
    { label: '3:2', w: 1800, h: 1200, desc: '1800×1200' },
    { label: '1:1', w: 1200, h: 1200, desc: '1200×1200' },
  ];
  const [showDownloadSettings, setShowDownloadSettings] = useState(false);
  const [downloadXAxisMin, setDownloadXAxisMin] = useState<string>('');
  const [downloadXAxisMax, setDownloadXAxisMax] = useState<string>('');
  const [useCustomXAxis, setUseCustomXAxis] = useState(false);
  const [downloadWidth, setDownloadWidth] = useState<string>('1920');
  const [downloadHeight, setDownloadHeight] = useState<string>('1080');
  const [downloadFontSize, setDownloadFontSize] = useState<string>('14');
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpg' | 'svg'>('png');

  useEffect(() => {
    const saved = localStorage.getItem('xrd_download_settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        setDownloadXAxisMin(settings.xMin || '');
        setDownloadXAxisMax(settings.xMax || '');
        setUseCustomXAxis(!!settings.useCustom);
        setDownloadWidth(settings.width || '1920');
        setDownloadHeight(settings.height || '1080');
        setDownloadFontSize(settings.fontSize || '14');
        setDownloadFormat(settings.format || 'png');
      } catch (e) {
        console.error('Failed to load download settings:', e);
      }
    }
  }, []);

  const saveDownloadSettings = () => {
    localStorage.setItem('xrd_download_settings', JSON.stringify({
      xMin: downloadXAxisMin,
      xMax: downloadXAxisMax,
      useCustom: useCustomXAxis,
      width: downloadWidth,
      height: downloadHeight,
      fontSize: downloadFontSize,
      format: downloadFormat,
    }));
    setShowDownloadSettings(false);
  };

  const activeFile = files.find(f => f.id === activeFileId) || files[0];
  const data = activeFile?.data || [];

  // ⚡ Optimization: Level of Detail (LOD)
  // Create a downsampled dataset for smooth interaction
  const downsampledData = useMemo(() => {
    if (data.length < 1000) return data;
    const step = 2;
    const sampled = [];
    for (let i = 0; i < data.length; i += step) {
      sampled.push(data[i]);
    }
    if (data.length % step !== 0) sampled.push(data[data.length - 1]);
    return sampled;
  }, [data]);

  const activeDisplayData = isRawMode ? data : downsampledData;

  // Global styles
  useEffect(() => {
    const styleId = 'xrd-final-fix-v5';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        .recharts-wrapper, .recharts-wrapper *, .recharts-surface, .recharts-surface:focus,
        .recharts-legend-wrapper, .recharts-tooltip-wrapper, svg:focus, path:focus, rect:focus, [tabindex]:focus {
          outline: none !important;
          box-shadow: none !important;
          -webkit-tap-highlight-color: transparent;
        }
        .grabbing-active, .grabbing-active * {
          cursor: grabbing !important;
          user-select: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Performance-optimized Panning Engine (rAF)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;

    const handleMouseDown = (e: MouseEvent) => {
      if (mode === 'pan') {
        const rect = container.getBoundingClientRect();
        if (e.clientX - rect.left < 50 || rect.bottom - e.clientY < 50) return;

        e.preventDefault();
        e.stopPropagation();

        let currentLeft = left;
        let currentRight = right;

        if (typeof currentLeft !== 'number' || typeof currentRight !== 'number') {
          currentLeft = data[0]?.twoTheta || 20;
          currentRight = data[data.length - 1]?.twoTheta || 130;
          setLeft(currentLeft);
          setRight(currentRight);
        }

        isDraggingRef.current = true;
        setIsPanning(true);
        dragStartViewRef.current = { left: currentLeft as number, right: currentRight as number };
        dragStartPosXRef.current = e.clientX;
        document.body.classList.add('grabbing-active');
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartViewRef.current || dragStartPosXRef.current === null) return;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        if (!dragStartViewRef.current || dragStartPosXRef.current === null) return;
        const deltaPx = dragStartPosXRef.current - e.clientX;
        const width = container.clientWidth;
        const chartWidth = Math.max(width - 50, 100);
        const domain = dragStartViewRef.current.right - dragStartViewRef.current.left;

        if (domain <= 0) return;

        const deltaValue = deltaPx * (domain / chartWidth);

        let nl = dragStartViewRef.current.left + deltaValue;
        let nr = dragStartViewRef.current.right + deltaValue;

        if (nl < ABS_MIN) { const d = ABS_MIN - nl; nl += d; nr += d; }
        if (nr > ABS_MAX) { const d = nr - ABS_MAX; nl -= d; nr -= d; }

        setLeft(nl);
        setRight(nr);
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsPanning(false);
      dragStartViewRef.current = null;
      dragStartPosXRef.current = null;
      document.body.classList.remove('grabbing-active');
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };

    container.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [mode, left, right, data]);

  const zoomOut = () => {
    if (chartFixedRange) {
      setLeft(chartFixedRange[0]);
      setRight(chartFixedRange[1]);
    } else {
      setLeft(ABS_MIN);
      setRight(ABS_MAX);
    }
    setTop('dataMax');
    setBottom('dataMin');
    setRefAreaLeft(null);
    setRefAreaRight(null);
    dragStartRef.current = null;
    dragEndRef.current = null;
  };

  const handleMouseDownWrapper = (e: any) => {
    if (mode === 'pan') return;

    if (e && e.activeLabel != null) {
      const val = Number(e.activeLabel);
      if (!isNaN(val) && (mode === 'select' || mode === 'zoom')) {
        dragStartRef.current = val;
        dragEndRef.current = val;
        setRefAreaLeft(val);
        setRefAreaRight(val);
      }
    }
  }

  const handleMouseMoveWrapper = (e: any) => {
    if (mode === 'pan') return;
    if (dragStartRef.current != null && e && e.activeLabel != null) {
      const val = Number(e.activeLabel);
      if (!isNaN(val)) {
        dragEndRef.current = val;
        setRefAreaRight(val);
      }
    }
  };

  const handleMouseUpWrapper = () => {
    if (mode === 'pan' || isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }
    if (dragStartRef.current != null && dragEndRef.current != null) {
      const start = dragStartRef.current;
      const end = dragEndRef.current;
      let min = Math.max(ABS_MIN, Math.min(start, end));
      let max = Math.min(ABS_MAX, Math.max(start, end));

      if (Math.abs(max - min) < 0.05) {
        max = Math.min(ABS_MAX, min + 0.2);
        min = Math.max(ABS_MIN, min - 0.2);
      }

      if (mode === 'select' && min < max) {
        onRangeSelect(Math.round(min * 1000) / 1000, Math.round(max * 1000) / 1000);
        if (selectedCnTwoTheta === null) onModeChange('pan');
      } else if (mode === 'zoom' && min < max) {
        setLeft(min);
        setRight(max);
        onModeChange('pan');
      }
    }
    dragStartRef.current = null;
    dragEndRef.current = null;
    setRefAreaLeft(null);
    setRefAreaRight(null);
  };

  const getCursorStyle = () => {
    if (mode === 'pan') return 'cursor-move';
    if (mode === 'zoom') return 'cursor-zoom-in';
    if (mode === 'select') return 'cursor-crosshair';
    return 'cursor-default';
  };

  const getMaterialColor = (index: number) => {
    const colors = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
    return colors[index % colors.length];
  };

  const handleDownloadChart = async () => {
    if (!chartContainerRef.current) return;
    setIsDownloading(true);
    setIsCapturing(true);

    const tw = parseInt(downloadWidth) || 1920;
    const th = parseInt(downloadHeight) || 1080;
    const ol = left;
    const or = right;

    try {
      // X축 범위 변경이 필요한 경우 state 업데이트 후 렌더 대기
      if (useCustomXAxis && downloadXAxisMin && downloadXAxisMax) {
        const minVal = parseFloat(downloadXAxisMin);
        const maxVal = parseFloat(downloadXAxisMax);
        if (!isNaN(minVal) && !isNaN(maxVal) && minVal < maxVal) {
          setLeft(minVal);
          setRight(maxVal);
          await new Promise(r => setTimeout(r, 150));
        }
      }

      // recharts SVG를 직접 찾아서 캔버스에 그림
      const svgEl = chartContainerRef.current.querySelector('svg');
      if (!svgEl) throw new Error('SVG not found');

      // 원본 SVG의 실제 렌더 크기를 viewBox로 설정해야 올바르게 스케일됨
      const svgRect = svgEl.getBoundingClientRect();
      const srcW = svgRect.width || svgEl.clientWidth || tw;
      const srcH = svgRect.height || svgEl.clientHeight || th;

      const svgClone = svgEl.cloneNode(true) as SVGElement;
      svgClone.setAttribute('width', String(tw));
      svgClone.setAttribute('height', String(th));
      svgClone.setAttribute('viewBox', `0 0 ${srcW} ${srcH}`);
      svgClone.style.background = '#ffffff';

      // 폰트 크기 일괄 적용
      const fs = parseInt(downloadFontSize) || 14;
      svgClone.querySelectorAll('text').forEach(t => {
        t.style.fontSize = `${fs}px`;
      });

      const svgData = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const baseName = `${activeFile?.name.replace(/\.(asc|txt|xrdml)$/i, '') || 'chart'}_${tw}x${th}`;

      if (downloadFormat === 'svg') {
        const link = document.createElement('a');
        link.download = `${baseName}.svg`;
        link.href = svgUrl;
        link.click();
        URL.revokeObjectURL(svgUrl);
      } else {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = tw;
            canvas.height = th;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, tw, th);
            ctx.drawImage(img, 0, 0, tw, th);
            URL.revokeObjectURL(svgUrl);

            const mimeType = downloadFormat === 'jpg' ? 'image/jpeg' : 'image/png';
            const quality = downloadFormat === 'jpg' ? 0.92 : 1.0;
            const link = document.createElement('a');
            link.download = `${baseName}.${downloadFormat}`;
            link.href = canvas.toDataURL(mimeType, quality);
            link.click();
            resolve();
          };
          img.onerror = reject;
          img.src = svgUrl;
        });
      }

      setLeft(ol);
      setRight(or);
    } catch (e) {
      console.error(e);
      setLeft(ol);
      setRight(or);
      alert('다운로드 오류');
    } finally {
      setIsDownloading(false);
      setIsCapturing(false);
    }
  };

  const [isCapturing, setIsCapturing] = useState(false);

  // Nice integer steps that are multiples of 5 or 10
  const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

  const getTicks = (min: any, max: any, targetCount = 5) => {
    let nMin = typeof min === 'number' ? min : 0;
    let nMax = typeof max === 'number' ? max : 100;

    if (min === 'dataMin' && data.length > 0) nMin = data[0].twoTheta;
    if (max === 'dataMax' && data.length > 0) nMax = data[data.length - 1].twoTheta;

    const range = nMax - nMin;
    if (range <= 0) return [];

    // Find the best step from NICE_STEPS to get ~targetCount intervals
    let bestStep = NICE_STEPS[NICE_STEPS.length - 1];
    let minDiff = Infinity;

    for (const step of NICE_STEPS) {
      const count = range / step;
      const diff = Math.abs(count - targetCount);
      if (diff <= minDiff) {
        minDiff = diff;
        bestStep = step;
      }
    }

    const start = Math.ceil(nMin / bestStep) * bestStep;
    const ticks = [];
    for (let i = start; i <= nMax; i += bestStep) {
      ticks.push(i);
    }
    return ticks;
  };

  const xTicks = getTicks(left, right, 5);
  // Y-axis fixed to 0-100 with 5 intervals (step 20)
  const yTicks = [0, 20, 40, 60, 80, 100];

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col h-full relative overflow-hidden">
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 p-2 rounded-xl border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="relative">
              <select value={activeFileId || ''} onChange={(e) => onFileChange(e.target.value)} className="appearance-none bg-white border border-slate-200 text-slate-700 text-sm rounded-lg block w-48 sm:w-64 p-2 pl-3 pr-8 truncate font-bold shadow-sm">
                {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500"><ChevronDown size={14} /></div>
            </div>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              {[{ id: 'pan', icon: Move }, { id: 'select', icon: MousePointer2 }, { id: 'zoom', icon: ZoomIn }].map(item => (
                <button key={item.id} onClick={() => onModeChange(item.id as InteractionMode)} className={`p-1.5 rounded-md transition-all ${mode === item.id ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100' : 'text-slate-500 hover:bg-white/50'}`}>
                  <item.icon size={18} />
                </button>
              ))}
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <button onClick={zoomOut} className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-white rounded-md transition-all"><RotateCcw size={18} /></button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded border border-slate-100 hidden sm:block">{chartSize.width} x {chartSize.height} px</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDownloadSettings(!showDownloadSettings)} className="p-2 bg-white text-slate-500 rounded-lg border hover:text-slate-800 transition-all shadow-sm"><Settings2 size={18} /></button>
              <button onClick={handleDownloadChart} disabled={isDownloading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 font-bold text-xs flex items-center gap-2">
                <Download size={16} /><span>{isDownloading ? '...' : 'Download'}</span>
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 bg-white px-3 py-2 rounded-lg border shadow-sm">
              <div className="flex items-center gap-2 border-r pr-3"><Move size={14} className="text-blue-600" /><span className="text-[10px] font-black text-slate-800 uppercase tracking-widest whitespace-nowrap">PEAK SHIFT</span></div>
              <div className="flex items-center gap-3">
                <input type="range" min="-0.5" max="0.5" step="0.005" value={twoThetaShift} onChange={(e) => onUpdateShift(parseFloat(e.target.value))} className="w-32 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-0.5 rounded border">
                  <input type="number" step="0.001" value={twoThetaShift} onChange={(e) => onUpdateShift(parseFloat(e.target.value) || 0)} className="w-12 bg-transparent text-xs font-mono font-bold text-blue-700 focus:outline-none text-center" />
                  <span className="text-[10px] font-black text-slate-400">2θ</span>
                </div>
                <button onClick={() => onUpdateShift(0)} className="px-2 py-1 text-[9px] font-black text-slate-500 hover:bg-slate-800 hover:text-white border rounded transition-all">RESET</button>
              </div>
            </div>

            <button
              onClick={() => setIsRawMode(!isRawMode)}
              className={`px-3 py-2 rounded-lg border text-[10px] font-black transition-all flex items-center gap-2 shadow-sm ${isRawMode ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-slate-500 hover:border-slate-300'}`}
              title={isRawMode ? "Performance Mode (1/5 Sampled)" : "Raw Data Mode (Full Data)"}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isRawMode ? 'bg-white animate-pulse' : 'bg-slate-300'}`} />
              RAW DATA: {isRawMode ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
            <span>Z for Zoom</span><span className="w-1 h-1 rounded-full bg-slate-300" /><span>Double-click Reset</span>
          </div>
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className={`flex-1 min-h-[400px] w-full relative select-none touch-none ${getCursorStyle()} outline-none`}
        onDoubleClick={zoomOut}
      >
        <div className="absolute inset-0 outline-none">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <LineChart
              data={activeDisplayData}
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              onMouseDown={handleMouseDownWrapper}
              onMouseMove={handleMouseMoveWrapper}
              onMouseUp={handleMouseUpWrapper}
              onMouseLeave={handleMouseUpWrapper}
              className="outline-none ring-0"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="twoTheta"
                type="number"
                domain={[left, right]}
                allowDataOverflow
                ticks={xTicks}
                label={{ value: '2-Theta (degrees)', position: 'bottom', offset: 0, style: { fill: '#64748b', fontSize: 14, fontWeight: 400 } }}
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={v => v.toFixed(0)}
              />
              <YAxis
                domain={[0, 100]}
                allowDataOverflow
                ticks={yTicks}
                label={{ value: 'Intensity (a.u.)', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#64748b', fontSize: 14, fontWeight: 400 } }}
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={v => (typeof v === 'number' ? v.toFixed(0) : v)}
              />
              {!isPanning && (
                <Tooltip
                  cursor={mode === 'pan' ? false : { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                  formatter={(val: any) => [typeof val === 'number' ? val.toFixed(2) : val, 'Intensity']}
                  labelFormatter={(label: any) => typeof label === 'number' ? `2θ: ${label.toFixed(3)}°` : label}
                />
              )}
              <Line type="monotone" dataKey="intensity" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              {visibleReferenceMaterials.map((matId, index) => (allMaterialDefinitions[matId] || []).map((def, pIdx) => (
                <ReferenceLine key={`${matId}-${pIdx}`} x={def.theoreticalPos || 0} stroke={getMaterialColor(index)} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: def.plane ? `(${def.plane})` : '', position: 'top', fill: getMaterialColor(index), fontSize: 10, opacity: 0.8 }} />
              )))}
              {/* Peak range overlays */}
              {peakDefinitions.map(def => {
                const isActive = def.plane === activePlane;
                if (!def.range?.min || !def.range?.max) return null;
                return (
                  <ReferenceArea
                    key={`range-${def.plane}`}
                    x1={def.range.min}
                    x2={def.range.max}
                    fill={isActive ? "#3b82f6" : "#94a3b8"}
                    fillOpacity={isActive ? 0.25 : 0.1}
                    stroke={isActive ? "#3b82f6" : "#94a3b8"}
                    strokeOpacity={isActive ? 0.6 : 0.2}
                    strokeWidth={1}
                  />
                );
              })}
              {refAreaLeft && refAreaRight && <ReferenceArea x1={refAreaLeft} x2={refAreaRight} strokeOpacity={0.3} fill={mode === 'select' ? "#3b82f6" : "#8884d8"} fillOpacity={0.3} />}
              {gsFWHMData && (
                <>
                  <ReferenceArea x1={gsFWHMData.left2Theta} x2={gsFWHMData.right2Theta} fill="#6366f1" fillOpacity={0.1} />
                  <ReferenceLine x={gsFWHMData.left2Theta} stroke="#4338ca" strokeWidth={1} />
                  <ReferenceDot x={gsFWHMData.left2Theta} y={gsFWHMData.halfMax} r={4} fill="#4338ca" stroke="#fff" strokeWidth={2} />
                  <ReferenceDot x={gsFWHMData.right2Theta} y={gsFWHMData.halfMax} r={4} fill="#4338ca" stroke="#fff" strokeWidth={2} />
                  <ReferenceLine x={gsFWHMData.peak2Theta} stroke="#6366f1" strokeWidth={1} strokeDasharray="5 5" />
                </>
              )}
              {selectedCnTwoTheta !== null && <ReferenceLine x={selectedCnTwoTheta} stroke="#10b981" strokeWidth={3} label={{ value: `Selected: ${selectedCnTwoTheta.toFixed(2)}°`, position: 'top', fill: '#10b981', fontSize: 12, fontWeight: 'bold' }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {isCapturing && (
        <div className="capture-overlay fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[99999]">
          <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center">
            <Download className="text-blue-600 animate-bounce mb-4" size={32} />
            <h3 className="text-xl font-bold mb-2">고해상도 최적화 중...</h3>
            <p className="text-slate-500 text-sm mb-6">{downloadWidth}x{downloadHeight} 렌더링 중</p>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-blue-600 h-full w-1/2 animate-shimmer"></div></div>
          </div>
        </div>
      )}

      {showDownloadSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDownloadSettings(false)}>
          <div className="bg-white rounded-xl p-6 w-[420px]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-bold">Download Settings</h3>
              <button onClick={() => setShowDownloadSettings(false)}><X size={20} /></button>
            </div>
            <div className="space-y-5">

              {/* 포맷 선택 */}
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Format</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['png', 'jpg', 'svg'] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => setDownloadFormat(fmt)}
                      className={`py-2 rounded-lg border text-sm font-bold uppercase transition-all ${downloadFormat === fmt ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 hover:border-blue-300'}`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`space-y-5 transition-opacity ${downloadFormat === 'svg' ? 'opacity-40 pointer-events-none' : ''}`}>
                {/* 비율 선택 */}
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Aspect Ratio</p>
                  <div className="grid grid-cols-4 gap-2">
                    {ASPECT_RATIOS.map(r => (
                      <button
                        key={r.label}
                        onClick={() => { setDownloadWidth(String(r.w)); setDownloadHeight(String(r.h)); }}
                        className={`py-2 px-1 rounded-lg border text-sm font-bold transition-all flex flex-col items-center gap-0.5 ${downloadWidth === String(r.w) && downloadHeight === String(r.h) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 hover:border-blue-300'}`}
                      >
                        <span>{r.label}</span>
                        <span className={`text-[9px] font-normal ${downloadWidth === String(r.w) && downloadHeight === String(r.h) ? 'text-blue-100' : 'text-slate-400'}`}>{r.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 해상도 직접 입력 */}
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Resolution (px)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Width</label>
                      <input type="number" value={downloadWidth} onChange={e => setDownloadWidth(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">Height</label>
                      <input type="number" value={downloadHeight} onChange={e => setDownloadHeight(e.target.value)} className="w-full p-2 border rounded-lg text-sm" />
                    </div>
                  </div>
                </div>

                {/* 폰트 크기 */}
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Font Size — {downloadFontSize}px</p>
                  <input type="range" min="8" max="32" step="1" value={downloadFontSize} onChange={e => setDownloadFontSize(e.target.value)} className="w-full accent-blue-600" />
                  <div className="flex justify-between text-xs text-slate-400 mt-1"><span>8px</span><span>32px</span></div>
                </div>
              </div>

              {/* Custom X축 */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={useCustomXAxis} onChange={e => setUseCustomXAxis(e.target.checked)} className="accent-blue-600" />
                  Custom X-Range
                </label>
                {useCustomXAxis && (
                  <div className="grid grid-cols-2 gap-3 mt-2 pl-5">
                    <input type="number" value={downloadXAxisMin} onChange={e => setDownloadXAxisMin(e.target.value)} placeholder="Min 2θ" className="p-2 border rounded-lg text-sm" />
                    <input type="number" value={downloadXAxisMax} onChange={e => setDownloadXAxisMax(e.target.value)} placeholder="Max 2θ" className="p-2 border rounded-lg text-sm" />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowDownloadSettings(false)} className="px-4 py-2 bg-slate-100 rounded-lg text-sm">Cancel</button>
                <button onClick={saveDownloadSettings} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChartViewer;
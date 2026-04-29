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
  Legend
} from 'recharts';
import type { PeakDefinition, ParsedFile } from '../types';
import { ChevronDown, RotateCcw, Move, MousePointer2, ZoomIn, Download, Settings2, X, Layers, Check, Plus } from 'lucide-react';

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
  onUpdateFileYOffset?: (fileId: string, offset: number) => void;
  onUpdateFileOpacity?: (fileId: string, opacity: number) => void;
  isOverlapMode?: boolean;
  selectedOverlapFileIds?: string[];
  onToggleOverlap?: () => void;
  onToggleFileSelection?: (id: string) => void;
}

type InteractionMode = 'pan' | 'select' | 'zoom';

const ChartViewer: React.FC<ChartViewerProps> = ({
  files,
  activeFileId,
  onFileChange,
  peakDefinitions,
  activePlane,
  onRangeSelect,
  visibleReferenceMaterials = [],
  allMaterialDefinitions = {},
  mode,
  onModeChange,
  selectedCnTwoTheta = null,
  gsFWHMData = null,
  chartFixedRange = null,
  twoThetaShift,
  onUpdateShift,
  onUpdateFileYOffset,
  onUpdateFileOpacity,
  isOverlapMode = false,
  selectedOverlapFileIds = [],
  onToggleOverlap,
  onToggleFileSelection
}) => {
  const dragStartRef = useRef<number | null>(null);
  const dragEndRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  // Zoom State
  const [left, setLeft] = useState<string | number>(chartFixedRange ? chartFixedRange[0] : 'dataMin');
  const [right, setRight] = useState<number | 'dataMin' | 'dataMax'>(chartFixedRange ? chartFixedRange[1] : 'dataMax');

  const [isRawMode, setIsRawMode] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // Panning State
  const isDraggingRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false); // To disable tooltip
  const dragStartViewRef = useRef<{ left: number, right: number } | null>(null);
  const dragStartPosXRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const ABS_MIN = 20;
  const ABS_MAX = 130;

  // Sync with fixed range
  useLayoutEffect(() => {
    if (chartFixedRange) {
      setLeft(chartFixedRange[0]);
      setRight(chartFixedRange[1]);
    } else {
      setLeft('dataMin');
      setRight('dataMax');
    }
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
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [useCustomXAxis, setUseCustomXAxis] = useState(false);
  const [downloadWidth, setDownloadWidth] = useState<string>('1920');
  const [downloadHeight, setDownloadHeight] = useState<string>('1080');
  const [downloadFontSize, setDownloadFontSize] = useState<string>('14');
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'jpg' | 'svg'>('png');
  const [showFileSelector, setShowFileSelector] = useState(false);

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
  
  // ⚡ Optimization: Level of Detail (LOD)
  const activeDisplayData = useMemo(() => {
    const rawData = activeFile?.data || [];
    const offset = activeFile?.yOffset || 0;
    const step = isRawMode ? 1 : 3;

    const sampled = [];
    for (let i = 0; i < rawData.length; i += step) {
      const p = rawData[i];
      sampled.push({
        ...p,
        twoTheta: p.twoTheta + twoThetaShift,
        intensity: Math.max(0, p.intensity + offset)
      });
    }
    return sampled;
  }, [activeFile, isRawMode, twoThetaShift]);
  
  // ⚡ Optimization: Downsample all selected files for Overlap Mode
  const overlapDatasets = useMemo(() => {
    if (!isOverlapMode) return [];

    const step = isRawMode ? 1 : 3;

    return files
      .filter(f => selectedOverlapFileIds.includes(f.id))
      .map(file => {
        const shift = file.twoThetaShift || 0;
        const offset = file.yOffset || 0;
        const processedData = file.data;
        const sampled = [];
        for (let i = 0; i < processedData.length; i += step) {
          const p = processedData[i];
          sampled.push({ 
            ...p, 
            twoTheta: p.twoTheta + shift,
            intensity: Math.max(0, p.intensity + offset)
          });
        }
        return { id: file.id, name: file.name, data: sampled };
      });
  }, [isOverlapMode, files, selectedOverlapFileIds, isRawMode]);

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
          currentLeft = activeDisplayData[0]?.twoTheta || 20;
          currentRight = activeDisplayData[activeDisplayData.length - 1]?.twoTheta || 130;
          setLeft(currentLeft);
          setRight(currentRight);
        }

        isDraggingRef.current = true;
        setIsPanning(true);
        setIsDraggingSlider(true);
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
      setIsDraggingSlider(false);
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
  }, [mode, left, right, activeDisplayData]);

  const zoomOut = () => {
    if (chartFixedRange) {
      setLeft(chartFixedRange[0]);
      setRight(chartFixedRange[1]);
    } else {
      setLeft(ABS_MIN);
      setRight(ABS_MAX);
    }
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
        setIsDraggingSlider(true);
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
    setIsDraggingSlider(false);
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
    const base = [
      '#2563eb', // 1 파랑
      '#dc2626', // 2 빨강
      '#16a34a', // 3 초록
      '#c2410c', // 4 오렌지레드
      '#15803d', // 5 다크그린
      '#b91c1c', // 6 다크레드
      '#1d4ed8', // 7 다크블루
      '#ea580c', // 8 오렌지
      '#166534', // 9 딥그린
      '#991b1b', // 10 딥레드
      '#1e40af', // 11 네이비
      '#f97316', // 12 라이트오렌지
    ];
    return base[index % base.length];
  };

  const getFileColor = (index: number) => {
    const base = [
      '#2563eb', // 1 파랑
      '#dc2626', // 2 빨강
      '#16a34a', // 3 초록
      '#c2410c', // 4 오렌지레드
      '#15803d', // 5 다크그린
      '#b91c1c', // 6 다크레드
      '#1d4ed8', // 7 다크블루
      '#ea580c', // 8 오렌지
      '#166534', // 9 딥그린
      '#991b1b', // 10 딥레드
      '#1e40af', // 11 네이비
      '#f97316', // 12 라이트오렌지
    ];
    return base[index % base.length];
  };

  const captureChartToBlob = async (tw: number, th: number): Promise<Blob | null> => {
    if (!chartContainerRef.current) return null;

    const originalStyle = chartContainerRef.current.style.cssText;
    chartContainerRef.current.style.cssText = `
      width: ${tw}px !important;
      height: ${th}px !important;
      max-width: none !important;
      max-height: none !important;
      position: fixed !important;
      top: -9999px !important;
      left: -9999px !important;
      overflow: visible !important;
    `;

    await new Promise(r => setTimeout(r, 600));

    const originalSvg = chartContainerRef.current.querySelector('svg.recharts-surface') as SVGSVGElement | null;
    if (!originalSvg) {
      chartContainerRef.current.style.cssText = originalStyle;
      return null;
    }

    const svgClone = originalSvg.cloneNode(true) as SVGSVGElement;

    const inlineStyles = (source: Element, target: Element) => {
      const computed = window.getComputedStyle(source);
      let styleString = '';
      for (const key of computed) {
        if (key.startsWith('fill') || key.startsWith('stroke') || key.startsWith('font') || key === 'opacity' || key === 'visibility') {
          styleString += `${key}:${computed.getPropertyValue(key)};`;
        }
      }
      target.setAttribute('style', styleString);
      const sc = source.children, tc = target.children;
      for (let i = 0; i < sc.length; i++) if (sc[i] && tc[i]) inlineStyles(sc[i], tc[i]);
    };
    inlineStyles(originalSvg, svgClone);

    chartContainerRef.current.style.cssText = originalStyle;

    const srcW = originalSvg.viewBox.baseVal.width || tw;
    const srcH = originalSvg.viewBox.baseVal.height || th;

    svgClone.setAttribute('width', String(tw));
    svgClone.setAttribute('height', String(th));
    svgClone.setAttribute('viewBox', `0 0 ${srcW} ${srcH}`);
    svgClone.setAttribute('preserveAspectRatio', 'none');

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', String(srcW)); bg.setAttribute('height', String(srcH));
    bg.setAttribute('fill', '#ffffff');
    svgClone.insertBefore(bg, svgClone.firstChild);

    const legendEl = chartContainerRef.current.querySelector('.recharts-legend-wrapper');
    if (legendEl && isOverlapMode) {
      const legendItems = legendEl.querySelectorAll('.recharts-legend-item');
      let currentX = srcW * 0.05;
      const legendY = srcH * 0.05;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      legendItems.forEach((item, i) => {
        const text = item.querySelector('.recharts-legend-item-text')?.textContent || '';
        const color = item.querySelector('.recharts-surface')?.getAttribute('stroke') || getFileColor(i);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(currentX)); line.setAttribute('y1', String(legendY));
        line.setAttribute('x2', String(currentX + 20)); line.setAttribute('y2', String(legendY));
        line.setAttribute('stroke', color); line.setAttribute('stroke-width', '3');
        g.appendChild(line);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', String(currentX + 25)); t.setAttribute('y', String(legendY + 5));
        t.setAttribute('fill', '#334155'); t.setAttribute('font-size', '14px'); t.setAttribute('font-weight', 'bold');
        t.textContent = text;
        g.appendChild(t);
        currentX += text.length * 8 + 60;
      });
      svgClone.appendChild(g);
    }

    const svgData = new XMLSerializer().serializeToString(svgClone);

    if (downloadFormat === 'svg') {
      return new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    }

    return new Promise<Blob | null>((resolve) => {
      const svgUrl = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        ctx.drawImage(img, 0, 0, tw, th);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(svgUrl);
          resolve(blob);
        }, downloadFormat === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
      };
      img.onerror = () => { URL.revokeObjectURL(svgUrl); resolve(null); };
      img.src = svgUrl;
    });
  };

  const resolveFileName = (usedNames: Set<string>, baseName: string, ext: string): string => {
    let candidate = `${baseName}.${ext}`;
    if (!usedNames.has(candidate)) return candidate;
    let i = 1;
    while (usedNames.has(`${baseName} (${i}).${ext}`)) i++;
    return `${baseName} (${i}).${ext}`;
  };

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadChart = async () => {
    if (!chartContainerRef.current) return;
    setIsDownloading(true);
    setIsCapturing(true);

    try {
      if (useCustomXAxis && downloadXAxisMin && downloadXAxisMax) {
        const minVal = parseFloat(downloadXAxisMin);
        const maxVal = parseFloat(downloadXAxisMax);
        if (!isNaN(minVal) && !isNaN(maxVal) && minVal < maxVal) {
          setLeft(minVal);
          setRight(maxVal);
          await new Promise(r => setTimeout(r, 150));
        }
      }

      const tw = parseInt(downloadWidth) || 1920;
      const th = parseInt(downloadHeight) || 1080;

      const blob = await captureChartToBlob(tw, th);
      setIsCapturing(false);

      if (!blob) throw new Error('Capture failed');

      const rawName = activeFile?.name.replace(/\.(asc|txt|xrdml)$/i, '') || 'chart';
      const baseName = `${rawName}_${tw}x${th}`;
      const ext = downloadFormat;
      const fileName = `${baseName}.${ext}`;
      triggerDownload(blob, fileName);
    } catch (e) {
      console.error('Download failed:', e);
      alert('다운로드 처리 중 오류가 발생했습니다.');
    } finally {
      setIsDownloading(false);
      setIsCapturing(false);
    }
  };

  const handleBulkDownload = async () => {
    if (files.length === 0 || !chartContainerRef.current) return;
    setIsBulkDownloading(true);
    setIsCapturing(true);
    setBulkProgress({ current: 0, total: files.length });

    const tw = parseInt(downloadWidth) || 1920;
    const th = parseInt(downloadHeight) || 1080;
    const ext = downloadFormat;
    const usedNames = new Set<string>();

    if (useCustomXAxis && downloadXAxisMin && downloadXAxisMax) {
      const minVal = parseFloat(downloadXAxisMin);
      const maxVal = parseFloat(downloadXAxisMax);
      if (!isNaN(minVal) && !isNaN(maxVal) && minVal < maxVal) {
        setLeft(minVal);
        setRight(maxVal);
        await new Promise(r => setTimeout(r, 150));
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBulkProgress({ current: i + 1, total: files.length });

      onFileChange(file.id);
      await new Promise(r => setTimeout(r, 400));

      try {
        const blob = await captureChartToBlob(tw, th);
        if (!blob) continue;

        const rawName = file.name.replace(/\.(asc|txt|xrdml)$/i, '');
        const baseName = `${rawName}_${tw}x${th}`;
        const fileName = resolveFileName(usedNames, baseName, ext);
        usedNames.add(fileName);
        triggerDownload(blob, fileName);

        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`Failed to download ${file.name}:`, e);
      }
    }

    setIsCapturing(false);
    setIsBulkDownloading(false);
    setBulkProgress(null);
  };


  // Nice integer steps that are multiples of 5 or 10
  const NICE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];

  const getTicks = (min: any, max: any, targetCount = 5) => {
    let nMin = typeof min === 'number' ? min : 0;
    let nMax = typeof max === 'number' ? max : 100;

    const points = activeFile?.data || [];
    if (min === 'dataMin' && points.length > 0) nMin = points[0].twoTheta;
    if (max === 'dataMax' && points.length > 0) nMax = points[points.length - 1].twoTheta;

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
    <div className="bg-white p-4 flex flex-col h-full relative overflow-hidden">
      <div className="flex flex-col gap-4 mb-4">
        {/* Main Toolbar */}
        <div className="bg-slate-50 p-2 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <select 
                value={activeFileId || ''} 
                onChange={(e) => onFileChange(e.target.value)} 
                disabled={isOverlapMode}
                className={`appearance-none bg-white border border-slate-200 text-slate-700 text-sm rounded-lg block w-48 sm:w-64 p-2 pl-3 pr-8 truncate font-bold shadow-sm ${isOverlapMode ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:border-slate-300'}`}
              >
                {files.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500"><ChevronDown size={14} /></div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggleOverlap?.()}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-bold text-xs transition-all ${isOverlapMode ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}
              >
                <Layers size={14} />
                <span>OVERLAP</span>
                {isOverlapMode && <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] ml-1">{selectedOverlapFileIds.length}</span>}
              </button>

              {isOverlapMode && (
                <div className="relative">
                  <button
                    onClick={() => setShowFileSelector(!showFileSelector)}
                    className="p-2 bg-white text-slate-500 rounded-lg border hover:text-blue-600 hover:border-blue-400 transition-all shadow-sm"
                    title="Select Files to Overlap"
                  >
                    <Plus size={18} />
                  </button>
                  {showFileSelector && (
                    <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-2xl border border-slate-100 py-3 z-[60] animate-fade-in max-h-80 overflow-y-auto">
                      <div className="px-4 pb-2 mb-2 border-b border-slate-50 flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Files</span>
                        <button onClick={() => setShowFileSelector(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={14} /></button>
                      </div>
                      <div className="flex flex-col">
                        {files.map((f, idx) => (
                          <div key={f.id} className="flex flex-col hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0">
                            <button
                              onClick={() => onToggleFileSelection?.(f.id)}
                              className="flex items-center gap-3 px-4 py-2.5 text-left w-full"
                            >
                              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0 ${selectedOverlapFileIds.includes(f.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
                                {selectedOverlapFileIds.includes(f.id) && <Check size={10} className="text-white" strokeWidth={4} />}
                              </div>
                              <div className="flex-1 min-w-0 pr-2">
                                <p className={`text-xs font-bold truncate ${selectedOverlapFileIds.includes(f.id) ? 'text-blue-600' : 'text-slate-600'}`} title={f.name}>{f.name}</p>
                              </div>
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getFileColor(idx) }} />
                            </button>
                            {selectedOverlapFileIds.includes(f.id) && onUpdateFileYOffset && (
                              <div className="flex items-center gap-3 px-4 pb-3 pt-1 pl-11">
                                <div className="flex-1 flex flex-col gap-1">
                                  <div className="flex justify-between items-center mb-0.5">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Vertical Offset</span>
                                    <span className="text-[10px] font-mono font-bold text-blue-600">{f.yOffset || 0}%</span>
                                  </div>
                                  <input 
                                    type="range" 
                                    min="-100" 
                                    max="100" 
                                    step="0.5" 
                                    value={f.yOffset || 0} 
                                    onChange={(e) => onUpdateFileYOffset(f.id, parseFloat(e.target.value) || 0)} 
                                    onMouseDown={() => setIsDraggingSlider(true)}
                                    onMouseUp={() => setIsDraggingSlider(false)}
                                    onTouchStart={() => setIsDraggingSlider(true)}
                                    onTouchEnd={() => setIsDraggingSlider(false)}
                                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                                  />
                                </div>
                                <button 
                                  onClick={() => onUpdateFileYOffset(f.id, 0)}
                                  className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                                  title="Reset Y-Shift"
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            )}

                            {selectedOverlapFileIds.includes(f.id) && onUpdateFileOpacity && (
                              <div className="flex items-center gap-3 px-4 pb-4 pt-1 pl-11">
                                <div className="flex-1 flex flex-col gap-1">
                                  <div className="flex justify-between items-center mb-0.5">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Opacity</span>
                                    <span className="text-[10px] font-mono font-bold text-slate-600">{(f.opacity !== undefined ? f.opacity : 1).toFixed(1)}</span>
                                  </div>
                                  <input 
                                    type="range" 
                                    min="0" 
                                    max="1" 
                                    step="0.1" 
                                    value={f.opacity !== undefined ? f.opacity : 1} 
                                    onChange={(e) => onUpdateFileOpacity(f.id, parseFloat(e.target.value))} 
                                    onMouseDown={() => setIsDraggingSlider(true)}
                                    onMouseUp={() => setIsDraggingSlider(false)}
                                    onTouchStart={() => setIsDraggingSlider(true)}
                                    onTouchEnd={() => setIsDraggingSlider(false)}
                                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-400" 
                                  />
                                </div>
                                <button 
                                  onClick={() => onUpdateFileOpacity(f.id, 1)}
                                  className="p-1 text-slate-300 hover:text-blue-500 transition-colors"
                                  title="Reset Opacity"
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-200/50 p-1 rounded-lg border border-slate-200">
              {[{ id: 'pan', icon: Move }, { id: 'select', icon: MousePointer2 }, { id: 'zoom', icon: ZoomIn }].map(item => (
                <button key={item.id} onClick={() => onModeChange(item.id as InteractionMode)} className={`p-1.5 rounded-md transition-all ${mode === item.id ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100' : 'text-slate-500 hover:bg-white/50'}`}>
                  <item.icon size={18} />
                </button>
              ))}
              <div className="w-px h-5 bg-slate-300 mx-1" />
              <button onClick={zoomOut} className="p-1.5 text-slate-500 hover:text-rose-500 hover:bg-white rounded-md transition-all"><RotateCcw size={18} /></button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDownloadSettings(!showDownloadSettings)} className="p-2 bg-white text-slate-500 rounded-lg border hover:text-slate-800 transition-all shadow-sm"><Settings2 size={18} /></button>
              <button onClick={handleDownloadChart} disabled={isDownloading || isBulkDownloading} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-300 font-bold text-xs flex items-center gap-2 shadow-sm">
                <Download size={16} /><span>{isDownloading ? '...' : 'Download'}</span>
              </button>
              {files.length > 1 && (
                <button
                  onClick={handleBulkDownload}
                  disabled={isDownloading || isBulkDownloading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:bg-slate-300 font-bold text-xs flex items-center gap-2 shadow-sm"
                  title={`모든 파일 일괄 다운로드 (${files.length}개)`}
                >
                  <Download size={16} />
                  <span>{isBulkDownloading ? `${bulkProgress?.current}/${bulkProgress?.total}` : `All (${files.length})`}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-1">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
              {/* X-Shift */}
              <div className="flex items-center gap-3 pr-2">
                <div className="flex items-center gap-2"><Move size={14} className="text-blue-600" /><span className="text-[10px] font-black text-slate-800 uppercase tracking-widest whitespace-nowrap">X-SHIFT</span></div>
                <input 
                  type="range" 
                  min="-0.5" max="0.5" step="0.005" 
                  value={twoThetaShift} 
                  onChange={(e) => onUpdateShift(parseFloat(e.target.value))} 
                  onMouseDown={() => setIsDraggingSlider(true)}
                  onMouseUp={() => setIsDraggingSlider(false)}
                  onTouchStart={() => setIsDraggingSlider(true)}
                  onTouchEnd={() => setIsDraggingSlider(false)}
                  className="w-32 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600" 
                />
                <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-0.5 rounded border">
                  <input type="number" step="0.001" value={twoThetaShift} onChange={(e) => onUpdateShift(parseFloat(e.target.value) || 0)} className="w-12 bg-transparent text-xs font-mono font-bold text-blue-700 focus:outline-none text-center" />
                  <span className="text-[10px] font-black text-slate-300">2θ</span>
                </div>
              </div>
              <button onClick={() => onUpdateShift(0)} className="border-l border-slate-100 pl-4 py-1 text-[9px] font-black text-slate-400 hover:text-blue-600 transition-all">RESET</button>
            </div>

            <button
              onClick={() => setIsRawMode(!isRawMode)}
              className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 transition-all shadow-sm ${isRawMode ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
              title={isRawMode ? "Switch to Performance Mode (1/2 Sampled)" : "Switch to Raw Data Mode (Full Resolution)"}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isRawMode ? 'bg-white animate-pulse' : 'bg-slate-300'}`} />
              <span className="text-[10px] font-black uppercase tracking-widest leading-none">Raw: {isRawMode ? 'ON' : 'OFF'}</span>
            </button>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-bold uppercase tracking-tight">
            <span>Z Zoom</span><span className="w-1 h-1 rounded-full bg-slate-300" /><span>Double-Click Reset</span>
          </div>
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className={`flex-1 min-h-[500px] w-full relative select-none touch-none ${getCursorStyle()} outline-none bg-white rounded-xl border border-slate-200 shadow-inner overflow-visible`}
        onDoubleClick={zoomOut}
      >
        <div className="absolute inset-0 outline-none overflow-visible">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <LineChart
              data={activeDisplayData}
              margin={{ top: 40, right: 30, left: 20, bottom: 40 }}
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
                label={{ value: '2-Theta (degrees)', position: 'insideBottom', offset: 0, style: { fill: '#64748b', fontSize: isCapturing ? parseInt(downloadFontSize) : 14, fontWeight: 400 } }}
                tick={{ fontSize: isCapturing ? Math.round(parseInt(downloadFontSize) * 0.85) : 12, fill: '#64748b' }}
                tickFormatter={v => v.toFixed(0)}
              />
              <YAxis
                domain={[0, 100]}
                allowDataOverflow
                ticks={yTicks}
                label={{ value: 'Intensity (a.u.)', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#64748b', fontSize: isCapturing ? parseInt(downloadFontSize) : 14, fontWeight: 400 } }}
                tick={{ fontSize: isCapturing ? Math.round(parseInt(downloadFontSize) * 0.85) : 12, fill: '#64748b' }}
                tickFormatter={v => (typeof v === 'number' ? v.toFixed(0) : v)}
              />
              {(!isPanning && !isDraggingSlider) && (
                <Tooltip
                  offset={-80} // Position above cursor
                  cursor={mode === 'pan' ? false : { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    // Only show the first (primary) payload item to keep it simple
                    const item = payload[0];
                    return (
                      <div className="bg-white border border-slate-200 p-1.5 rounded shadow-lg text-[10px] text-slate-700 flex flex-col gap-0.5 pointer-events-none">
                        <div className="font-bold border-b border-slate-100 pb-0.5 mb-0.5">
                          2θ: {Number(label).toFixed(3)}°
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                          <span>Intensity: <strong>{Number(item.value).toFixed(2)}</strong></span>
                        </div>
                      </div>
                    );
                  }}
                  shared={false} // Disable shared to only show one point at a time
                />
              )}
              {!isOverlapMode && (
                <Line type="monotone" dataKey="intensity" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              )}
              {isOverlapMode && overlapDatasets.map((ds) => {
                const f = files.find(file => file.id === ds.id);
                return (
                  <Line
                    key={ds.id}
                    data={ds.data}
                    type="monotone"
                    dataKey="intensity"
                    name={ds.name}
                    stroke={getFileColor(files.findIndex(f => f.id === ds.id))}
                    strokeWidth={2}
                    strokeOpacity={f?.opacity !== undefined ? f.opacity : 1}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    shapeRendering="optimizeSpeed"
                  />
                );
              })}
              {isOverlapMode && <Legend verticalAlign="top" height={36}/>}
              {!isDraggingSlider && visibleReferenceMaterials.map((matId, index) => (allMaterialDefinitions[matId] || []).map((def, pIdx) => (
                <ReferenceLine key={`${matId}-${pIdx}`} x={def.theoreticalPos || 0} stroke={getMaterialColor(index)} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: def.plane ? `(${def.plane})` : '', position: 'top', fill: getMaterialColor(index), fontSize: 10, opacity: 0.8 }} />
              )))}
              {/* Peak range overlays */}
              {!isDraggingSlider && peakDefinitions.map(def => {
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
              {(!isDraggingSlider && selectedCnTwoTheta !== null) && <ReferenceLine x={selectedCnTwoTheta} stroke="#10b981" strokeWidth={3} label={{ value: `Selected: ${selectedCnTwoTheta.toFixed(2)}°`, position: 'top', fill: '#10b981', fontSize: 12, fontWeight: 'bold' }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {isCapturing && (
        <div className="capture-overlay fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[99999]">
          <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center min-w-[280px]">
            <Download className={`mb-4 animate-bounce ${isBulkDownloading ? 'text-emerald-600' : 'text-blue-600'}`} size={32} />
            {isBulkDownloading && bulkProgress ? (
              <>
                <h3 className="text-xl font-bold mb-2">일괄 다운로드 중...</h3>
                <p className="text-slate-500 text-sm mb-4">{bulkProgress.current} / {bulkProgress.total} 파일</p>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-2">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</p>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold mb-2">고해상도 최적화 중...</h3>
                <p className="text-slate-500 text-sm mb-6">{downloadWidth}x{downloadHeight} 렌더링 중</p>
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"><div className="bg-blue-600 h-full w-1/2 animate-shimmer"></div></div>
              </>
            )}
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
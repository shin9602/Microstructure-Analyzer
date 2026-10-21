import React, { useState, useEffect, useRef } from 'react';
import { Play, FileText, Loader2, Home, UploadCloud, Trash2, XCircle, Activity } from 'lucide-react';
import ResultsDashboard, { type AnalysisResult } from './ResultsDashboard';

interface LogMessage {
  type: 'info' | 'error' | 'success' | 'log' | 'warning';
  message: string;
}

interface EBSDAppProps {
  onBack?: () => void;
}

const isEbsdInputFile = (name: string) => {
  const n = name.toLowerCase();
  return n.endsWith('.ang') || n.endsWith('.osc');
};

/** Co wt% map keys must match analyzed .ang basenames (OSC is converted on upload). */
const remapCompMapKeys = (configs: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(configs)) {
    const key = k.toLowerCase().endsWith('.osc') ? k.replace(/\.osc$/i, '.ang') : k;
    out[key] = v;
  }
  return out;
};

const EBSDApp: React.FC<EBSDAppProps> = ({ onBack }) => {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileConfigs, setFileConfigs] = useState<Record<string, number>>({});
  const [compositionMode, setCompositionMode] = useState(true);
  const [coWt, setCoWt] = useState(9.0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const uploadAbort = useRef<AbortController | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  useEffect(() => () => { uploadAbort.current?.abort(); streamRef.current?.close(); }, []);

  const stopAnalysis = () => {
    uploadAbort.current?.abort();
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    setIsProcessing(false);
    setLogs(prev => [...prev, { type: 'error', message: 'Analysis stopped by user.' }]);
  };

  const runAnalysis = async () => {
    if (isProcessing) return;
    
    if (compositionMode && [coWt, ...Object.values(fileConfigs)].some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
      setLogs([{ type: 'error', message: 'Co wt%는 0~100 사이로 입력하세요.' }]); return;
    }
    const names = files.map(f => f.name.replace(/\.osc$/i, '.ang').toLowerCase());
    if (new Set(names).size !== names.length) { setLogs([{ type: 'error', message: '같은 이름의 ANG/OSC는 하나만 선택하세요.' }]); return; }
    const controller = new AbortController(); uploadAbort.current = controller;
    setLogs([]);
    setIsProcessing(true);
    setResults(null);
    setProgressStep('시작 중...');
    setProgressPct(0);
    
    let useTemp = false;
    try {
      if (files.length > 0) {
        useTemp = true;
        setLogs(prev => [...prev, { type: 'info', message: 'Preparing temporary context...' }]);
        
        const clearRes = await fetch('/api/clear-ebsd-temp', { signal: controller.signal });
        if (!clearRes.ok) throw new Error('Failed to clear temp directory');

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setLogs(prev => [...prev, { type: 'info', message: `Uploading ${file.name} (${i + 1}/${files.length})...` }]);
          const up = await fetch(`/api/upload-ebsd?filename=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            signal: controller.signal,
            body: file
          });
          const body = await up.json().catch(() => ({} as { success?: boolean; file?: string; convertedFrom?: string; error?: string }));
          if (!up.ok || body.success === false) {
            throw new Error(body.error || `Upload failed: ${file.name}`);
          }
          if (body.convertedFrom) {
            setLogs(prev => [...prev, { type: 'success', message: `Converted ${body.convertedFrom} → ${body.file}` }]);
          }
        }
      }

      setLogs(prev => [...prev, { type: 'info', message: 'Initializing EBSD Analysis...' }]);
      
      const params = new URLSearchParams();
      if (useTemp) params.append('temp', '1');
      if (compositionMode) {
        params.append('co_wt', coWt.toString());
        params.append('comp_map', JSON.stringify(remapCompMapKeys(fileConfigs)));
      }

      const es = new EventSource(`/api/run-ebsd?${params.toString()}`);
      setEventSource(es);
      streamRef.current = es;

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'progress') {
          setProgressStep(data.message); setProgressPct(data.percent);
        } else if (data.type === 'log') {
          setLogs(prev => [...prev, { type: 'log', message: data.message }]);
        } else if (data.type === 'info') {
          setLogs(prev => [...prev, { type: 'info', message: data.message }]);
        } else if (data.type === 'warning') {
          setLogs(prev => [...prev, { type: 'warning', message: data.message }]);
        } else if (data.type === 'error') {
          setLogs(prev => [...prev, { type: 'error', message: data.message }]);
        } else if (data.type === 'done') {
          es.close();
          setEventSource(null);
          setIsProcessing(false);
          if (data.code !== 0) {
            setLogs(prev => [...prev, { type: 'error', message: `Process exited with code ${data.code}` }]);
            setProgressStep('오류 발생'); setProgressPct(0);
          } else {
            setLogs(prev => [...prev, { type: 'success', message: 'Analysis completed successfully!' }]);
            setProgressStep('완료'); setProgressPct(100);
          }
        } else if (data.type === 'result_pack') {
          setResults(data);
        }
      };

      es.onerror = (err) => {
        console.error('EventSource failed:', err);
        es.close();
        setEventSource(null);
        setIsProcessing(false);
        setLogs(prev => [...prev, { type: 'error', message: 'Connection lost or server error.' }]);
      };
    } catch (error: unknown) {
      if (!controller.signal.aborted) setLogs(prev => [...prev, { type: 'error', message: `Failed: ${error instanceof Error ? error.message : String(error)}` }]);
      setIsProcessing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (isProcessing) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(f => isEbsdInputFile(f.name));
      if (droppedFiles.length > 0) {
        setFiles(prev => {
          const newFiles = [...prev];
          droppedFiles.forEach(df => {
            if (!newFiles.find(f => f.name === df.name)) {
              newFiles.push(df);
            }
          });
          return newFiles;
        });
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isProcessing) return;
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files).filter(f => isEbsdInputFile(f.name));
      setFiles(prev => {
        const newFiles = [...prev];
        selectedFiles.forEach(df => {
          if (!newFiles.find(f => f.name === df.name)) {
            newFiles.push(df);
          }
        });
        return newFiles;
      });
      e.target.value = '';
    }
  };

  const setFileCoWt = (name: string, val: number) => {
    setFileConfigs(prev => ({ ...prev, [name]: val }));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && !isProcessing && <div className="fixed inset-3 z-50 rounded-3xl border-2 border-dashed border-teal-500 bg-teal-50/95 grid place-items-center pointer-events-none"><div className="text-center"><UploadCloud size={52} className="mx-auto text-teal-700 mb-4" /><p className="font-bold text-xl">분석할 ANG · OSC 파일을 놓으세요</p></div></div>}
      <header className="bg-white border-b border-slate-200 px-6 lg:px-10 py-5 flex justify-between items-center gap-4">
        <div className="flex items-center gap-4"><div className="bg-teal-700 text-white p-3 rounded-2xl"><Activity size={24} /></div><div><p className="text-[10px] tracking-[0.22em] font-bold text-teal-700 mb-1">MICROSTRUCTURE LABORATORY</p><h1 className="text-xl font-bold tracking-tight">EBSD 통합 분석</h1></div></div>
        {onBack && <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-500 hover:text-teal-700"><Home size={16} />홈으로</button>}
      </header>
      <main className="max-w-[1600px] mx-auto p-5 lg:p-8 grid grid-cols-1 xl:grid-cols-[310px_minmax(0,1fr)] gap-6 items-start">
        <aside className="space-y-4 xl:sticky xl:top-6">
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h2 className="font-bold text-sm flex items-center gap-2 mb-4"><UploadCloud size={18} className="text-teal-600" />분석 데이터 <span className="ml-auto text-xs font-normal text-slate-400">{files.length}개</span></h2>
            <label className={`block border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 px-4 py-6 text-center ${isProcessing ? 'opacity-50' : 'cursor-pointer hover:border-teal-400'}`}><UploadCloud size={26} className="mx-auto text-slate-400 mb-2" /><span className="block text-sm font-semibold">파일 선택 또는 드래그</span><span className="text-xs text-slate-400">.ang / .osc · 여러 파일 지원</span><input aria-label="EBSD 파일 선택" type="file" multiple accept=".ang,.osc" disabled={isProcessing} className="hidden" onChange={handleFileSelect} /></label>
            <div className="mt-3 space-y-2 max-h-72 overflow-auto">{files.map(file => <div key={file.name} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center gap-2"><FileText size={14} className="shrink-0 text-teal-600" /><span title={file.name} className="truncate flex-1 text-xs font-semibold">{file.name}</span><button disabled={isProcessing} aria-label={`${file.name} 삭제`} onClick={() => { setFiles(prev => prev.filter(f => f.name !== file.name)); setFileConfigs(prev => { const next = { ...prev }; delete next[file.name]; return next; }); }} className="text-slate-400 hover:text-red-500 disabled:opacity-30"><Trash2 size={14} /></button></div>{compositionMode && <label className="flex items-center justify-between text-xs text-slate-500 mt-2">Co 중량%<input type="number" min="0" max="100" step="0.1" disabled={isProcessing} value={fileConfigs[file.name] ?? coWt} onChange={e => setFileCoWt(file.name, Number(e.target.value))} className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-right" /></label>}</div>)}</div>
            {!files.length && <p className="mt-3 text-xs text-slate-400 leading-relaxed">파일 없이 실행하면 분석할 폴더를 선택할 수 있습니다.</p>}
          </section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-bold text-sm">Co 측정 방식</h2><label className="flex justify-between items-center text-sm">Co 조성 입력<input type="checkbox" disabled={isProcessing} checked={compositionMode} onChange={e => setCompositionMode(e.target.checked)} className="w-4 h-4 accent-teal-700" /></label>
            {compositionMode && <label className="flex justify-between items-center text-xs text-slate-500">기본 Co 중량%<input type="number" min="0" max="100" step="0.1" disabled={isProcessing} value={coWt} onChange={e => setCoWt(Number(e.target.value))} className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-right font-bold text-slate-700" /></label>}
            <button onClick={runAnalysis} disabled={isProcessing} className="w-full py-3 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white rounded-xl font-bold flex justify-center items-center gap-2">{isProcessing ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}{isProcessing ? '분석 진행 중' : '전체 분석 실행'}</button>
            {isProcessing && <button onClick={stopAnalysis} className="w-full text-red-600 text-xs flex items-center justify-center gap-2"><XCircle size={14} />분석 중지</button>}
            <p className="text-center text-[10px] text-slate-400">상 분율 · 입도 · 연결도 · 형상 · 방위를 한 번에</p>
          </section>
          {(isProcessing || progressPct === 100) && <section className="rounded-2xl bg-teal-50 border border-teal-100 p-4"><p className="text-xs text-teal-800 font-semibold mb-3 break-all">{progressStep}</p><div className="bg-teal-100 h-1.5 rounded-full overflow-hidden"><div className="bg-teal-600 h-full transition-all" style={{ width: `${progressPct}%` }} /></div></section>}
        </aside>
        <div className="space-y-5 min-w-0">
          {results ? <ResultsDashboard results={results} /> : <section className="min-h-[480px] rounded-3xl bg-white border border-slate-200 flex items-center justify-center p-8 text-center"><div className="max-w-md"><div className="mx-auto mb-6 bg-teal-50 rounded-3xl w-20 h-20 grid place-items-center"><Activity size={38} className="text-teal-600" /></div><p className="text-[10px] tracking-[0.25em] text-teal-700 font-bold mb-3">ONE RUN · COMPLETE PICTURE</p><h2 className="font-bold text-2xl tracking-tight mb-3">조직의 전체 모습을 한눈에</h2><p className="text-sm text-slate-400 leading-7">파일과 Co 조성을 설정하고 전체 분석을 실행하세요.<br />상 분율부터 입도, 형상, 결정 방위까지<br />시료별로 정리된 결과를 확인할 수 있습니다.</p>{isProcessing && <p className="text-xs text-teal-700 mt-6">{progressStep}</p>}</div></section>}
          <details className="bg-white rounded-2xl border border-slate-200 overflow-hidden" open={logs.some(log => log.type === 'error') || undefined}><summary className="px-5 py-4 text-xs font-semibold text-slate-500 cursor-pointer">실행 기록 · {logs.length}건 {logs.some(log => log.type === 'error') && '· 오류 있음'}</summary><div className="bg-slate-900 p-5 max-h-80 overflow-auto font-mono text-[11px] leading-6">{logs.length ? logs.map((log, i) => <p key={i} className={`whitespace-pre-wrap break-all ${log.type === 'error' ? 'text-red-300' : log.type === 'warning' ? 'text-amber-200' : log.type === 'success' ? 'text-teal-300' : 'text-slate-400'}`}>{log.message}</p>) : <p className="text-slate-500">실행 기록이 여기에 표시됩니다.</p>}</div></details>
        </div>
      </main>
      <footer className="pb-4 text-center text-[10px] text-slate-400">Copy right CVD개발팀 SHT</footer>
    </div>
  );
};

export default EBSDApp;

import React, { useState, useEffect, useRef } from 'react';
import { Play, FileText, Loader2, Home, UploadCloud, Trash2, XCircle, Activity } from 'lucide-react';
import ResultsDashboard, { type AnalysisResult } from './ResultsDashboard';
import EtaMaskEditor, { type EtaSelection, type EtaPreview } from './EtaMaskEditor';
import { readSourcePhases, type SourcePhase, type PhaseRole } from './phaseMetadata';

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
    const key = k.replace(/\.(osc|ang)$/i, '.ang');
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
  const [gammaMode, setGammaMode] = useState<'all_other' | 'named' | 'manual'>('all_other');
  const [etaMode, setEtaMode] = useState(false);
  const [etaBasis, setEtaBasis] = useState<'remaining' | 'total'>('remaining');
  const [phaseHeaders, setPhaseHeaders] = useState<Record<string, SourcePhase[]>>({});
  const [phaseMaps, setPhaseMaps] = useState<Record<string, Record<string, PhaseRole>>>({});
  const [phaseErrors, setPhaseErrors] = useState<Record<string, string>>({});
  const [etaSelections, setEtaSelections] = useState<Record<string, EtaSelection & { selectedCount: number; validCount: number; applied: boolean }>>({});
  const [editorFile, setEditorFile] = useState<string | null>(null);
  const [preparingFile, setPreparingFile] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const uploadAbort = useRef<AbortController | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const uploadSession = useRef<string | null>(null);
  const uploadedKey = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    for (const file of files) {
      void readSourcePhases(file).then(phases => {
        if (cancelled) return;
        setPhaseHeaders(previous => ({ ...previous, [file.name]: phases }));
        setPhaseMaps(previous => ({ ...previous, [file.name]: previous[file.name] || Object.fromEntries(phases.map(phase => [String(phase.id), phase.suggested])) }));
        setPhaseErrors(previous => { const next = { ...previous }; delete next[file.name]; return next; });
      }).catch(error => { if (!cancelled) setPhaseErrors(previous => ({ ...previous, [file.name]: String(error.message || error) })); });
    }
    return () => { cancelled = true; };
  }, [files]);
  useEffect(() => () => { uploadAbort.current?.abort(); streamRef.current?.close(); }, []);

  const stopAnalysis = () => {
    uploadAbort.current?.abort();
    uploadSession.current = null; uploadedKey.current = null;
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    setIsProcessing(false);
    setLogs(prev => [...prev, { type: 'error', message: 'Analysis stopped by user.' }]);
  };

  const runAnalysis = async () => {
    if (isProcessing || preparingFile) return;
    if ((etaMode || gammaMode === 'manual') && !files.length) { setLogs([{ type: 'error', message: '에타/Phase 직접 지정 모드는 파일을 먼저 선택하세요.' }]); return; }
    if (etaMode && files.some(file => !etaSelections[file.name]?.applied)) { setLogs([{ type: 'error', message: '모든 파일의 에타 영역 선택을 완료하세요.' }]); return; }
    if (gammaMode === 'manual' && files.some(file => !phaseHeaders[file.name] || phaseErrors[file.name] || !Object.values(phaseMaps[file.name] || {}).includes('WC'))) { setLogs([{ type: 'error', message: 'Phase 정보를 확인하고 각 파일에 WC를 지정하세요.' }]); return; }
    if (compositionMode && gammaMode !== 'manual' && [coWt, ...Object.values(fileConfigs)].some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
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
    let session: string | null = null;
    try {
      if (files.length > 0) {
        useTemp = true;
        session = await ensureUploaded(controller.signal);
        if (etaMode) {
          for (const file of files) {
            const selection = etaSelections[file.name];
            const params = new URLSearchParams({ session, filename: file.name, width: String(selection.preview.width), height: String(selection.preview.height), source_sha256: selection.preview.source_sha256 });
            const response = await fetch(`/api/eta-mask?${params}`, { method: 'POST', body: selection.mask.slice().buffer as ArrayBuffer, signal: controller.signal });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || '에타 선택 영역 저장 실패');
          }
        }
      }

      setLogs(prev => [...prev, { type: 'info', message: 'Initializing EBSD Analysis...' }]);
      
      const params = new URLSearchParams();
      params.append('gamma_mode', gammaMode);
      params.append('analysis_options', JSON.stringify({ eta: { enabled: etaMode, co_basis: etaBasis }, phase_maps: gammaMode === 'manual' ? Object.fromEntries(files.map(file => [file.name.replace(/\.(osc|ang)$/i, '.ang'), phaseMaps[file.name]])) : {} }));
      if (useTemp && session) { params.append('temp', '1'); params.append('session', session); }
      if (compositionMode && gammaMode !== 'manual') {
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
          uploadSession.current = null; uploadedKey.current = null;
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
        uploadSession.current = null; uploadedKey.current = null;
        es.close();
        setEventSource(null);
        setIsProcessing(false);
        setLogs(prev => [...prev, { type: 'error', message: 'Connection lost or server error.' }]);
      };
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        const detail = error instanceof TypeError && /fetch/i.test(error.message)
          ? '서버와 연결이 끊겼습니다. 프로그램 실행 창을 확인하고 파일을 다시 선택해 주세요.'
          : error instanceof Error ? error.message : String(error);
        setLogs(prev => [...prev, { type: 'error', message: `실패: ${detail}` }]);
      }
      setIsProcessing(false);
    }
  };

  const ensureUploaded = async (signal: AbortSignal): Promise<string> => {
    const normalized = files.map(file => file.name.replace(/\.osc$/i, '.ang').toLowerCase());
    if (new Set(normalized).size !== normalized.length) throw new Error('같은 이름의 ANG/OSC는 하나만 선택하세요.');
    const key = JSON.stringify(files.map(file => [file.name, file.size, file.lastModified]));
    if (uploadSession.current && uploadedKey.current === key) return uploadSession.current;
    const previous = uploadSession.current ? `?previous_session=${encodeURIComponent(uploadSession.current)}` : '';
    const response = await fetch(`/api/clear-ebsd-temp${previous}`, { signal });
    const prepared = await response.json();
    if (!response.ok || !prepared.session) throw new Error(prepared.error || '업로드 폴더 준비 실패');
    const session: string = prepared.session;
    uploadSession.current = session; uploadedKey.current = null;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setLogs(previous => [...previous, { type: 'info', message: `업로드 중: ${file.name} (${index + 1}/${files.length})...` }]);
      const upload = await fetch(`/api/upload-ebsd?session=${session}&filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, signal });
      const body = await upload.json();
      if (!upload.ok || !body.success) throw new Error(body.error || '업로드 실패');
    }
    uploadedKey.current = key; return session;
  };

  const prepareEditor = async (file: File) => {
    if (isProcessing || preparingFile) return;
    if (etaSelections[file.name]) { setEditorFile(file.name); return; }
    setPreparingFile(file.name);
    const controller = new AbortController(); uploadAbort.current = controller;
    try {
      setLogs(previous => [...previous, { type: 'info', message: `${file.name} · 에타 편집용 IQ 맵 준비 중...` }]);
      const session = await ensureUploaded(controller.signal);
      const response = await fetch(`/api/prepare-ebsd?session=${session}&filename=${encodeURIComponent(file.name)}`, { signal: controller.signal });
      const descriptor = await response.json();
      if (!response.ok) throw new Error(descriptor.error || 'IQ 맵 준비 실패');
      const responses = await Promise.all([descriptor.iq, descriptor.valid].map((path: string) => fetch(`/api/ebsd-results/${encodeURIComponent(path)}`, { signal: controller.signal })));
      if (responses.some(item => !item.ok)) throw new Error('IQ 맵 데이터를 읽지 못했습니다.');
      const buffers = await Promise.all(responses.map(item => item.arrayBuffer()));
      const preview: EtaPreview = { ...descriptor, iq: new Float32Array(buffers[0]), valid: new Uint8Array(buffers[1]) };
      const size = preview.width * preview.height;
      if (preview.iq.length !== size || preview.valid.length !== size) throw new Error('IQ 맵 격자가 일치하지 않습니다.');
      setEtaSelections(previous => ({ ...previous, [file.name]: { preview, mask: new Uint8Array(size), selectedCount: 0, applied: false, validCount: preview.valid.reduce((sum, value) => sum + (value ? 1 : 0), 0) } }));
      setEditorFile(file.name);
    } catch (error) {
      setLogs(previous => [...previous, { type: 'error', message: error instanceof Error ? error.message : String(error) }]);
    } finally { setPreparingFile(null); }
  };

  const removeFile = (name: string) => {
    uploadedKey.current = null;
    setFiles(previous => previous.filter(file => file.name !== name));
    setFileConfigs(previous => { const next = { ...previous }; delete next[name]; return next; });
    setPhaseMaps(previous => { const next = { ...previous }; delete next[name]; return next; });
    setPhaseHeaders(previous => { const next = { ...previous }; delete next[name]; return next; });
    setEtaSelections(previous => { const next = { ...previous }; delete next[name]; return next; });
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
    
    if (isProcessing || preparingFile) return;
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
    if (isProcessing || preparingFile) return;
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
            <label className={`block border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 px-4 py-6 text-center ${isProcessing ? 'opacity-50' : 'cursor-pointer hover:border-teal-400'}`}><UploadCloud size={26} className="mx-auto text-slate-400 mb-2" /><span className="block text-sm font-semibold">파일 선택 또는 드래그</span><span className="text-xs text-slate-400">.ang / .osc · 여러 파일 지원</span><input aria-label="EBSD 파일 선택" type="file" multiple accept=".ang,.osc" disabled={isProcessing || !!preparingFile} className="hidden" onChange={handleFileSelect} /></label>
            <div className="mt-3 space-y-2 max-h-72 overflow-auto">{files.map(file => <div key={file.name} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center gap-2"><FileText size={14} className="shrink-0 text-teal-600" /><span title={file.name} className="truncate flex-1 text-xs font-semibold">{file.name}</span><button disabled={isProcessing || !!preparingFile} aria-label={`${file.name} 삭제`} onClick={() => removeFile(file.name)} className="text-slate-400 hover:text-red-500 disabled:opacity-30"><Trash2 size={14} /></button></div>{compositionMode && gammaMode !== 'manual' && <label className="flex items-center justify-between text-xs text-slate-500 mt-2">Co 중량%<input type="number" min="0" max="100" step="0.1" disabled={isProcessing || !!preparingFile} value={fileConfigs[file.name] ?? coWt} onChange={e => setFileCoWt(file.name, Number(e.target.value))} className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-right" /></label>}{gammaMode === 'manual' && <div className="mt-3 space-y-2">{phaseErrors[file.name] ? <p className="text-xs text-red-600">{phaseErrors[file.name]}</p> : phaseHeaders[file.name] ? phaseHeaders[file.name].map(phase => <label key={phase.id} className="block text-[11px] text-slate-500"><span className="block break-words mb-1">Phase {phase.id} · {phase.name || '이름 없음'} · 대칭 {phase.symmetry || '미상'}</span><select aria-label={`${file.name} Phase ${phase.id} 지정`} disabled={isProcessing || !!preparingFile} value={phaseMaps[file.name]?.[phase.id] || phase.suggested} onChange={event => setPhaseMaps(previous => ({ ...previous, [file.name]: { ...previous[file.name], [phase.id]: event.target.value as PhaseRole } }))} className="w-full border rounded-lg p-2 bg-white">{[['WC','WC'],['Co','Co'],['Gamma','gamma'],['Eta','에타'],['Exclude','분석 제외']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>) : <p className="text-xs">Phase 헤더를 읽는 중...</p>}</div>}{etaMode && <button onClick={() => prepareEditor(file)} disabled={isProcessing || !!preparingFile} className="mt-3 w-full rounded-lg border border-purple-200 bg-purple-50 p-2 text-xs font-bold text-purple-800 disabled:opacity-40">{preparingFile === file.name ? 'IQ 맵 준비 중...' : etaSelections[file.name] ? `에타 영역 편집 · ${(etaSelections[file.name].selectedCount / Math.max(1,etaSelections[file.name].validCount)*100).toFixed(3)} Area%` : '에타 영역 선택'}</button>}</div>)}</div>
            {!files.length && <p className="mt-3 text-xs text-slate-400 leading-relaxed">파일 없이 실행하면 분석할 폴더를 선택할 수 있습니다.</p>}
          </section>
          <section className="bg-white border border-purple-100 rounded-2xl p-5 shadow-sm space-y-3"><label className="flex justify-between font-bold text-sm">에타 영역 선택 모드<input aria-label="에타 영역 선택 모드" type="checkbox" checked={etaMode} disabled={isProcessing || !!preparingFile} onChange={event => setEtaMode(event.target.checked)} className="accent-purple-700 w-4 h-4" /></label><p className="text-xs text-slate-500 leading-relaxed">IQ 맵에서 스마트 선택·브러시로 에타 영역을 지정합니다. 선택 영역은 다른 상의 측정에서 제외합니다.</p>{etaMode && <label className="block text-xs text-slate-500">Co wt% 적용 기준<select aria-label="에타 제외 후 Co 함량 기준" value={etaBasis} disabled={isProcessing || !!preparingFile} onChange={event => setEtaBasis(event.target.value === 'total' ? 'total' : 'remaining')} className="mt-1 w-full p-2 border rounded-lg bg-white"><option value="remaining">에타·제외 영역을 뺀 나머지</option><option value="total">에타를 포함한 전체 시료</option></select></label>}</section>
          <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h2 className="font-bold text-sm">Co 측정 방식</h2><label className="flex justify-between items-center text-sm">Co 조성 입력<input type="checkbox" disabled={isProcessing || !!preparingFile || gammaMode === 'manual'} checked={compositionMode && gammaMode !== 'manual'} onChange={e => setCompositionMode(e.target.checked)} className="w-4 h-4 accent-teal-700" /></label>
            {compositionMode && gammaMode !== 'manual' && <label className="flex justify-between items-center text-xs text-slate-500">기본 Co 중량%<input type="number" min="0" max="100" step="0.1" disabled={isProcessing || !!preparingFile} value={coWt} onChange={e => setCoWt(Number(e.target.value))} className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-right font-bold text-slate-700" /></label>}
            <div className="border-t border-slate-100 pt-4 space-y-2"><label htmlFor="gamma-mode" className="block font-bold text-sm">상 분류 방식</label><select id="gamma-mode" disabled={isProcessing || !!preparingFile} value={gammaMode} onChange={e => setGammaMode(e.target.value === 'manual' ? 'manual' : e.target.value === 'named' ? 'named' : 'all_other')} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-xs bg-white disabled:opacity-50"><option value="all_other">전체 IQ로 Co 먼저 측정 (기본)</option><option value="named">상 이름 기준 (기존)</option><option value="manual">Phase 직접 지정</option></select><p className="text-[11px] text-slate-400 leading-relaxed">{gammaMode === 'all_other' ? '전체 영역에서 낮은 IQ부터 Co를 배정하고, 남은 점을 WC와 gamma상으로 구분합니다. 결과 비율은 전체 유효 면적 기준 Area%입니다.' : gammaMode === 'manual' ? '파일별 Phase를 직접 지정합니다. 지정한 상은 IQ로 재분류하지 않으며 Co wt% 입력을 적용하지 않습니다.' : '상 이름으로 gamma상을 판별하고 원본 상 구분을 유지합니다.'}</p></div>
            <button onClick={runAnalysis} disabled={isProcessing || !!preparingFile} className="w-full py-3 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white rounded-xl font-bold flex justify-center items-center gap-2">{isProcessing ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}{isProcessing ? '분석 진행 중' : '전체 분석 실행'}</button>
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
      {editorFile && etaSelections[editorFile] && <EtaMaskEditor name={editorFile} selection={etaSelections[editorFile]} onClose={() => setEditorFile(null)} onApply={mask => { setEtaSelections(previous => ({ ...previous, [editorFile]: { ...previous[editorFile], mask, applied: true, selectedCount: mask.reduce((sum,value) => sum + value, 0) } })); setEditorFile(null); }} />}
      <footer className="pb-4 text-center text-[10px] text-slate-400">Copy right CVD개발팀 SHT</footer>
    </div>
  );
};

export default EBSDApp;

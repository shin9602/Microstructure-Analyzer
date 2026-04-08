import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, FileText, Loader2, AlertCircle, CheckCircle2, Home, 
  UploadCloud, Trash2, Download, Image as ImageIcon, 
  ChevronRight, Settings2, BarChart3, Gauge, Zap, XCircle 
} from 'lucide-react';

interface LogMessage {
  type: 'info' | 'error' | 'success' | 'log' | 'warning';
  message: string;
}

// Progress steps for advanced analysis
const PROGRESS_STEPS = [
  { key: 'load',     label: '데이터 로드',       pct: 10 },
  { key: 'preproc',  label: '전처리/위상 재정의', pct: 25 },
  { key: 'grain',    label: '결정 입자 분석',    pct: 45 },
  { key: 'edge',     label: '외곽 입자 제외',    pct: 60 },
  { key: 'sigma',    label: 'Sigma-2 계산',      pct: 70 },
  { key: 'mrd',      label: 'MRD 정량화',        pct: 82 },
  { key: 'maps',     label: '이미지 생성',        pct: 92 },
  { key: 'done',     label: '완료',              pct: 100 },
];

const PROGRESS_KEYWORDS: Record<string, string> = {
  '데이터 불러오는': 'load',
  '전처리 및 위상':  'preproc',
  'WC 결정 입자 분석': 'grain',
  '외곽 입자 제외':  'edge',
  'Sigma 2':         'sigma',
  'MRD 정량화':      'mrd',
  '이미지 및 그래프': 'maps',
  'completed successfully': 'done',
};

interface EBSDAppProps {
  onBack?: () => void;
}

interface AnalysisResult {
  mode: 'basic' | 'advanced';
  csv: string;
  txt: string;
  images: string[];
}

const EBSDApp: React.FC<EBSDAppProps> = ({ onBack }) => {
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [results, setResults] = useState<AnalysisResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileConfigs, setFileConfigs] = useState<Record<string, number>>({});
  const [compositionMode, setCompositionMode] = useState(true);
  const [coWt, setCoWt] = useState(9.0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const stopAnalysis = () => {
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    setIsProcessing(false);
    setLogs(prev => [...prev, { type: 'error', message: 'Analysis stopped by user.' }]);
  };

  const runAnalysis = async (mode: 'basic' | 'advanced') => {
    if (isProcessing) return;
    
    setLogs([]);
    setIsProcessing(true);
    setResults(null);
    setProgressStep('시작 중...');
    setProgressPct(0);
    
    let useTemp = false;
    if (files.length > 0) {
      useTemp = true;
      setLogs(prev => [...prev, { type: 'info', message: 'Preparing temporary context...' }]);
      
      const clearRes = await fetch('/api/clear-ebsd-temp');
      if (!clearRes.ok) throw new Error('Failed to clear temp directory');

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setLogs(prev => [...prev, { type: 'info', message: `Uploading ${file.name} (${i + 1}/${files.length})...` }]);
        await fetch(`/api/upload-ebsd?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file
        });
      }
    }

    try {
      setLogs(prev => [...prev, { type: 'info', message: 'Initializing EBSD Analysis...' }]);
      
      const params = new URLSearchParams();
      if (mode === 'advanced') params.append('advanced', '1');
      if (useTemp) params.append('temp', '1');
      if (compositionMode) {
        params.append('co_wt', coWt.toString());
        params.append('comp_map', JSON.stringify(fileConfigs));
      }

      const es = new EventSource(`/api/run-ebsd?${params.toString()}`);
      setEventSource(es);

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // Parse progress keywords from log messages
        const detectProgress = (msg: string) => {
          for (const [kw, key] of Object.entries(PROGRESS_KEYWORDS)) {
            if (msg.includes(kw)) {
              const step = PROGRESS_STEPS.find(s => s.key === key);
              if (step) { setProgressStep(step.label); setProgressPct(step.pct); }
              break;
            }
          }
        };

        if (data.type === 'log') {
          detectProgress(data.message);
          setLogs(prev => [...prev, { type: 'log', message: data.message }]);
        } else if (data.type === 'info') {
          detectProgress(data.message);
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
    } catch (error: any) {
      setLogs(prev => [...prev, { type: 'error', message: `Failed to connect: ${error.message}` }]);
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.ang'));
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
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.ang'));
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
    <div 
      className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag Overlay */}
      {isDragging && (
          <div className="fixed inset-0 z-50 bg-blue-500/10 backdrop-blur-sm border-4 border-dashed border-blue-500 rounded-xl flex items-center justify-center m-6 pointer-events-none">
              <div className="bg-white p-8 rounded-2xl shadow-xl text-center transform scale-110 transition-transform">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <UploadCloud size={40} className="text-blue-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2">Drop .ang files here</h2>
                  <p className="text-slate-500">Release to add them to your analysis queue</p>
              </div>
          </div>
      )}

      <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-3rem)]">
        <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-amber-100 p-2 rounded-lg text-amber-600">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">EBSD Analysis (.ang Microstructure Analysis)</h2>
              <p className="text-sm text-slate-500 font-medium">Analyze .ang files directly from your PC</p>
            </div>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-colors flex items-center gap-2 font-medium text-sm"
              title="Back to Launcher"
            >
              <Home size={18} />
              Home
            </button>
          )}
        </div>
        
        <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
          
          {/* File Upload Zone */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <UploadCloud size={18} className="text-blue-500" />
                Input Data ({files.length} files)
              </h3>
              <div>
                <input 
                  type="file" 
                  id="ebsd-file-upload" 
                  multiple 
                  accept=".ang"
                  className="hidden" 
                  onChange={handleFileSelect}
                />
                <label 
                  htmlFor="ebsd-file-upload"
                  className="text-sm px-3 py-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer font-medium text-slate-600 transition-colors"
                >
                  Browse Files
                </label>
              </div>
            </div>
            
            {files.length > 0 ? (
              <div className="space-y-2 mt-2">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center gap-3 bg-white px-4 py-3 border border-slate-200 rounded-xl shadow-sm">
                    <div className="bg-slate-100 p-2 rounded-lg text-slate-500">
                        <FileText size={16} />
                    </div>
                    <span className="truncate flex-1 font-bold text-slate-700 text-sm">{file.name}</span>
                    
                    {compositionMode && (
                        <div className="flex items-center gap-2 bg-blue-50/50 px-3 py-1.5 rounded-lg border border-blue-100 animate-in fade-in slide-in-from-right-2">
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-tighter">Co wt%</span>
                            <input 
                                type="number"
                                step="0.1"
                                className="w-16 bg-white border border-blue-200 rounded px-2 py-0.5 text-xs font-bold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                value={fileConfigs[file.name] || coWt}
                                onChange={(e) => setFileCoWt(file.name, parseFloat(e.target.value) || 0)}
                            />
                        </div>
                    )}
                    
                    <button 
                      onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-lg bg-white">
                <p className="text-slate-500 text-sm">Drag & drop .ang files here, or click Browse.</p>
                <p className="text-slate-400 text-xs mt-1">If no files are added, it will launch the folder selection window.</p>
              </div>
            )}
          </div>
          
          {/* Analysis Settings */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <FileText size={18} className="text-amber-500" />
                Analysis Mode Settings
              </h3>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center bg-white p-4 rounded-lg border border-slate-200">
                <div className="flex items-center gap-3">
                    <div 
                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${compositionMode ? 'bg-blue-600' : 'bg-slate-300'}`}
                        onClick={() => setCompositionMode(!compositionMode)}
                    >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${compositionMode ? 'left-7' : 'left-1'}`} />
                    </div>
                    <span className="font-bold text-sm text-slate-800">Composition Mode (조성모드)</span>
                </div>
                
                {compositionMode && (
                    <div className="flex items-center gap-3 animate-fade-in">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Default Co wt%:</label>
                        <div className="flex items-center border border-slate-200 rounded-md overflow-hidden bg-slate-50">
                            <input 
                                type="number" 
                                value={coWt}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setCoWt(val);
                                }}
                                step="0.1"
                                className="w-20 px-3 py-1 text-sm font-bold bg-transparent focus:outline-none"
                            />
                            <span className="px-2 py-1 bg-slate-200 text-slate-600 text-xs font-bold border-l border-slate-300">%</span>
                        </div>
                    </div>
                )}
                
                {!compositionMode && (
                    <div className="text-xs text-slate-400 font-medium">
                        Standard Auto Thresholding (Otsu + Valley) enabled.
                    </div>
                )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 hover:border-blue-300 transition-colors">
              <h3 className="font-bold text-slate-800 mb-2">Basic Analysis</h3>
              <p className="text-sm text-slate-600 mb-4 h-16">Standard phase fractions, grain size, contiguity, and mean free path calculation.</p>
              <button
                  onClick={() => runAnalysis('basic')}
                  disabled={isProcessing}
                  className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                    isProcessing 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  }`}
                >
                  <Play size={20} />
                  Run Basic Analysis
                </button>
            </div>
            
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 hover:border-amber-300 transition-colors">
              <h3 className="font-bold text-slate-800 mb-2">Advanced Analysis (WC specific)</h3>
              <p className="text-sm text-slate-600 mb-4 h-16">Orix IPF Maps, Ellipticity, Circularity, and Sigma-2 grain boundary detection.</p>
              <button
                  onClick={() => runAnalysis('advanced')}
                  disabled={isProcessing}
                  className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                    isProcessing 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                  }`}
                >
                  <Zap size={20} />
                  Run Advanced Analysis
                </button>
              </div>
          </div>

          {isProcessing && (
            <div className="space-y-3">
              {/* Progress Bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-emerald-500" />
                    {progressStep || '처리 중...'}
                  </span>
                  <span className="text-sm font-black text-emerald-600">{progressPct}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2">
                  {PROGRESS_STEPS.filter(s => s.key !== 'done').map(s => (
                    <div
                      key={s.key}
                      className={`text-[9px] font-bold text-center transition-colors ${
                        progressPct >= s.pct ? 'text-emerald-600' : 'text-slate-300'
                      }`}
                      style={{ width: `${100 / (PROGRESS_STEPS.length - 1)}%` }}
                    >
                      {progressPct >= s.pct ? '✓' : '○'}
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={stopAnalysis}
                className="w-full py-3 px-4 rounded-xl font-bold bg-zinc-700 hover:bg-zinc-600 text-white flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
              >
                <XCircle size={18} />
                Stop Analysis
              </button>
            </div>
          )}

          <div className={`grid grid-cols-1 ${results ? 'lg:grid-cols-2' : ''} gap-6 flex-1 min-h-[400px]`}>
            <div className="flex-1 flex flex-col h-full">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                Execution Logs 
                {isRunning && <Loader2 size={14} className="animate-spin text-blue-500" />}
              </h3>
              <div className="flex-1 bg-slate-900 rounded-xl p-4 overflow-y-auto font-mono text-xs shadow-inner border border-slate-800 custom-scrollbar max-h-[500px]">
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600">
                    <FileText size={48} className="mb-4 opacity-20" />
                    <p>Click a button above to start.</p>
                    <p className="mt-2 text-center text-slate-500 max-w-sm">Note: A folder selection window will appear on your taskbar once started.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 list-none m-0 p-0">
                    {logs.map((log, index) => (
                      <div key={index} className="flex gap-2">
                        {log.type === 'error' && <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />}
                        {log.type === 'warning' && <AlertCircle size={14} className="text-yellow-400 shrink-0 mt-0.5" />}
                        {log.type === 'info' && <span className="text-blue-400 shrink-0 font-bold">[INFO]</span>}
                        {log.type === 'success' && <CheckCircle2 size={14} className="text-green-400 shrink-0 mt-0.5" />}
                        {log.type === 'log' && <span className="text-slate-500 shrink-0 font-bold">[SYS]</span>}
                        <span className={`${
                          log.type === 'error' ? 'text-red-300' :
                          log.type === 'warning' ? 'text-yellow-300 font-bold' :
                          log.type === 'success' ? 'text-green-300 font-bold' :
                          log.type === 'info' ? 'text-blue-300' :
                          'text-slate-300'
                        } break-all`}>
                          {log.message}
                        </span>
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </div>

            {results && (
              <div className="flex-1 flex flex-col h-full animate-fade-in">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <span>Analysis Results</span>
                  </h3>
                  {/* TXT / CSV 다운로드 버튼 */}
                  <div className="flex items-center gap-2">
                    {results.txt && (
                      <a
                        href={`/api/ebsd-results/${encodeURIComponent(results.txt)}`}
                        download
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-colors shadow"
                        title="Download TXT Report"
                      >
                        <Download size={13} />
                        TXT
                      </a>
                    )}
                    {results.csv && (
                      <a
                        href={`/api/ebsd-results/${encodeURIComponent(results.csv)}`}
                        download
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors shadow"
                        title="Download CSV Data"
                      >
                        <Download size={13} />
                        CSV
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex-1 bg-slate-50 rounded-xl p-4 overflow-y-auto border border-slate-200 custom-scrollbar max-h-[500px]">
                  {results.images.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {results.images.map((img, i) => (
                        <div key={i} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden group relative">
                          <img 
                            src={`/api/ebsd-results/${encodeURIComponent(img)}`} 
                            alt={img} 
                            className="w-full h-auto object-contain cursor-pointer transition-transform hover:scale-105"
                            onClick={() => window.open(`/api/ebsd-results/${encodeURIComponent(img)}`, '_blank')}
                          />
                          <div className="absolute bottom-0 left-0 right-0 bg-slate-900/80 text-white text-[10px] truncate p-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="truncate">{img}</span>
                            <a href={`/api/ebsd-results/${encodeURIComponent(img)}`} download onClick={e => e.stopPropagation()} className="text-blue-300 hover:text-white p-0.5" title="Download Image">
                              <Download size={12} />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                      <ImageIcon size={32} className="mb-2 opacity-50" />
                      <p className="text-sm">No images generated in this analysis.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EBSDApp;

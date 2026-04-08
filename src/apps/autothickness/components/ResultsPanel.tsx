import React, { useState, useEffect, useRef } from 'react';
import { Measurement } from '../services/Measurement';
import { CalibrationManager } from '../services/CalibrationManager';
import { Layers, Download, CheckCircle2, Activity, X, Settings, Info, TrendingUp } from 'lucide-react';

interface ResultsPanelProps {
    measurements: Measurement[];
    calibrationManager: CalibrationManager;
    onDeleteMeasurement: (index: number) => void;
    onSelectMeasurement: (measurement: Measurement | null) => void;
    onUpdateMeasurement?: (measurement: Measurement, updates: any) => void;
    selectedMeasurement: Measurement | null;
    addToast?: (title: string, message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
    correctionMode: 'merge' | 'split' | 'reassign' | null;
    setCorrectionMode: (mode: 'merge' | 'split' | 'reassign' | null) => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
    measurements,
    calibrationManager,
    onDeleteMeasurement,
    onSelectMeasurement,
    onUpdateMeasurement,
    selectedMeasurement,
    addToast,
    correctionMode,
    setCorrectionMode
}) => {
    const [localThreshold, setLocalThreshold] = useState<number | null>(null);
    const [localT1, setLocalT1] = useState<number | null>(null);
    const [localT2, setLocalT2] = useState<number | null>(null);
    const [localCiThreshold, setLocalCiThreshold] = useState<number | null>(null);
    const [localNoiseReduction, setLocalNoiseReduction] = useState<number>(0);
    const [localMinIslandSize, setLocalMinIslandSize] = useState<number>(10);
    const [localSplitSensitivity, setLocalSplitSensitivity] = useState<number>(1.0);

    useEffect(() => {
        if (selectedMeasurement?.type === 'microstructure') {
            setLocalThreshold(selectedMeasurement.data.manualThreshold ?? selectedMeasurement.data.threshold);
            setLocalT1(selectedMeasurement.data.t1 ?? 80);
            setLocalT2(selectedMeasurement.data.t2 ?? 180);
            setLocalNoiseReduction(selectedMeasurement.data.noiseReductionLevel ?? 0);
            setLocalMinIslandSize(selectedMeasurement.data.minIslandSize ?? 10);
            setLocalSplitSensitivity(selectedMeasurement.data.splitSensitivity ?? 1.0);
        } else {
            setLocalThreshold(null);
            setLocalT1(null);
            setLocalT2(null);
            setLocalNoiseReduction(0);
            setLocalMinIslandSize(10);
            setLocalSplitSensitivity(1.0);
        }
    }, [selectedMeasurement]);

    const getTypeLabel = (type: string) => {
        const labels: Record<string, string> = {
            'line': '선 측정',
            'auto': '자동 감지',
            'profile': '조도 분석',
            'rectangle': '사각형',
            'color-segment': '색상 영역',
            'parallel': '평행선',
            'area-profile': '두께 분석',
            'microstructure': 'SEM 미세구조'
        };
        return labels[type] || type;
    };

    const getTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            'line': '#3b82f6',
            'auto': '#10b981',
            'rectangle': '#8b5cf6',
            'color-segment': '#f59e0b',
            'parallel': '#06b6d4',
            'profile': '#3b82f6',
            'area-profile': '#f59e0b',
            'microstructure': '#4f46e5'
        };
        return colors[type] || '#94a3b8';
    };

    // Get area-profile details for selected measurement
    const selectedAreaDetails = selectedMeasurement?.type === 'area-profile' && selectedMeasurement.data?.results
        ? selectedMeasurement.data.results
        : null;

    const selectedRoughnessDetails = selectedMeasurement?.type === 'profile' && selectedMeasurement.data?.roughness
        ? selectedMeasurement.data.roughness
        : null;



    return (
        <aside className="results-panel flex flex-col w-full border-none h-full text-xs overflow-hidden bg-white">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 shrink-0">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-blue-500 rounded-sm"></span>
                    측정 리포트 및 분석
                </h3>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                
                {/* 1. Measurements List */}
                <div className="space-y-3">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-blue-500" /> 분석 내역 ({measurements.length})
                    </div>
                    <div className="min-h-[80px] max-h-[180px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {measurements.length === 0 ? (
                            <div className="text-center text-slate-350 py-6 italic text-[11px] bg-slate-50 rounded-lg border border-dashed border-slate-200">측정 결과가 없습니다</div>
                        ) : (
                            measurements.map((m, index) => (
                                <div
                                    key={m.id}
                                    onClick={() => onSelectMeasurement(m)}
                                    className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all cursor-pointer ${selectedMeasurement === m 
                                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg translate-x-1' 
                                        : 'bg-white border-slate-200 text-slate-700 hover:border-blue-400 hover:bg-slate-50'}`}
                                >
                                    <span className={`text-[10px] w-[20px] font-mono font-bold ${selectedMeasurement === m ? 'text-blue-200' : 'text-slate-400'}`}>
                                        {String(index + 1).padStart(2, '0')}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${selectedMeasurement === m ? 'bg-white/20' : 'bg-slate-100'}`}>
                                        {getTypeLabel(m.type)}
                                    </span>
                                    <span className="flex-1 font-mono text-[12px] font-bold truncate text-right">
                                        {m.getValue(calibrationManager)}
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onDeleteMeasurement(index); }}
                                        className={`ml-1 p-1 hover:bg-red-500 hover:text-white rounded-md transition-all ${selectedMeasurement === m ? 'text-white' : 'text-slate-300'}`}
                                        title="삭제"
                                    >✕</button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

            {/* Area-profile details */}
            {selectedAreaDetails && (
                <div className="bg-slate-50 rounded-md p-2 mb-2 border border-slate-200">
                    <div className="text-[11px] font-bold text-amber-500 mb-1.5">📐 층별 두께</div>
                    {Object.entries(selectedAreaDetails).map(([label, value]) => {
                        const excludeLabels = ['Background', '배경', 'Substrate', '모재'];
                        const isExcluded = excludeLabels.includes(label);
                        return (
                            <div key={label} className={`flex justify-between text-[11px] py-0.5 ${isExcluded ? 'text-slate-400' : 'text-slate-700'}`}>
                                <span>{label}</span>
                                <span className="font-mono">{(value as number).toFixed(2)} {calibrationManager.unit}</span>
                            </div>
                        );
                    })}
                    <div className="border-t border-slate-200 mt-1 pt-1 flex justify-between text-[11px] font-bold text-blue-600">
                        <span>Total</span>
                        <span>{(() => {
                            const excludeLabels = ['Background', '배경', 'Substrate', '모재'];
                            let total = 0;
                            Object.entries(selectedAreaDetails).forEach(([k, v]) => {
                                if (!excludeLabels.includes(k)) total += v as number;
                            });
                            return `${total.toFixed(2)} ${calibrationManager.unit}`;
                        })()}</span>
                    </div>
                </div>
            )}

            {/* Roughness details */}
            {selectedRoughnessDetails && (
                <div className="bg-emerald-50 rounded-md p-2 mb-2 border border-emerald-200">
                    <div className="text-[11px] font-bold text-emerald-600 mb-1.5">📈 조도 분석 결과</div>
                    {[
                        { key: 'Ra', label: 'Ra (산술평균)', desc: '평균 거칠기' },
                        { key: 'Rq', label: 'Rq (RMS)', desc: '제곱평균 제곱근' },
                        { key: 'Rp', label: 'Rp (최대 피크)', desc: '평균선 위 최대 높이' },
                        { key: 'Rv', label: 'Rv (최대 골)', desc: '평균선 아래 최대 깊이' },
                        { key: 'Rt', label: 'Rt (전체 범위)', desc: '최대 높이 - 최소 높이' },
                        { key: 'Rz', label: 'Rz (10점 평균)', desc: '5봉 5골 평균' }
                    ].map(({ key, label }) => (
                        <div key={key} className="flex justify-between text-[11px] py-0.5 text-slate-700">
                            <span className="font-medium">{label}</span>
                            <span className="font-mono text-emerald-700">{selectedRoughnessDetails[key]?.toFixed(3)}</span>
                        </div>
                    ))}
                    <div className="border-t border-emerald-200 mt-1 pt-1 flex justify-between text-[11px] text-slate-500">
                        <span>Mean Line</span>
                        <span className="font-mono">{selectedRoughnessDetails.meanLine?.toFixed(2)}</span>
                    </div>
                </div>
            )}

            {/* Microstructure details */}
            {(selectedMeasurement?.type === 'microstructure') && (
                <div className="bg-slate-50 rounded-md p-2 mb-2 border border-slate-200">
                    <div className="flex justify-between items-center mb-2 gap-2 flex-nowrap">
                        <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1 whitespace-nowrap flex-shrink-0">
                            <span>🔬 SEM 미세구조</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => {
                                    // 메인 캔버스 요소를 정확히 타겟팅 (CanvasArea 내부의 캔버스)
                                    const canvas = document.querySelector('#main-canvas') as HTMLCanvasElement || document.querySelector('canvas');
                                    if (canvas) {
                                        const link = document.createElement('a');
                                        const currentStep = selectedMeasurement.data.debugSteps?.[selectedMeasurement.data.debugStepIndex ?? -1];
                                        const stepName = currentStep ? currentStep.name.replace(/\s+/g, '_') : 'Final_Analysis';
                                        
                                        addToast && (addToast as any)('이미지 저장', `${stepName} 이미지를 다운로드합니다.`, 'info');
                                        
                                        link.download = `SEM_${stepName}_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.png`;
                                        link.href = canvas.toDataURL('image/png');
                                        link.click();
                                    }
                                }}
                                className="text-[10px] px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 font-bold shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
                                title="현재 분석 화면을 이미지로 저장"
                            >
                                <Download size={12} /> 이미지 저장
                            </button>
                            <select
                                value={selectedMeasurement.data.mode || 'classic'}
                                onChange={(e) => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { mode: e.target.value })}
                                className="text-[10px] p-0.5 border rounded bg-white shadow-sm focus:ring-1 focus:ring-blue-500 outline-none flex-grow min-w-0"
                            >
                                <option value="classic">기본 조직 분석</option>
                                <option value="substrate">모재 분석</option>
                                <option value="thin-film">박막 분석</option>
                            </select>
                        </div>
                    </div>

                    {(selectedMeasurement.data.mode === 'classic' || !selectedMeasurement.data.mode) && (
                        <div className="flex justify-end mb-2">
                             <select
                                value={selectedMeasurement.data.phaseMode || '2-phase'}
                                onChange={(e) => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { phaseMode: e.target.value })}
                                className="text-[10px] p-0.5 border rounded bg-white shadow-sm focus:ring-1 focus:ring-blue-500 outline-none w-full"
                            >
                                <option value="2-phase">2상 구조 (WC-Co)</option>
                                <option value="3-phase">3상 구조 (WC-γ-Co)</option>
                            </select>
                        </div>
                    )}

                    <div className="mb-2 space-y-2">


                        {/* Threshold Control - Only for Thin-film (Al2O3 / TiCN) */}
                        {(selectedMeasurement.data.mode === 'thin-film') && (
                            <div className="bg-white p-2 rounded border border-slate-100 shadow-sm">
                                <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
                                    <span className="font-semibold text-slate-700 whitespace-nowrap">분류 임계값 (Otsu): <span className="text-blue-600 text-[11px] font-bold">{localThreshold}</span></span>
                                </div>
                                <div className="relative mb-2 px-0.5">
                                    <input
                                        type="range"
                                        min="0" max="255" step="1"
                                        value={localThreshold ?? selectedMeasurement.data.threshold ?? 128}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            setLocalThreshold(val);
                                            onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { manualThreshold: val });
                                        }}
                                        className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600 relative z-10"
                                    />
                                </div>
                                <div className="flex justify-between text-[8px] text-slate-400 tracking-tighter mt-1">
                                    <span>0 (Al₂O₃)</span>
                                    <span>255 (TiCN)</span>
                                </div>
                            </div>
                        )}

                        {/* Mode Specific Controls - Classic & Substrate need T1 (Substrate also needs T2) */}
                        {(selectedMeasurement.type === 'microstructure' && (selectedMeasurement.data.mode === 'substrate' || selectedMeasurement.data.mode === 'classic' || !selectedMeasurement.data.mode)) && (
                            <div className="bg-white p-2 rounded border border-slate-250 text-[10px] shadow-inner space-y-3">
                                {/* T1 Sub-Slider */}
                                <div className="space-y-1">
                                    <div className="flex justify-between items-center px-0.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                                            <span className="text-slate-600 font-bold">임계값 (T1): <span className="text-blue-600">{localT1 ?? selectedMeasurement.data.t1 ?? '-'}</span></span>
                                        </div>
                                        {selectedMeasurement.data.t1 !== undefined && (
                                            <button onClick={() => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { t1: undefined })} className="text-red-400 hover:text-red-500 px-1">✕</button>
                                        )}
                                    </div>
                                    <input
                                        type="range" min="0" max="255" step="1"
                                        value={localT1 ?? selectedMeasurement.data.t1 ?? 80}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            setLocalT1(val);
                                            onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { t1: val });
                                        }}
                                        className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                    />
                                </div>

                                {/* T2 Sub-Slider - Only for Substrate mode or 3-phase classic mode */}
                                {(selectedMeasurement.data.mode === 'substrate' || selectedMeasurement.data.phaseMode === '3-phase') && (
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center px-0.5">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                                                <span className="text-slate-600 font-bold">상한 임계값 (T2): <span className="text-green-600">{localT2 ?? selectedMeasurement.data.t2 ?? '-'}</span></span>
                                            </div>
                                            {selectedMeasurement.data.t2 !== undefined && (
                                                <button onClick={() => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { t2: undefined })} className="text-red-400 hover:text-red-500 px-1">✕</button>
                                            )}
                                        </div>
                                        <input
                                            type="range" min="0" max="255" step="1"
                                            value={localT2 ?? selectedMeasurement.data.t2 ?? 180}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                setLocalT2(val);
                                                onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { t2: val });
                                            }}
                                            className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-green-500"
                                        />
                                    </div>
                                )}

                                {/* Island Removal Slider [추가] */}
                                <div className="space-y-1 pt-1 border-t border-slate-100">
                                    <div className="flex justify-between items-center px-0.5">
                                        <div className="flex items-center gap-1.5">
                                            <Layers size={10} className="text-slate-400" />
                                            <span className="text-slate-600 font-bold">노이즈 제거 (Island): <span className="text-slate-800">{localMinIslandSize}px</span></span>
                                        </div>
                                    </div>
                                    <input
                                        type="range" min="0" max="1000" step="5"
                                        value={localMinIslandSize}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            setLocalMinIslandSize(val);
                                            onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { minIslandSize: val });
                                        }}
                                        className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-500"
                                    />
                                    <div className="text-[8px] text-slate-400 flex justify-between px-0.5">
                                        <span>세밀 (0px)</span>
                                        <span>강력 필터 (1000px)</span>
                                    </div>
                                </div>

                                {/* Split Sensitivity Slider [추가] */}
                                <div className="space-y-1 pt-1 border-t border-slate-100">
                                    <div className="flex justify-between items-center px-0.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                                            <span className="text-slate-600 font-bold">입자 분리 민감도: <span className="text-orange-600">x{localSplitSensitivity.toFixed(1)}</span></span>
                                        </div>
                                    </div>
                                    <input
                                        type="range" min="0.5" max="2.0" step="0.1"
                                        value={localSplitSensitivity}
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            setLocalSplitSensitivity(val);
                                            onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { splitSensitivity: val });
                                        }}
                                        className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                    />
                                    <div className="text-[8px] text-slate-400 flex justify-between px-0.5">
                                        <span>약하게 (하나로)</span>
                                        <span>강하게 (더 쪼개기)</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Algorithm Step Wizard [추가] */}
                        {selectedMeasurement.type === 'microstructure' && (
                            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 mt-2 shadow-lg">
                                <p className="text-[10px] font-bold text-white mb-2 flex items-center gap-1.5 underline decoration-blue-500 underline-offset-4">
                                    <Layers size={12} className="text-blue-400" /> 분석 알고리즘 가이드
                                </p>
                                <div className="space-y-1.5">
                                    {[
                                        { s: 1, n: '1. 전처리 (Smoothing)' },
                                        { s: 2, n: '2. 상 분리 (Phase Map)' },
                                        { s: 3, n: '3. 거리 맵 (WC-EDM)' },
                                        { s: 4, n: '4. 워터셰드 (Split)' },
                                        { s: 5, n: '5. 최종 결과 산출' }
                                    ].map((step) => (
                                        <button
                                            key={step.s}
                                            onClick={() => {
                                                console.log(`[Algorithm Guide] Switch to Step ${step.s}`);
                                                onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { 
                                                    targetStep: step.s,
                                                    debugStepIndex: undefined // 중요: 개별 디버그 뷰를 해제해야 메인 타겟 스텝 보임
                                                });
                                            }}
                                            className={`w-full py-1.5 px-2 rounded text-[9px] font-bold text-left transition-all border flex justify-between items-center ${
                                                (selectedMeasurement.data.targetStep ?? 5) === step.s
                                                ? 'bg-blue-600 border-blue-400 text-white'
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                            }`}
                                        >
                                            {step.n}
                                            {(selectedMeasurement.data.targetStep ?? 5) >= step.s && (
                                                <span className="text-[8px] opacity-70">분석완료</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2">
                                    <button 
                                        onClick={() => {
                                            console.log('[Algorithm Guide] Reset to Raw');
                                            onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { 
                                                targetStep: 0,
                                                debugStepIndex: undefined
                                            });
                                        }}
                                        className="py-1 bg-slate-700 text-white text-[9px] rounded font-bold hover:bg-slate-600 active:scale-95 transition-all"
                                    >
                                        초기화 (원본)
                                    </button>
                                    <button 
                                        onClick={() => {
                                            const cur = selectedMeasurement.data.targetStep ?? 5;
                                            console.log(`[Algorithm Guide] Next Step from ${cur}`);
                                            if (cur < 5) onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { 
                                                targetStep: cur + 1,
                                                debugStepIndex: undefined
                                            });
                                        }}
                                        className="py-1 bg-blue-500 text-white text-[9px] rounded font-bold hover:bg-blue-400 active:scale-95 transition-all animate-pulse"
                                    >
                                        다음 단계 진행 →
                                    </button>
                                </div>
                                <p className="text-[8px] text-slate-500 mt-2 leading-tight">
                                    * 거리 맵과 워터셰드는 사용자의 요청대로 WC(탄화물) 상에 대해서만 정밀하게 수행됩니다.
                                </p>
                            </div>
                        )}

                        {/* Manual Correction Tools [NEW] */}
                        <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-3 mt-3 shadow-inner">
                            <p className="text-[10px] font-bold text-amber-700 mb-2 flex items-center gap-1.5 uppercase tracking-tight">
                                🛠️ 수동 보정 도구 (Manual Correction)
                            </p>
                            <div className="grid grid-cols-3 gap-1.5 mb-2">
                                <button
                                    onClick={() => setCorrectionMode(correctionMode === 'merge' ? null : 'merge')}
                                    className={`py-2 rounded text-[9px] font-bold border transition-all flex flex-col items-center justify-center gap-1 ${
                                        correctionMode === 'merge' ? 'bg-amber-600 border-amber-500 text-white shadow-md scale-95' : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-100'
                                    }`}
                                >
                                    <span>🔗 병합</span>
                                </button>
                                <button
                                    onClick={() => setCorrectionMode(correctionMode === 'split' ? null : 'split')}
                                    className={`py-2 rounded text-[9px] font-bold border transition-all flex flex-col items-center justify-center gap-1 ${
                                        correctionMode === 'split' ? 'bg-amber-600 border-amber-500 text-white shadow-md scale-95' : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-100'
                                    }`}
                                >
                                    <span>✂️ 분할</span>
                                </button>
                                <button
                                    onClick={() => setCorrectionMode(correctionMode === 'reassign' ? null : 'reassign')}
                                    className={`py-2 rounded text-[9px] font-bold border transition-all flex flex-col items-center justify-center gap-1 ${
                                        correctionMode === 'reassign' ? 'bg-amber-600 border-amber-500 text-white shadow-md scale-95' : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-100'
                                    }`}
                                >
                                    <span>🎨 상 재지정</span>
                                </button>
                            </div>
                            
                            {correctionMode && (
                                <div className="p-2 bg-white rounded border border-amber-200 text-[8px] text-amber-600 leading-tight flex items-start gap-1.5 animate-pulse">
                                    <span className="text-[10px]">💡</span>
                                    <span>
                                        {correctionMode === 'merge' && "병합할 두 입자의 경계를 클릭하세요."}
                                        {correctionMode === 'split' && "입자 내부를 드래그하여 절단선을 그으세요."}
                                        {correctionMode === 'reassign' && "변경할 입자를 클릭하여 Phase(WC/Co/γ)를 순환 변경합니다."}
                                    </span>
                                </div>
                            )}

                            <p className="text-[7px] text-amber-500 mt-2 italic leading-tight">
                                * 수정 후 '상 분율 및 통계치'가 실시간으로 재계산됩니다.
                            </p>
                        </div>

                        {/* Step-by-Step UI [추가] */}
                        {selectedMeasurement.type === 'microstructure' && selectedMeasurement.data.debugSteps && (
                            <div className="bg-slate-900/90 rounded border border-slate-700 p-2 mt-1 shadow-lg">
                                <div className="text-[9px] font-bold text-slate-400 mb-2 uppercase tracking-wider flex items-center justify-between">
                                    <span>🔍 단계별 알고리즘 확인</span>
                                    {selectedMeasurement.data.debugStepIndex !== undefined && (
                                        <button 
                                            onClick={() => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { debugStepIndex: undefined })}
                                            className="text-blue-400 hover:text-blue-300"
                                        >초기화</button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {selectedMeasurement.data.debugSteps.map((step: any, idx: number) => (
                                        <button
                                            key={idx}
                                            onClick={() => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { debugStepIndex: idx })}
                                            className={`py-1 rounded text-[8px] font-bold transition-all border ${
                                                selectedMeasurement.data.debugStepIndex === idx 
                                                ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_8px_rgba(37,99,235,0.4)]' 
                                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                            }`}
                                        >
                                            {step.name}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, { debugStepIndex: undefined })}
                                        className={`py-1 rounded text-[8px] font-bold transition-all border col-span-2 ${
                                            selectedMeasurement.data.debugStepIndex === undefined 
                                            ? 'bg-emerald-600 border-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]' 
                                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                                        }`}
                                    >
                                        최종 분석 오버레이
                                    </button>
                                </div>
                                <p className="text-[7px] text-slate-500 mt-2 leading-tight italic">
                                    * 문제가 발생하는 지점을 단계별로 확인하여 파라미터를 조정하세요.
                                </p>
                            </div>
                        )}



                        {/* Analysis Reset Button */}
                        <button
                            onClick={() => {
                                setLocalThreshold(selectedMeasurement.data.autoThreshold || 128);
                                onUpdateMeasurement && onUpdateMeasurement(selectedMeasurement, {
                                    manualThreshold: undefined,
                                    t1: undefined,
                                    t2: undefined
                                });
                            }}
                            className="w-full py-1.5 bg-slate-100 text-slate-500 text-[9px] rounded hover:bg-slate-200 transition-colors border border-slate-200 mt-1 font-semibold flex items-center justify-center gap-1"
                        >
                            <span>🔄</span> 분석 초기화 (자동 계산값으로 복구)
                        </button>

                        {/* Results Section */}
                        <div className="mt-3">
                            <div className="text-[9px] font-bold text-slate-500 mb-2 uppercase tracking-widest border-b border-slate-200 pb-1 flex items-center gap-1">
                                <CheckCircle2 size={10} className="text-emerald-500" /> 분석 결과 수치
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                {selectedMeasurement.data.mode === 'substrate' ? (
                                    <>
                                        <div className="bg-slate-50 p-2 rounded border border-slate-200 shadow-sm">
                                            <div className="text-slate-500 text-[8px] mb-0.5 font-bold">Co</div>
                                            <div className="font-mono font-bold text-slate-800">{(selectedMeasurement.data.coFraction * 100 || 0).toFixed(1)}%</div>
                                        </div>
                                        <div className="bg-amber-50 p-2 rounded border border-amber-100 shadow-sm">
                                            <div className="text-amber-600 text-[8px] mb-0.5 font-bold">MC</div>
                                            <div className="font-mono font-bold text-amber-700">{(selectedMeasurement.data.mcFraction * 100 || 0).toFixed(1)}%</div>
                                        </div>
                                        <div className="bg-blue-50 p-2 rounded border border-blue-100 col-span-2 flex justify-between items-center px-3 shadow-sm">
                                            <div className="text-blue-600 font-bold flex items-center gap-1">
                                                <div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm"></div>
                                                WC
                                            </div>
                                            <div className="font-mono font-bold text-blue-700 text-lg">{(selectedMeasurement.data.wcFraction * 100 || 0).toFixed(1)}%</div>
                                        </div>
                                    </>
                                ) : selectedMeasurement.data.mode === 'thin-film' ? (
                                    <>
                                        <div className="bg-slate-900 p-2 rounded border border-slate-700 shadow-sm">
                                            <div className="text-slate-400 text-[8px] mb-0.5 font-bold">Al₂O₃</div>
                                            <div className="font-mono font-bold text-slate-300">{(selectedMeasurement.data.al2o3Fraction * 100 || 0).toFixed(1)}%</div>
                                        </div>
                                        <div className="bg-indigo-50 p-2 rounded border border-indigo-100 shadow-sm">
                                            <div className="text-indigo-600 text-[8px] mb-0.5 font-bold">TiCN</div>
                                            <div className="font-mono font-bold text-indigo-700">{(selectedMeasurement.data.ticnFraction * 100 || 0).toFixed(1)}%</div>
                                        </div>
                                        <div className="bg-white p-2 border border-slate-100 rounded shadow-sm col-span-2 text-center">
                                            <div className="text-slate-400 text-[8px] uppercase">분류 임계값 (Otsu)</div>
                                            <div className="font-mono font-bold text-blue-600">{selectedMeasurement.data.threshold}</div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {selectedMeasurement.data.phaseMode === '3-phase' ? (
                                            <>
                                                <div className="bg-white p-2 border border-slate-100 rounded shadow-sm">
                                                    <div className="text-slate-400 text-[8px] font-bold">WC</div>
                                                    <div className="font-mono font-bold text-blue-600">{(selectedMeasurement.data.wcFraction * 100 || 0).toFixed(1)}%</div>
                                                </div>
                                                <div className="bg-white p-2 border border-slate-100 rounded shadow-sm">
                                                    <div className="text-amber-600 text-[8px] font-bold">MC(γ)</div>
                                                    <div className="font-mono font-bold text-amber-600">{(selectedMeasurement.data.mcFraction * 100 || 0).toFixed(1)}%</div>
                                                </div>
                                                <div className="bg-white p-2 border border-slate-100 rounded shadow-sm col-span-2">
                                                    <div className="text-slate-400 text-[8px] font-bold text-center">Co (Binder)</div>
                                                    <div className="font-mono font-bold text-slate-800 text-center text-lg">{(selectedMeasurement.data.coFraction * 100 || 0).toFixed(1)}%</div>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="bg-white p-2 border border-slate-100 rounded shadow-sm">
                                                    <div className="text-slate-400 text-[8px] font-bold">WC</div>
                                                    <div className="font-mono font-bold text-blue-600">{(selectedMeasurement.data.wcFraction * 100 || 0).toFixed(1)}%</div>
                                                </div>
                                                <div className="bg-white p-2 border border-slate-100 rounded shadow-sm">
                                                    <div className="text-slate-400 text-[8px] font-bold">Co</div>
                                                    <div className="font-mono font-bold text-slate-800">{(selectedMeasurement.data.coFraction * 100 || 0).toFixed(1)}%</div>
                                                </div>
                                            </>
                                        )}

                                        {/* Step 5.A: Grain Size */}
                                        <div className="bg-blue-50/50 p-2 border border-blue-100 rounded shadow-sm">
                                            <div className="text-blue-600 text-[8px] font-bold">D_n (개수 가중)</div>
                                            <div className="font-mono font-bold text-blue-700">{selectedMeasurement.data.avgGrainSize?.toFixed(3)} <span className="text-[7px]">{calibrationManager.unit}</span></div>
                                        </div>
                                        <div className="bg-blue-50/50 p-2 border border-blue-100 rounded shadow-sm">
                                            <div className="text-blue-600 text-[8px] font-bold">D_a (면적 가중)</div>
                                            <div className="font-mono font-bold text-blue-700">{selectedMeasurement.data.areaWeightedGrainSize?.toFixed(3)} <span className="text-[7px]">{calibrationManager.unit}</span></div>
                                        </div>

                                        {/* Step 5.B: Contiguity */}
                                        <div className="bg-emerald-50/50 p-2 border border-emerald-100 rounded shadow-sm">
                                            <div className="text-emerald-600 text-[8px] font-bold">C_wc/wc (인접도)</div>
                                            <div className="font-mono font-bold text-emerald-700">{selectedMeasurement.data.contiguity?.toFixed(3)}</div>
                                        </div>

                                        {/* Step 5.C: Mean Free Path */}
                                        <div className="bg-amber-50/50 p-2 border border-amber-100 rounded shadow-sm">
                                            <div className="text-amber-600 text-[8px] font-bold">λ (평균 자유 행로)</div>
                                            <div className="font-mono font-bold text-amber-700">{selectedMeasurement.data.meanFreePath?.toFixed(3)} <span className="text-[7px]">{calibrationManager.unit}</span></div>
                                        </div>

                                        <div className="bg-white p-2 border border-slate-100 rounded shadow-sm col-span-2 text-center">
                                            {selectedMeasurement.data.phaseMode === '3-phase' ? (
                                                <div className="flex justify-around text-[7px] text-slate-400 mb-1">
                                                    <span>T1: {selectedMeasurement.data.t1}</span>
                                                    <span>T2: {selectedMeasurement.data.t2}</span>
                                                    <span>Grains: {selectedMeasurement.data.grainCount}</span>
                                                </div>
                                            ) : (
                                                <div className="text-slate-400 text-[8px] uppercase mb-1">임계값 (T1) | Grain Count: {selectedMeasurement.data.grainCount}</div>
                                            )}
                                            <div className="font-mono font-bold text-blue-600">
                                                {selectedMeasurement.data.phaseMode === '3-phase' ? `${selectedMeasurement.data.t1} ~ ${selectedMeasurement.data.t2}` : selectedMeasurement.data.t1}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

                {/* 3. Global Shortcuts */}
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 shadow-inner">
                    <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-tight flex items-center gap-1.5">
                        <Activity size={10} /> 단축키 안내
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-slate-500">
                        <div className="flex items-center justify-between"><span className="text-slate-400">선 측정</span><kbd className="bg-white border rounded px-1 min-w-[18px] text-center shadow-sm">L</kbd></div>
                        <div className="flex items-center justify-between"><span className="text-slate-400">사각형</span><kbd className="bg-white border rounded px-1 min-w-[18px] text-center shadow-sm">R</kbd></div>
                        <div className="flex items-center justify-between"><span className="text-slate-400">자동 분석</span><kbd className="bg-white border rounded px-1 min-w-[18px] text-center shadow-sm">Q</kbd></div>
                        <div className="flex items-center justify-between"><span className="text-slate-400">삭제</span><kbd className="bg-white border rounded px-1 min-w-[18px] text-center shadow-sm">Del</kbd></div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[9px] text-slate-400 flex justify-between items-center shrink-0">
                <span>© 2026 Antigravity</span>
                <span>{new Date().toLocaleDateString()}</span>
            </div>
        </aside>
    );
};

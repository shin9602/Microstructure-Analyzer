import React, { useState, useEffect } from 'react';
import { Info, Ruler, MousePointerClick, BarChart3, Download, Layers, Atom, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { calculateFWHM, calculateGrainSize } from '../services/xrdProcessing';
import { MATERIALS } from '../constants';
import * as XLSX from 'xlsx';
import type { ParsedFile } from '../types';

interface SelectedPeak {
    plane: string;
    range: { min: number; max: number };
}

interface GrainSizeConfiguratorProps {
    lambda: number;
    onLambdaChange: (val: number) => void;
    kFactor: number;
    onKFactorChange: (val: number) => void;
    selectedTwoTheta: number | null;
    onCalculate: (results: any) => void;
    onSetMode: (mode: 'pan' | 'select' | 'zoom') => void;
    batchResults: Record<string, any[]>;
    activeFileId: string | null;
    onSelectFile: (id: string) => void;
    data: any[];
    selectedPeaks: SelectedPeak[];
    onSelectedPeaksChange: (peaks: SelectedPeak[]) => void;
    activePeak: string | null;
    onActivePeakChange: (plane: string | null) => void;
    files: ParsedFile[];
}

// 모든 재료의 픽 목록을 합쳐서 선택 가능한 풀(pool) 생성
const buildAvailablePeaks = (): SelectedPeak[] => {
    const seen = new Set<string>();
    const result: SelectedPeak[] = [];
    Object.values(MATERIALS).forEach(mat => {
        Object.entries(mat.defaultRanges).forEach(([plane, range]) => {
            if (!seen.has(plane)) {
                seen.add(plane);
                result.push({ plane, range });
            }
        });
    });
    return result;
};

const ALL_PEAKS = buildAvailablePeaks();

const GrainSizeConfigurator: React.FC<GrainSizeConfiguratorProps> = ({
    lambda,
    onLambdaChange,
    kFactor,
    onKFactorChange,
    selectedTwoTheta,
    onSetMode,
    batchResults,
    activeFileId,
    onSelectFile,
    data,
    selectedPeaks,
    onSelectedPeaksChange,
    activePeak,
    onActivePeakChange,
    files,
}) => {
    const [showPeakPicker, setShowPeakPicker] = useState(false);
    const [fwhmResult, setFwhmResult] = useState<{
        fwhm: number;
        peak2Theta: number;
        left2Theta: number;
        right2Theta: number;
        halfMax: number;
    } | null>(null);
    const [grainSize, setGrainSize] = useState<number | null>(null);

    useEffect(() => {
        if (selectedTwoTheta !== null && data.length > 0 && activePeak) {
            const pk = selectedPeaks.find(p => p.plane === activePeak);
            if (pk) {
                const res = calculateFWHM(data, pk.range.min, pk.range.max);
                if (res) {
                    setFwhmResult(res);
                    setGrainSize(calculateGrainSize(kFactor, lambda, res.fwhm, res.peak2Theta));
                    return;
                }
            }
        }
        setFwhmResult(null);
        setGrainSize(null);
    }, [lambda, kFactor, selectedTwoTheta, data, activePeak, selectedPeaks]);

    const togglePeak = (peak: SelectedPeak) => {
        const exists = selectedPeaks.find(p => p.plane === peak.plane);
        if (exists) {
            const updated = selectedPeaks.filter(p => p.plane !== peak.plane);
            onSelectedPeaksChange(updated);
            if (activePeak === peak.plane) onActivePeakChange(updated[0]?.plane ?? null);
        } else {
            onSelectedPeaksChange([...selectedPeaks, { ...peak }]);
        }
    };

    const handleExportExcel = () => {
        if (selectedPeaks.length === 0 || files.length === 0) return;

        // 파일 × 픽 행렬로 시트 구성
        const rows = files.map(file => {
            const row: Record<string, any> = { 'Filename': file.name };
            selectedPeaks.forEach(pk => {
                const pkResults = batchResults[pk.plane] || [];
                const entry = pkResults.find((r: any) => r.fileId === file.id);
                row[`${pk.plane} Size (Å)`] = entry?.status === 'OK' ? entry.grainSize?.toFixed(2) : 'N/A';
                row[`${pk.plane} FWHM (°)`] = entry?.status === 'OK' ? entry.fwhm?.toFixed(4) : 'N/A';
                row[`${pk.plane} 2θ (°)`] = entry?.status === 'OK' ? entry.peak2Theta?.toFixed(4) : 'N/A';
            });
            return row;
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Grain Size');
        XLSX.writeFile(wb, '입도 (FWHM).xlsx');
    };

    const hasBatchData = selectedPeaks.some(pk => (batchResults[pk.plane]?.length ?? 0) > 0);

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 h-full flex flex-col animate-fade-in text-slate-800 overflow-hidden">
            {/* Header */}
            <div className="mb-4 shrink-0">
                <div className="flex justify-between items-start mb-1">
                    <h3 className="text-base font-bold flex items-center gap-2">
                        <Atom className="text-blue-600" size={18} />
                        Grain Size (Scherrer)
                    </h3>
                    <div className="flex gap-1.5 items-center">
                        {hasBatchData && (
                            <button
                                onClick={handleExportExcel}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Download 입도 (FWHM).xlsx"
                            >
                                <Download size={16} />
                            </button>
                        )}
                        <div className="group relative">
                            <Info size={14} className="text-slate-400 cursor-help" />
                            <div className="absolute right-0 bottom-6 hidden group-hover:block w-64 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl z-50">
                                여러 픽을 선택해 각 픽에서 FWHM/입도를 일괄 계산합니다.<br /><br />
                                픽 상자를 클릭하면 범위 편집 모드 — 차트에서 드래그하여 범위를 조정하세요.
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar space-y-4">
                {/* Parameters */}
                <div className="grid grid-cols-2 gap-2 shrink-0">
                    <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl">
                        <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">X-Ray λ (Å)</label>
                        <input
                            type="number"
                            step="0.000001"
                            value={lambda}
                            onChange={(e) => onLambdaChange(parseFloat(e.target.value))}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-xl">
                        <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">K (Shape Factor)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={kFactor}
                            onChange={(e) => onKFactorChange(parseFloat(e.target.value))}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                </div>

                {/* Peak Selection Panel */}
                <div className="shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">분석 픽 선택</span>
                        <button
                            onClick={() => setShowPeakPicker(v => !v)}
                            className="text-[10px] font-bold text-blue-600 hover:underline"
                        >
                            {showPeakPicker ? '닫기' : '픽 추가/제거'}
                        </button>
                    </div>

                    {/* Selected peaks — click row to activate range edit */}
                    <div className="space-y-1.5">
                        {selectedPeaks.length === 0 && (
                            <p className="text-xs text-slate-400 text-center py-2">픽을 선택하세요</p>
                        )}
                        {selectedPeaks.map(pk => {
                            const isActive = activePeak === pk.plane;
                            return (
                                <button
                                    key={pk.plane}
                                    onClick={() => {
                                        if (isActive) {
                                            onActivePeakChange(null);
                                            onSetMode('pan');
                                        } else {
                                            onActivePeakChange(pk.plane);
                                            onSetMode('select');
                                        }
                                    }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all text-left ${isActive
                                        ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-400'
                                        : 'bg-slate-50 border-slate-100 hover:border-blue-200 hover:bg-blue-50/40'
                                        }`}
                                    title="클릭하여 범위 설정"
                                >
                                    <span className={`font-bold w-14 shrink-0 ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>{pk.plane}</span>
                                    <span className={`font-mono text-[10px] flex-1 truncate ${isActive ? 'text-blue-500' : 'text-slate-400'}`}>
                                        {pk.range.min.toFixed(2)}° – {pk.range.max.toFixed(2)}°
                                    </span>
                                    {isActive && (
                                        <span className="text-[9px] font-bold text-blue-500 shrink-0">드래그 중</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Peak Picker Dropdown */}
                    {showPeakPicker && (
                        <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden shadow-sm max-h-44 overflow-y-auto custom-scrollbar">
                            {ALL_PEAKS.map(pk => {
                                const selected = !!selectedPeaks.find(p => p.plane === pk.plane);
                                return (
                                    <button
                                        key={pk.plane}
                                        onClick={() => togglePeak(pk)}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${selected
                                            ? 'bg-blue-50 text-blue-700 font-bold'
                                            : 'hover:bg-slate-50 text-slate-600'
                                            }`}
                                    >
                                        {selected ? <CheckSquare size={13} className="text-blue-600 shrink-0" /> : <Square size={13} className="text-slate-300 shrink-0" />}
                                        <span className="font-bold w-12 shrink-0">{pk.plane}</span>
                                        <span className="text-slate-400 font-mono text-[10px]">
                                            {pk.range.min.toFixed(2)}°–{pk.range.max.toFixed(2)}°
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Active peak drag hint */}
                {activePeak && (
                    <div className="shrink-0 flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 font-medium animate-fade-in">
                        <MousePointerClick size={14} />
                        <span><strong>{activePeak}</strong> — 차트에서 드래그하여 범위 설정</span>
                    </div>
                )}

                {/* Active peak FWHM result card */}
                {fwhmResult && grainSize !== null && activePeak && (
                    <div className="shrink-0 space-y-2 animate-fade-in">
                        <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white border border-slate-100 p-2.5 rounded-xl shadow-sm">
                                <label className="block text-[10px] text-slate-400 uppercase font-black mb-0.5">FWHM</label>
                                <div className="text-base font-mono font-bold text-slate-700">{fwhmResult.fwhm.toFixed(4)}°</div>
                            </div>
                            <div className="bg-white border border-slate-100 p-2.5 rounded-xl shadow-sm">
                                <label className="block text-[10px] text-slate-400 uppercase font-black mb-0.5">Peak 2θ</label>
                                <div className="text-base font-mono font-bold text-slate-700">{fwhmResult.peak2Theta.toFixed(4)}°</div>
                            </div>
                        </div>
                        <div className="bg-blue-900 rounded-xl p-4 text-white shadow-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-3 opacity-10"><Ruler size={40} /></div>
                            <label className="block text-[10px] text-blue-300 uppercase font-black mb-0.5">{activePeak} Grain Size (D)</label>
                            <div className="text-2xl font-mono font-bold">
                                {grainSize.toFixed(2)} <span className="text-sm font-normal text-blue-300/60 ml-1">Å</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Batch Results Table */}
                {hasBatchData && (
                    <div className="shrink-0 space-y-2">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-black">
                            <Layers size={13} />
                            Batch Analysis ({files.length} Files)
                        </div>
                        <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                        <tr>
                                            <th className="px-2 py-2 whitespace-nowrap">File</th>
                                            {selectedPeaks.map(pk => (
                                                <th key={pk.plane} className="px-2 py-2 text-right whitespace-nowrap">
                                                    {pk.plane} (Å)
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 bg-white">
                                        {files.map(file => (
                                            <tr
                                                key={file.id}
                                                onClick={() => onSelectFile(file.id)}
                                                className={`cursor-pointer transition-all ${activeFileId === file.id
                                                    ? 'bg-blue-100/50 border-l-2 border-l-blue-500'
                                                    : 'hover:bg-blue-50/30'
                                                    }`}
                                            >
                                                <td className="px-2 py-2 font-medium text-slate-600 truncate max-w-[100px]" title={file.name}>
                                                    {file.name}
                                                </td>
                                                {selectedPeaks.map(pk => {
                                                    const pkResults = batchResults[pk.plane] || [];
                                                    const entry = pkResults.find((r: any) => r.fileId === file.id);
                                                    const isOK = entry?.status === 'OK';
                                                    const warn = isOK && entry.isNearBoundary;
                                                    const val = isOK ? entry.grainSize?.toFixed(2) : '–';
                                                    return (
                                                        <td
                                                            key={pk.plane}
                                                            className={`px-2 py-2 text-right font-mono font-bold ${warn ? 'bg-amber-50 text-amber-700' : isOK ? 'text-blue-700' : 'text-slate-300'}`}
                                                            title={warn ? `⚠️ 피크(${entry.peak2Theta?.toFixed(3)}°)가 범위 경계에 너무 가깝습니다. 범위를 조정하세요.` : undefined}
                                                        >
                                                            <span className="flex items-center justify-end gap-1">
                                                                {warn && <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                                                                {val}
                                                            </span>
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Download Button */}
            <div className="mt-3 shrink-0">
                <button
                    onClick={handleExportExcel}
                    disabled={!hasBatchData}
                    className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-md
                        ${hasBatchData
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:scale-[1.01] active:scale-[0.99]'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                    <Download size={16} />
                    입도 (FWHM) 다운로드
                </button>
            </div>
        </div>
    );
};

export default React.memo(GrainSizeConfigurator);

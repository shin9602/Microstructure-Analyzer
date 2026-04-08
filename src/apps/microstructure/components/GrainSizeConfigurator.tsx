import React, { useState, useEffect } from 'react';
import { Info, Ruler, ArrowRight, MousePointerClick, BarChart3, Download, Table, Layers, Atom } from 'lucide-react';
import { calculateFWHM, calculateGrainSize } from '../services/xrdProcessing';
import * as XLSX from 'xlsx';

interface GrainSizeConfiguratorProps {
    lambda: number;
    onLambdaChange: (val: number) => void;
    kFactor: number;
    onKFactorChange: (val: number) => void;
    selectedTwoTheta: number | null;
    onCalculate: (results: any) => void;
    onSetMode: (mode: 'pan' | 'select' | 'zoom') => void;
    batchResults: any[];
    activeFileId: string | null;
    onSelectFile: (id: string) => void;
    data: any[]; // Current active file data
}

const GrainSizeConfigurator: React.FC<GrainSizeConfiguratorProps> = ({
    lambda,
    onLambdaChange,
    kFactor,
    onKFactorChange,
    selectedTwoTheta,
    onCalculate,
    onSetMode,
    batchResults,
    activeFileId,
    onSelectFile,
    data
}) => {
    const [fwhmResult, setFwhmResult] = useState<{
        fwhm: number;
        peak2Theta: number;
        left2Theta: number;
        right2Theta: number;
        halfMax: number;
    } | null>(null);
    const [grainSize, setGrainSize] = useState<number | null>(null);

    useEffect(() => {
        if (selectedTwoTheta !== null && data.length > 0) {
            // Find FWHM in a window around selected point (e.g. +/- 2 degrees)
            const res = calculateFWHM(data, selectedTwoTheta - 1.5, selectedTwoTheta + 1.5);
            if (res) {
                setFwhmResult(res);
                const d = calculateGrainSize(kFactor, lambda, res.fwhm, res.peak2Theta);
                setGrainSize(d);
            } else {
                setFwhmResult(null);
                setGrainSize(null);
            }
        } else {
            setFwhmResult(null);
            setGrainSize(null);
        }
    }, [lambda, kFactor, selectedTwoTheta, data]);

    const handleExportExcel = () => {
        if (batchResults.length === 0) return;

        const csvData = batchResults.map(r => ({
            'Filename': r.filename,
            'Peak Position (2θ)': r.peak2Theta?.toFixed(2) || 'N/A',
            'FWHM (deg)': r.fwhm?.toFixed(2) || 'N/A',
            'Grain Size (A)': r.grainSize?.toFixed(2) || 'N/A',
            'Status': r.status
        }));

        const ws = XLSX.utils.json_to_sheet(csvData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Grain Size Analysis");
        XLSX.writeFile(wb, "XRD_Grain_Size_Analysis.xlsx");
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-full flex flex-col animate-fade-in text-slate-800">
            <div className="mb-6">
                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <Atom className="text-blue-600" size={20} />
                        Grain Size Analysis (Scherrer)
                    </h3>
                    <div className="flex gap-2">
                        {batchResults.length > 0 && (
                            <button
                                onClick={handleExportExcel}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Export to Excel"
                            >
                                <Download size={18} />
                            </button>
                        )}
                        <div className="group relative">
                            <Info size={16} className="text-slate-400 cursor-help" />
                            <div className="absolute right-0 bottom-6 hidden group-hover:block w-72 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl z-50">
                                Scherrer 공식을 사용하여 결정립 크기를 계산합니다.
                                <br /><br />
                                1. 차트에서 분석할 피크 영역을 드래그하여 선택하세요.
                                <br />
                                2. 선택된 영역 내에서 최대 강도의 절반 지점(FWHM)을 자동으로 찾습니다.
                                <br />
                                3. 모든 파일에 대해 동일한 피크 위치에서 일괄 계산됩니다.
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-sm text-slate-500">
                    반치폭(FWHM) 측정을 통한 결정립 크기 도출.
                </p>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {/* Parameters Section */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                        <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">X-Ray λ (Å)</label>
                        <input
                            type="number"
                            step="0.000001"
                            value={lambda}
                            onChange={(e) => onLambdaChange(parseFloat(e.target.value))}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                    </div>
                    <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                        <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">K (Shape Factor)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={kFactor}
                            onChange={(e) => onKFactorChange(parseFloat(e.target.value))}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                    </div>
                </div>

                {/* Peak Selection */}
                <div className={`p-4 rounded-xl border cursor-pointer transition-all hover:border-blue-400 group ${selectedTwoTheta !== null ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-100'}`}
                    onClick={() => onSetMode('select')}
                >
                    <div className="flex justify-between items-center mb-1">
                        <label className="block text-[10px] text-slate-400 uppercase font-black group-hover:text-blue-500 transition-colors">Target Peak (2θ)</label>
                        <MousePointerClick size={12} className="text-slate-400 group-hover:text-blue-500" />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className={`text-2xl font-mono font-bold ${selectedTwoTheta !== null ? 'text-blue-700' : 'text-slate-300'}`}>
                            {selectedTwoTheta !== null ? selectedTwoTheta.toFixed(4) : '00.0000'}
                        </span>
                    </div>
                </div>

                {/* Detailed Results */}
                {fwhmResult && grainSize !== null && (
                    <div className="space-y-4 pt-2 animate-fade-in">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                                <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">Measured FWHM</label>
                                <div className="text-lg font-mono font-bold text-slate-700">
                                    {fwhmResult.fwhm.toFixed(2)}°
                                </div>
                            </div>
                            <div className="bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                                <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">Peak Pos (2θ)</label>
                                <div className="text-lg font-mono font-bold text-slate-700">
                                    {fwhmResult.peak2Theta.toFixed(2)}°
                                </div>
                            </div>
                        </div>

                        <div className="bg-blue-900 rounded-xl p-5 text-white shadow-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-3 opacity-10">
                                <Ruler size={48} />
                            </div>
                            <label className="block text-[10px] text-blue-300 uppercase font-black mb-1">Calculated Grain Size (D)</label>
                            <div className="text-3xl font-mono font-bold">
                                {grainSize.toFixed(2)} <span className="text-sm font-normal text-blue-300/60 ml-1">Å</span>
                            </div>
                            <div className="mt-2 text-[10px] text-blue-200/40 font-mono">
                                Precision calculated via linear interpolation
                            </div>
                        </div>
                    </div>
                )}

                {/* Batch Table */}
                {batchResults.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-black">
                            <Layers size={14} />
                            Batch Analysis ({batchResults.length} Files)
                        </div>
                        <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                    <tr>
                                        <th className="px-3 py-2">File</th>
                                        <th className="px-3 py-2 text-right">Size (Å)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50 bg-white">
                                    {batchResults.map((res, i) => (
                                        <tr
                                            key={i}
                                            onClick={() => {
                                                if (res.fileId) onSelectFile(res.fileId);
                                            }}
                                            className={`cursor-pointer transition-all ${activeFileId && res.fileId === activeFileId
                                                ? 'bg-blue-100/50 border-l-2 border-l-blue-500'
                                                : 'hover:bg-blue-50/30'
                                                }`}
                                        >
                                            <td className="px-3 py-2 font-medium text-slate-600 truncate max-w-[120px]" title={res.filename}>
                                                {res.filename}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-bold text-blue-700">
                                                {res.grainSize ? res.grainSize.toFixed(2) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-4">
                <button
                    onClick={handleExportExcel}
                    disabled={batchResults.length === 0}
                    className={`w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg
            ${batchResults.length > 0
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:scale-[1.02] active:scale-[0.98]'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                    <Download size={18} />
                    Excel Download
                </button>
            </div>
        </div>
    );
};

export default React.memo(GrainSizeConfigurator);

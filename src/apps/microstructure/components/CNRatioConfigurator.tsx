import React, { useState, useEffect } from 'react';
import { Info, Calculator, ArrowRight, MousePointerClick, BarChart3, Download, Table, Layers } from 'lucide-react';
import { calculateLatticeParameter, calculateCNRatioResult } from '../services/xrdProcessing';
import * as XLSX from 'xlsx';

interface CNRatioConfiguratorProps {
    lambda: number;
    onLambdaChange: (val: number) => void;
    selectedTwoTheta: number | null;
    onCalculate: (results: any) => void;
    onSetMode: (mode: 'pan' | 'select' | 'zoom') => void;
    batchResults: any[];
    activeFileId: string | null;
    onSelectFile: (id: string) => void;
}

const CNRatioConfigurator: React.FC<CNRatioConfiguratorProps> = ({
    lambda,
    onLambdaChange,
    selectedTwoTheta,
    onCalculate,
    onSetMode,
    batchResults,
    activeFileId,
    onSelectFile
}) => {
    // Oriented to (111) as requested
    const h = 1;
    const k = 1;
    const l = 1;

    const [latticeA, setLatticeA] = useState<number | null>(null);
    const [cnResults, setCnResults] = useState<{ cPercentage: number; nPercentage: number } | null>(null);

    useEffect(() => {
        if (selectedTwoTheta !== null) {
            const a = calculateLatticeParameter(lambda, h, k, l, selectedTwoTheta);
            setLatticeA(a);
            const res = calculateCNRatioResult(a);
            setCnResults(res);
        } else {
            setLatticeA(null);
            setCnResults(null);
        }
    }, [lambda, h, k, l, selectedTwoTheta]);

    const handleExportExcel = () => {
        if (batchResults.length === 0) return;

        const data = batchResults.map(r => ({
            'Filename': r.filename,
            '2-Theta (deg)': r.twoTheta.toFixed(2),
            'Lattice Parameter a (A)': r.a.toFixed(6),
            'Carbon (C%)': (r.c * 100).toFixed(2) + '%',
            'Nitrogen (N%)': (r.n * 100).toFixed(2) + '%',
            'Status': r.status
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "CN Analysis");
        XLSX.writeFile(wb, "TiCN_Composition_Analysis.xlsx");
    };

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-full flex flex-col animate-fade-in">
            <div className="mb-6">
                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <BarChart3 className="text-emerald-600" size={20} />
                        TiCN Composition Analysis
                    </h3>
                    <div className="flex gap-2">
                        {batchResults.length > 0 && (
                            <button
                                onClick={handleExportExcel}
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Export to Excel"
                            >
                                <Download size={18} />
                            </button>
                        )}
                        <div className="group relative">
                            <Info size={16} className="text-slate-400 cursor-help" />
                            <div className="absolute right-0 bottom-6 hidden group-hover:block w-72 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl z-50">
                                Calculate C/N ratio based on TiCN (111) lattice parameter.
                                <br /><br />
                                1. Click "Selected 2θ" or use range select on chart.
                                <br />
                                2. All uploaded files will be automatically calculated.
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-sm text-slate-500">
                    Lattice parameter and chemical composition analysis (TiCN 111).
                </p>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {/* Input Section */}
                <div className="grid grid-cols-1 gap-4">
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                        <label className="block text-[10px] text-slate-400 uppercase font-black mb-1">X-Ray Wavelength (λ)</label>
                        <input
                            type="number"
                            step="0.000001"
                            value={lambda}
                            onChange={(e) => onLambdaChange(parseFloat(e.target.value))}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                        />
                    </div>

                    <div className={`p-4 rounded-xl border cursor-pointer transition-all hover:border-emerald-400 group ${selectedTwoTheta !== null ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100'}`}
                        onClick={() => onSetMode('select')}
                    >
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-[10px] text-slate-400 uppercase font-black group-hover:text-emerald-500 transition-colors">Selected 2θ (Click to select)</label>
                            <MousePointerClick size={12} className="text-slate-400 group-hover:text-emerald-500" />
                        </div>
                        <div className="flex items-center justify-between">
                            <span className={`text-2xl font-mono font-bold ${selectedTwoTheta !== null ? 'text-emerald-700' : 'text-slate-300'}`}>
                                {selectedTwoTheta !== null ? selectedTwoTheta.toFixed(2) : '00.00'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Batch Results Table */}
                {batchResults.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-black">
                            <Layers size={14} />
                            Batch Analysis Results ({batchResults.length} Files)
                        </div>
                        <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                    <tr>
                                        <th className="px-3 py-2">File</th>
                                        <th className="px-3 py-2 text-right">C / N (%)</th>
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
                                                ? 'bg-emerald-100/50 border-l-2 border-l-emerald-500'
                                                : 'hover:bg-emerald-50/30'
                                                }`}
                                        >
                                            <td className="px-3 py-2 font-medium text-slate-600 truncate max-w-[120px]" title={res.filename}>
                                                {res.filename}
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-bold">
                                                <span className="text-emerald-700">{(res.c * 100).toFixed(2)}</span>
                                                <span className="text-slate-300 mx-1">/</span>
                                                <span className="text-teal-600">{(res.n * 100).toFixed(2)}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Detailed Results Section (for Active Selection) */}
                {latticeA !== null && cnResults && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                        <div className="bg-emerald-900 rounded-xl p-4 text-white shadow-lg overflow-hidden relative">
                            <label className="block text-[10px] text-emerald-400 uppercase font-black mb-1">Active File Lattice (a)</label>
                            <div className="text-2xl font-mono font-bold">
                                {latticeA.toFixed(6)} <span className="text-xs font-normal text-emerald-300/60 ml-1">Å</span>
                            </div>
                        </div>

                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 relative overflow-hidden">
                            <p className="text-[10px] text-emerald-600 font-black uppercase tracking-wider mb-1">Estimated Chemical Formula</p>
                            <p className="text-lg font-bold text-emerald-900">Ti(C<sub>{cnResults.cPercentage.toFixed(2)}</sub>N<sub>{cnResults.nPercentage.toFixed(2)}</sub>)</p>
                            <div className="absolute bottom-0 left-0 h-1 bg-emerald-500 transition-all duration-700" style={{ width: `${cnResults.cPercentage * 100}%` }} />
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
                            ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:scale-[1.02] active:scale-[0.98]'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                    <Download size={18} />
                    Excel Download
                </button>
            </div>
        </div>
    );
};

export default React.memo(CNRatioConfigurator);

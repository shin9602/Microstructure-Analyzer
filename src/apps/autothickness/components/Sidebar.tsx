import React, { useState, useEffect } from 'react';
import {
    FolderOpen, Settings, Info, Minus, Square, TrendingUp, Columns, MousePointer2, Layers, Microscope, ScanLine, Download
} from 'lucide-react';
import type { CalibrationManager } from '../services/CalibrationManager';
import type { ImageManager } from '../services/ImageManager';

interface SidebarProps {
    currentTool: string | null;
    setTool: (tool: string | null) => void;
    calibrationManager: CalibrationManager;
    onLoadImage: () => void;
    onCalibrationClick: () => void;
    onAnalysisModeChange: (mode: string) => void;
    onExport: () => void;
    onClear: () => void;
    onBatchAnalyze: () => void;
    onLineExport: () => void;
    analysisMode: string;
    onBrightnessChange: (v: number) => void;
    onContrastChange: (v: number) => void;
    brightness: number;
    contrast: number;
    onCalibrationFileLoad: (file: File) => void;
    onUndoClick: () => void;
    onRedoClick: () => void;
    alStartThreshold: number;
    alEndThreshold: number;
    onAlStartThresholdChange: (v: number) => void;
    onAlEndThresholdChange: (v: number) => void;
    calibrationVersion: number;
    onAutoAnalyze: () => void;
    onCalibrationChange: () => void;
    appMode: 'om' | 'sem';
    onAppModeChange: (mode: 'om' | 'sem') => void;
    imageManager: ImageManager;
    onImageManagerChange: () => void;
    microPhaseMode: '2-phase' | '3-phase';
    onMicroPhaseModeChange: (mode: '2-phase' | '3-phase') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    currentTool, setTool, calibrationManager,
    onLoadImage, onCalibrationClick, onAnalysisModeChange,
    onExport, onClear, onBatchAnalyze, onLineExport, analysisMode,
    onBrightnessChange, onContrastChange, brightness, contrast,
    onCalibrationFileLoad,
    onUndoClick, onRedoClick,
    alStartThreshold, alEndThreshold, onAlStartThresholdChange, onAlEndThresholdChange,
    calibrationVersion, onAutoAnalyze, onCalibrationChange,
    appMode, onAppModeChange,
    imageManager,
    onImageManagerChange,
    microPhaseMode,
    onMicroPhaseModeChange
}) => {
    const [presets, setPresets] = useState<Record<string, any>>({});
    const [selectedPreset, setSelectedPreset] = useState('');

    // Load presets
    useEffect(() => {
        setPresets(calibrationManager.getPresets());
    }, [calibrationManager, calibrationVersion]);

    const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const name = e.target.value;
        setSelectedPreset(name);
        if (name) {
            calibrationManager.loadPreset(name);
        }
    };

    const handleSavePreset = () => {
        const name = prompt('프리셋 이름을 입력하세요:', calibrationManager.notes || '새 프리셋');
        if (name) {
            if (calibrationManager.savePreset(name)) {
                setPresets(calibrationManager.getPresets());
                alert(`프리셋 "${name}"이(가) 저장되었습니다.`);
            }
        }
    };

    const handleDeletePreset = () => {
        if (selectedPreset) {
            if (confirm(`"${selectedPreset}" 프리셋을 삭제하시겠습니까?`)) {
                calibrationManager.deletePreset(selectedPreset);
                setPresets(calibrationManager.getPresets());
                setSelectedPreset('');
            }
        }
    };

    const handleCalFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onCalibrationFileLoad(e.target.files[0]);
            e.target.value = '';
        }
    };

    const toolBtn = (tool: string, label: string, shortcut: string, icon?: React.ReactNode, onClick?: () => void) => (
        <button
            className={`tool-btn ${currentTool === tool ? 'active' : ''}`}
            onClick={onClick || (() => setTool(currentTool === tool ? null : tool))}
            title={`${label} (${shortcut})`}
        >
            {icon && <span className="mr-1">{icon}</span>}
            <span>{label}</span>
            <span className="tool-shortcut">{shortcut}</span>
        </button>
    );

    return (
        <div className="sidebar flex flex-col w-full h-full overflow-y-auto p-4 gap-6 text-xs bg-white text-slate-900">
            {/* Mode Selector: OM / SEM */}
            <div className="section">
                <div className="flex rounded-lg overflow-hidden border border-slate-300 shadow-sm">
                    <button
                        className={`flex-1 py-2.5 px-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${appMode === 'om'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                            }`}
                        onClick={() => onAppModeChange('om')}
                    >
                        <Microscope size={14} />
                        OM 분석
                    </button>
                    <button
                        className={`flex-1 py-2.5 px-3 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${appMode === 'sem'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                            }`}
                        onClick={() => onAppModeChange('sem')}
                    >
                        <ScanLine size={14} />
                        SEM 분석
                    </button>
                </div>
            </div>

            {/* File */}
            <div className="section">
                <div className="section-title text-slate-500 mb-3">이미지 파일</div>
                <button className="btn-primary bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg flex items-center justify-center gap-2 w-full shadow-sm" onClick={onLoadImage}>
                    <FolderOpen size={16} /> 이미지 불러오기
                </button>
            </div>

            {/* Calibration */}
            <div className="section">
                <div className="section-title text-slate-500 mb-3">캘리브레이션</div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-slate-600">캘리브레이션 목록:</span>
                    </div>
                    <select
                        className="w-full bg-white border border-slate-300 text-slate-900 rounded p-1.5 text-xs focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        value={selectedPreset}
                        onChange={handlePresetChange}
                    >
                        <option value="">프리셋 선택...</option>
                        {Object.keys(presets).map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>

                    <div className="flex gap-2">
                        <button className="flex-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 py-1.5 rounded text-[10px] transition-colors shadow-sm flex items-center justify-center gap-1"
                            onClick={() => document.getElementById('cal-file-input')?.click()}
                        >
                            <FolderOpen size={12} className="text-slate-500" /> .cal 로드
                        </button>
                        <input
                            id="cal-file-input"
                            type="file"
                            accept=".cal,.ini"
                            className="hidden"
                            onChange={handleCalFileInput}
                        />

                        <button className="flex-1 bg-white hover:bg-blue-50 text-blue-600 border border-blue-600 py-1.5 rounded text-[10px] transition-colors shadow-sm font-bold"
                            onClick={() => {
                                if (selectedPreset) {
                                    calibrationManager.loadPreset(selectedPreset);
                                    onCalibrationChange();
                                } else {
                                    alert('적용할 프리셋을 선택해주세요.');
                                }
                            }}
                        >적용</button>

                        <button className="flex-1 bg-white hover:bg-red-50 text-red-500 border border-red-200 py-1.5 rounded text-[10px] transition-colors shadow-sm font-bold"
                            onClick={handleDeletePreset}
                        >삭제</button>
                    </div>
                    <div className="text-slate-600 text-[11px] bg-white p-2 rounded border border-slate-200">
                        <div className="font-mono text-slate-800 font-bold">{(calibrationManager.pixelsPerUnit || 0).toFixed(4)} px/{calibrationManager.unit}</div>
                        <div className="text-slate-500 mt-1 truncate">{calibrationManager.notes}</div>
                    </div>
                </div>
            </div>

            {/* Tools */}
            <div className="section">
                <div className="section-title text-slate-500 mb-3">측정 도구</div>
                <div className="flex flex-col gap-2">
                    {toolBtn('line', '선 측정', 'L', <Minus className="-rotate-45" size={16} />)}

                    {appMode === 'om' && (
                        <>
                            {toolBtn('rectangle', '사각형 측정', 'R', <Square size={16} />)}

                            <div className="my-2 border-t border-slate-200"></div>

                            {/* Parallel tool removed as requested */}

                            <button
                                className="btn-primary bg-indigo-600 hover:bg-indigo-700 border-none py-2 px-4 rounded-lg flex items-center justify-center gap-2 w-full text-white shadow-sm"
                                onClick={onAutoAnalyze}
                            >
                                <MousePointer2 size={16} /> 두께 자동분석
                            </button>

                            <button
                                className="btn-primary bg-emerald-600 hover:bg-emerald-700 border-none py-2 px-4 rounded-lg flex items-center justify-center gap-2 w-full text-white shadow-sm"
                                onClick={onBatchAnalyze}
                            >
                                <Layers size={16} /> 일괄 자동분석 (전체)
                            </button>

                            <button
                                className="btn-primary bg-blue-600 hover:bg-blue-700 border-none py-2 px-4 rounded-lg flex items-center justify-center gap-2 w-full text-white shadow-sm"
                                onClick={onLineExport}
                            >
                                <Download size={16} /> 선 측정 일괄 다운로드
                            </button>
                        </>
                    )}

                    {appMode === 'sem' && (
                        <>
                            {toolBtn('profile', '조도 분석', 'P', <TrendingUp size={16} />)}
                            {toolBtn('microstructure', 'SEM 미세구조 분석', 'M', <Microscope size={16} />)}
                            
                            {/* Phase Mode Pre-selector (Appears when microstructure tool is active) */}
                            {currentTool === 'microstructure' && (
                                <div className="mt-2 bg-blue-50 border border-blue-100 rounded-lg p-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <p className="text-[10px] font-bold text-blue-700 mb-2 flex items-center gap-1.5">
                                        <Layers size={12} /> 분석 체계 선택
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button 
                                            onClick={() => onMicroPhaseModeChange('2-phase')}
                                            className={`py-1.5 rounded border text-[10px] font-bold transition-all ${microPhaseMode === '2-phase' 
                                                ? 'bg-blue-600 border-blue-600 text-white shadow-sm' 
                                                : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'}`}
                                        >
                                            2상 (WC-Co)
                                        </button>
                                        <button 
                                            onClick={() => onMicroPhaseModeChange('3-phase')}
                                            className={`py-1.5 rounded border text-[10px] font-bold transition-all ${microPhaseMode === '3-phase' 
                                                ? 'bg-blue-600 border-blue-600 text-white shadow-sm' 
                                                : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'}`}
                                        >
                                            3상 (+γ상)
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-blue-500 mt-2 leading-tight opacity-80">
                                        * 분석 전 선택하면 지정한 체계로 ROI를 분석합니다.
                                    </p>
                                </div>
                            )}

                            <div className="my-2 border-t border-slate-200"></div>

                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-700 text-[10px]">
                                <p className="font-bold mb-1">SEM 분석 모드</p>
                                <p>조도 분석: 영역의 프로파일과 Ra, Rq 등을 계산합니다.</p>
                                <p className="mt-1">SEM 미세구조: 흑백 명암(GMM) 기반으로 WC/Co 상을 분리합니다.</p>
                            </div>
                        </>
                    )}
                </div>
            </div>



            {/* Analysis Settings - Removed as requested */}
            {/* View Controls - Removed as requested */}
            {/* Actions - Removed as requested */}
        </div>
    );
};

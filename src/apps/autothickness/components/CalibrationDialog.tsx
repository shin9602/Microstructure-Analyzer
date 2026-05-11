import React, { useState, useEffect, useRef } from 'react';
import { Ruler, Download, Save, X } from 'lucide-react';

interface CalibrationDialogProps {
    pixelLength: number;
    onConfirm: (realLength: number, unit: string, name: string) => void;
    onCancel: () => void;
}

const CalibrationDialog: React.FC<CalibrationDialogProps> = ({ pixelLength, onConfirm, onCancel }) => {
    const [realLength, setRealLength] = useState('');
    const [unit, setUnit] = useState('µm');
    const [name, setName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleConfirm = () => {
        const val = parseFloat(realLength);
        if (!val || val <= 0) return;
        onConfirm(val, unit, name || `캘리브레이션 ${new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}`);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') onCancel();
    };

    const pixPerUnit = realLength && parseFloat(realLength) > 0
        ? (pixelLength / parseFloat(realLength)).toFixed(4)
        : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onKeyDown={handleKeyDown}>
            <div className="bg-white rounded-2xl shadow-2xl w-[400px] overflow-hidden animate-fade-in">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white">
                        <Ruler size={18} />
                        <span className="font-bold text-sm">캘리브레이션 설정</span>
                    </div>
                    <button onClick={onCancel} className="text-white/70 hover:text-white transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Pixel info */}
                    <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
                        <span className="text-xs text-slate-500 font-medium">측정된 선 길이</span>
                        <span className="font-mono font-bold text-slate-800 text-sm">{pixelLength.toFixed(1)} px</span>
                    </div>

                    {/* Real length input */}
                    <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                            실제 길이
                        </label>
                        <div className="flex gap-2">
                            <input
                                ref={inputRef}
                                type="number"
                                value={realLength}
                                onChange={e => setRealLength(e.target.value)}
                                placeholder="예: 100"
                                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <select
                                value={unit}
                                onChange={e => setUnit(e.target.value)}
                                className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                            >
                                <option value="µm">µm</option>
                                <option value="nm">nm</option>
                                <option value="mm">mm</option>
                                <option value="px">px</option>
                            </select>
                        </div>
                    </div>

                    {/* Name input */}
                    <div>
                        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                            프리셋 이름 <span className="text-slate-400 font-normal normal-case">(선택)</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="예: SEM 500X"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    {/* Preview */}
                    {pixPerUnit && (
                        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700 font-medium">
                            1 {unit} = <span className="font-mono font-bold">{pixPerUnit}</span> px
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!realLength || parseFloat(realLength) <= 0}
                        className="flex-2 flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                    >
                        <Save size={15} />
                        저장 + 등록
                    </button>
                    <button
                        onClick={() => {
                            const val = parseFloat(realLength);
                            if (!val || val <= 0) return;
                            onConfirm(val, unit, name || `캘리브레이션_${Date.now()}`);
                        }}
                        disabled={!realLength || parseFloat(realLength) <= 0}
                        title=".cal 파일 다운로드"
                        className="px-3 py-2.5 rounded-xl border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Download size={15} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CalibrationDialog;

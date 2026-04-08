import React, { useEffect } from 'react';
import type { PeakDefinition } from '../types';
import { Info, MousePointerClick, Plus, Trash2, Save, RotateCcw } from 'lucide-react';

interface PeakConfiguratorProps {
  definitions: PeakDefinition[];
  activePlane: string | null;
  onSetActivePlane: (plane: string | null) => void;
  onUpdateRange: (plane: string, type: 'min' | 'max', value: number) => void;
  onUpdateDefinition: (updatedDef: PeakDefinition) => void;
  onAddPeak: () => void;
  onRemovePeak: (plane: string) => void;
  onSavePreset: () => void;
  onResetPreset: () => void;
  onCalculate: () => void;
  formula: string;
  onFormulaChange: (formula: string) => void;
  materialName?: string;
}

const PeakConfigurator: React.FC<PeakConfiguratorProps> = ({
  definitions,
  activePlane,
  onSetActivePlane,
  onUpdateRange,
  onUpdateDefinition,
  onAddPeak,
  onRemovePeak,
  onSavePreset,
  onResetPreset,
  onCalculate,
  formula,
  onFormulaChange,
  materialName
}) => {

  // Helper to check if all ranges are valid
  const isValid = definitions.length > 0 && definitions.every(d => d.range.max > d.range.min && d.range.min > 0);

  // Auto-calculate whenever definitions change and are valid
  useEffect(() => {
    if (isValid) {
      const timer = setTimeout(() => {
        onCalculate();
      }, 500); // Debounce lightly to prevent excessive calculations during typing
      return () => clearTimeout(timer);
    }
  }, [definitions, isValid, onCalculate]);


  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-full flex flex-col">
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            {materialName ? `${materialName} Peaks` : 'Peak Settings'}
            <div className="group relative">
              <Info size={16} className="text-slate-400 cursor-help" />
              <div className="absolute right-0 bottom-6 hidden group-hover:block w-64 p-2 bg-slate-800 text-white text-xs rounded shadow-lg z-50">
                Edit plane names, reference intensities, and ranges.
                <br /><br />
                <strong>Save Preset:</strong> Saves these settings permanently for this material type.
              </div>
            </div>
          </h3>
          <div className="flex gap-2">
            <button
              onClick={onResetPreset}
              className="p-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 transition-colors"
              title="Reset to Factory Defaults"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={onSavePreset}
              className="p-1.5 bg-emerald-50 text-emerald-600 rounded-md hover:bg-emerald-100 transition-colors flex items-center gap-1 px-2"
              title="Save current settings as default for this material"
            >
              <Save size={16} />
              <span className="text-xs font-medium">Save</span>
            </button>
            <button
              onClick={onAddPeak}
              className="p-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
              title="Add new peak (+)"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Select a row to activate dragging on chart.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
        {definitions.map((def) => {
          const isActive = activePlane === def.plane;
          return (
            <div
              key={def.id}
              onClick={() => onSetActivePlane(isActive ? null : def.plane)}
              className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all group
                ${isActive
                  ? 'bg-blue-50 border-blue-500 shadow-sm ring-1 ring-blue-500'
                  : 'bg-slate-50 border-slate-100 hover:border-slate-300'
                }`}
            >
              {/* Row Header: Plane Name & Ref Intensity */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1">
                  <label className="block text-[10px] text-slate-400 uppercase font-bold mb-0.5">Plane</label>
                  <input
                    type="text"
                    value={def.plane}
                    onChange={(e) => onUpdateDefinition({ ...def, plane: e.target.value })}
                    className={`w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm font-mono font-bold focus:ring-1 focus:ring-blue-500 outline-none
                      ${isActive ? 'text-blue-700' : 'text-slate-700'}
                    `}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="w-20">
                  <label className="block text-[10px] text-slate-400 uppercase font-bold mb-0.5">Ref. Int</label>
                  <input
                    type="number"
                    value={def.referenceIntensity}
                    onChange={(e) => onUpdateDefinition({ ...def, referenceIntensity: parseFloat(e.target.value) })}
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="w-20">
                  <label className="block text-[10px] text-slate-400 uppercase font-bold mb-0.5">Theo. 2θ</label>
                  <input
                    type="number"
                    step="0.1"
                    value={def.theoreticalPos || ''}
                    onChange={(e) => {
                      const theoPos = parseFloat(e.target.value);
                      if (!isNaN(theoPos)) {
                        // Auto-set range to ±0.05
                        onUpdateDefinition({
                          ...def,
                          theoreticalPos: theoPos,
                          range: {
                            min: Math.max(0, theoPos - 0.05),
                            max: theoPos + 0.05
                          }
                        });
                      } else {
                        onUpdateDefinition({ ...def, theoreticalPos: theoPos });
                      }
                    }}
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <div className="w-6 flex items-end justify-center pb-1">
                  {isActive ? (
                    <MousePointerClick size={16} className="text-blue-500 animate-pulse" />
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemovePeak(def.plane); }}
                      className="text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* Ranges */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-white rounded border border-slate-200 px-2 py-1 w-full">
                  <span className="text-[10px] text-slate-400 mr-2">MIN</span>
                  <input
                    type="number"
                    step="0.1"
                    value={def.range.min || ''}
                    onChange={(e) => onUpdateRange(def.plane, 'min', parseFloat(e.target.value))}
                    className="w-full text-sm outline-none text-slate-700 font-medium"
                    placeholder="0.0"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <span className="text-slate-400">-</span>
                <div className="flex items-center bg-white rounded border border-slate-200 px-2 py-1 w-full">
                  <span className="text-[10px] text-slate-400 mr-2">MAX</span>
                  <input
                    type="number"
                    step="0.1"
                    value={def.range.max || ''}
                    onChange={(e) => onUpdateRange(def.plane, 'max', parseFloat(e.target.value))}
                    className="w-full text-sm outline-none text-slate-700 font-medium"
                    placeholder="0.0"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>
          );
        })}

        {definitions.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
            No peaks defined.<br />Click + to add one.
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100">
        {!isValid && definitions.length > 0 && (
          <p className="text-xs text-red-400 text-center mt-2">
            Define ranges for all planes to proceed.
          </p>
        )}
      </div>
    </div>
  );
};

export default React.memo(PeakConfigurator);
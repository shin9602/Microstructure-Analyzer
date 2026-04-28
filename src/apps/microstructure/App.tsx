import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ZoomIn, Plus, Trash2, Calculator, UploadCloud, Activity, Menu, Home, Ruler, BarChart3, GripHorizontal } from 'lucide-react';

import { MATERIALS } from './constants';
import { AppStep, AnalysisMode } from './types';
import type { PeakDefinition, FileResult, ParsedFile } from './types';
import { parseXRDFile, parseXRDMLFile, calculateTC, presetToDefinitions, calculateLatticeParameter, calculateCNRatioResult, findPeakInTwoThetaRange, calculateFWHM, calculateGrainSize, calculateWilliamsonHall } from './services/xrdProcessing';
import ChartViewer from './components/ChartViewer';
import PeakConfigurator from './components/PeakConfigurator';
import CNRatioConfigurator from './components/CNRatioConfigurator';
import GrainSizeConfigurator from './components/GrainSizeConfigurator';
import ResultsTable from './components/ResultsTable';
import { v4 as uuidv4 } from 'uuid';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const STORAGE_KEY = 'xrd_materials_v5';
const CUSTOM_MATERIALS_KEY = 'xrd_custom_materials_v5';

interface AppProps {
  onBack?: () => void;
}

const App: React.FC<AppProps> = ({ onBack }) => {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);

  // Materials Management State
  const [activeMaterialId, setActiveMaterialId] = useState<string>('Al2O3_alpha');
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false);
  const [visibleReferenceMaterials, setVisibleReferenceMaterials] = useState<string[]>(['Al2O3_alpha']);
  const [customMaterials, setCustomMaterials] = useState<Record<string, { name: string }>>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_MATERIALS_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load custom materials:', e);
    }
    return {};
  });

  // Store peak definitions for ALL materials
  // Load from localStorage if available, otherwise initialize from constants
  const [materialDefinitions, setMaterialDefinitions] = useState<Record<string, PeakDefinition[]>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          // Merge with constants to ensure new materials from constants are available
          const merged = { ...parsed };
          Object.keys(MATERIALS).forEach(matId => {
            if (!merged[matId]) {
              merged[matId] = presetToDefinitions(MATERIALS[matId]);
            }
          });
          return merged;
        }
      }
    } catch (e) {
      console.error('Failed to load saved materials:', e);
    }

    // Fallback: initialize from constants
    const initialDefs: Record<string, PeakDefinition[]> = {};
    Object.keys(MATERIALS).forEach(matId => {
      const preset = MATERIALS[matId];
      initialDefs[matId] = presetToDefinitions(preset);
    });
    return initialDefs;
  });

  const activeDefinitions = materialDefinitions[activeMaterialId] || [];

  // Files state
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  // Patch missing IDs and force update if outdated (TiCN count or wide ranges)
  useEffect(() => {
    setMaterialDefinitions(prev => {
      let hasChanges = false;
      const next = { ...prev };

      // 1. Patch IDs
      Object.keys(next).forEach(key => {
        const defs = next[key];
        if (defs.some(d => !d.id)) {
          hasChanges = true;
          next[key] = defs.map(d => d.id ? d : { ...d, id: uuidv4() });
        }
      });

      // 2. Force update TiCN if peak count doesn't match constants
      const ticnRef = MATERIALS['TiCN'];
      if (next['TiCN'] && next['TiCN'].length !== Object.keys(ticnRef.references).length) {
        hasChanges = true;
        next['TiCN'] = presetToDefinitions(ticnRef);
      }

      // 3. Force update if ranges are too wide (legacy 1.0 width, we want 0.5)
      const alphaDefs = next['Al2O3_alpha'];
      if (alphaDefs && alphaDefs.length > 0) {
        const firstRange = alphaDefs[0].range;
        if ((firstRange.max - firstRange.min) > 0.6) {
          hasChanges = true;
          // Re-generate ALL standard materials to ensure new ranges are applied
          Object.keys(MATERIALS).forEach(matId => {
            next[matId] = presetToDefinitions(MATERIALS[matId]);
          });
        }
      }

      return hasChanges ? next : prev;
    });
  }, []);

  // Analysis State
  const [results, setResults] = useState<FileResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formula, setFormula] = useState<string>('ratio / avgRatio');

  // UI State
  const [activePlane, setActivePlane] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Layout Resizing State
  const [gridHeight, setGridHeight] = useState<number>(800);
  const [isResizingGrid, setIsResizingGrid] = useState(false);

  // Lifted mode state from ChartViewer
  const [chartMode, setChartMode] = useState<'pan' | 'select' | 'zoom'>('pan');
  const [notification, setNotification] = useState<string | null>(null);

  // C/N Calculator State
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(AnalysisMode.TC);
  const [lambda, setLambda] = useState<number>(1.541874);
  const [cnTwoTheta, setCnTwoTheta] = useState<number>(0);
  const [cnBatchResults, setCnBatchResults] = useState<any[]>([]);
  const [cnRange, setCnRange] = useState<{ min: number; max: number } | null>(null);

  const [isOverlapMode, setIsOverlapMode] = useState(false);
  const [selectedOverlapFileIds, setSelectedOverlapFileIds] = useState<string[]>([]);

  // Use files directly

  const updateFileShift = (fileId: string, shift: number) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, twoThetaShift: shift } : f));
  };

  const updateFileYOffset = (fileId: string, offset: number) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, yOffset: offset } : f));
  };

  const updateFileOpacity = (fileId: string, opacity: number) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, opacity } : f));
  };



  const cnFixedRange = useMemo<[number, number] | null>(() => {
    return analysisMode === AnalysisMode.CN_RATIO ? [35, 40] : null;
  }, [analysisMode]);

  // Grain Size State
  const [kFactor, setKFactor] = useState<number>(0.9);
  const [gsBatchResults, setGsBatchResults] = useState<any[]>([]);
  const [gsRange, setGsRange] = useState<{ min: number; max: number } | null>(null);
  const [gsWHAnalysis, setGsWHAnalysis] = useState<any>(null);
  const [gsWHExcludedPeaks, setGsWHExcludedPeaks] = useState<Set<string>>(new Set());
  const [gsFWHMData, setGsFWHMData] = useState<{
    fwhm: number;
    peak2Theta: number;
    left2Theta: number;
    right2Theta: number;
    halfMax: number;
  } | null>(null);



  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 2000);
  };

  const menuRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);

  // Grid Resize Handlers
  const handleGridResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingGrid(true);
  };

  useEffect(() => {
    const handleGridResizeMove = (e: MouseEvent) => {
      if (!isResizingGrid || !gridRef.current) return;

      const newHeight = e.clientY - gridRef.current.getBoundingClientRect().top;
      // Constraints: Min 400px, Max 1200px
      if (newHeight >= 400 && newHeight <= 1200) {
        setGridHeight(newHeight);
      }
    };

    const handleGridResizeEnd = () => {
      setIsResizingGrid(false);
    };

    if (isResizingGrid) {
      window.addEventListener('mousemove', handleGridResizeMove);
      window.addEventListener('mouseup', handleGridResizeEnd);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleGridResizeMove);
      window.removeEventListener('mouseup', handleGridResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingGrid]);  // Save materialDefinitions to local storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(materialDefinitions));
  }, [materialDefinitions]);

  // Ensure activePlane is null on mount (User Request)
  useEffect(() => {
    setActivePlane(null);
  }, []);

  // Save customMaterials to local storage
  useEffect(() => {
    localStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(customMaterials));
  }, [customMaterials]);

  // Auto-recalculate WH analysis when excluded peaks change
  useEffect(() => {
    if (gsWHAnalysis && activeFileId) {
      const file = files.find(f => f.id === activeFileId);
      if (file) {
        // Apply shift manually for calculation
        const shift = file.twoThetaShift ?? 0;
        const shiftedData = shift
          ? file.data.map(p => ({ ...p, twoTheta: p.twoTheta + shift }))
          : file.data;
        const whResult = calculateWilliamsonHall(activeDefinitions, shiftedData, lambda, kFactor, gsWHExcludedPeaks);
        if (whResult) {
          setGsWHAnalysis(whResult);
        }
      }
    }
  }, [gsWHExcludedPeaks, files, activeFileId]);

  // Load from storage on mount (optional, or rely on initial state logic if we want to persist user edits)
  // For now, let's stick to the initialized state from constants to ensure new constants are picked up,
  // or implement a merge strategy. Given the user request, let's prioritize the constants for now 
  // but allow runtime edits. If we want strict persistence of edits across reloads, we'd need to load here.
  // Let's skip complex persistence for now and focus on runtime state.

  // --- Handlers ---

  const handleAddMaterial = () => {
    const name = prompt("Enter new material name:");
    if (name) {
      const id = `custom_${Date.now()}`;
      setCustomMaterials(prev => ({ ...prev, [id]: { name } }));
      setMaterialDefinitions(prev => ({ ...prev, [id]: [] }));
      setActiveMaterialId(id);
      setVisibleReferenceMaterials(prev => [...prev, id]);
    }
  };

  const handleRemoveMaterial = () => {
    if (confirm("Are you sure you want to remove this material?")) {
      setCustomMaterials(prev => {
        const next = { ...prev };
        delete next[activeMaterialId];
        return next;
      });
      setMaterialDefinitions(prev => {
        const next = { ...prev };
        delete next[activeMaterialId];
        return next;
      });
      setVisibleReferenceMaterials(prev => prev.filter(id => id !== activeMaterialId));
      setActiveMaterialId('Al2O3_alpha');
    }
  };

  const handleUpdateDefinition = useCallback((updatedDef: PeakDefinition) => {
    setMaterialDefinitions(prev => {
      const currentDefs = prev[activeMaterialId];
      const oldDef = currentDefs.find(d => d.id === updatedDef.id);

      if (oldDef && activePlane === oldDef.plane && oldDef.plane !== updatedDef.plane) {
        setActivePlane(updatedDef.plane);
      }

      return {
        ...prev,
        [activeMaterialId]: currentDefs.map(def =>
          def.id === updatedDef.id ? updatedDef : def
        )
      };
    });
  }, [activeMaterialId, activePlane]);

  const toggleReferenceVisibility = (matId: string) => {
    setVisibleReferenceMaterials(prev =>
      prev.includes(matId)
        ? prev.filter(id => id !== matId)
        : [...prev, matId]
    );
  };

  const handleMaterialChange = (matId: string) => {
    setActiveMaterialId(matId);
    // Auto-show if not visible
    if (!visibleReferenceMaterials.includes(matId)) {
      setVisibleReferenceMaterials(prev => [...prev, matId]);
    }
  };

  const updateRange = useCallback((plane: string, type: 'min' | 'max', value: number) => {
    setMaterialDefinitions(prev => {
      const currentDefs = prev[activeMaterialId];
      const newDefs = currentDefs.map(def => {
        if (def.plane === plane) {
          return { ...def, range: { ...def.range, [type]: value } };
        }
        return def;
      });
      return { ...prev, [activeMaterialId]: newDefs };
    });
  }, [activeMaterialId]);


  const addPeak = useCallback(() => {


    setMaterialDefinitions(prev => {
      const currentDefs = prev[activeMaterialId];
      const newPlaneName = `New(${currentDefs.length + 1})`;
      const newDef: PeakDefinition = {
        id: uuidv4(),
        plane: newPlaneName,
        referenceIntensity: 100,
        range: { min: 20, max: 30 },
        theoreticalPos: 25
      };

      setActivePlane(newPlaneName); // Highlight the new peak
      return { ...prev, [activeMaterialId]: [...currentDefs, newDef] };
    });

    // Switch to Select mode so user can immediately adjust the range
    setChartMode('select');
    showNotification('New Peak Added - Drag on Chart to Adjust');
  }, [activeMaterialId]);

  // Keyboard shortcut for Zoom Mode (z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'z' || e.key === 'Z' || e.key === 'ㅋ' || e.code === 'KeyZ') {
        e.preventDefault();
        setChartMode('zoom');
        showNotification('Zoom Mode Enabled');
      }
      if (e.key === 'Escape') {
        setChartMode('pan');
        setActivePlane(null);
        setCnTwoTheta(0);
        setGsFWHMData(null);
        showNotification('Selection Cleared');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);



  // Wrapper for setting active plane to handle mode switching
  const handleSetActivePlane = useCallback((plane: string | null) => {
    setActivePlane(plane);
    if (plane) {
      setChartMode('select');
    } else {
      setChartMode('pan');
    }
  }, []);

  const removePeak = useCallback((plane: string) => {
    setMaterialDefinitions(prev => {
      const currentDefs = prev[activeMaterialId];
      return { ...prev, [activeMaterialId]: currentDefs.filter(d => d.plane !== plane) };
    });
    if (activePlane === plane) {
      setActivePlane(null);
    }
  }, [activeMaterialId, activePlane]);

  const handleChartRangeSelect = (min: number, max: number) => {
    if (analysisMode === AnalysisMode.TC) {
      if (activePlane) {
        updateRange(activePlane, 'min', min);
        updateRange(activePlane, 'max', max);
      }
    } else if (analysisMode === AnalysisMode.CN_RATIO) {
      if (activeFileId) {
        const file = files.find(f => f.id === activeFileId);
        if (file) {
          const shift = file.twoThetaShift || 0;
          const shiftedData = shift ? file.data.map(p => ({ ...p, twoTheta: p.twoTheta + shift })) : file.data;
          const peakPos = findPeakInTwoThetaRange(shiftedData, min, max);
          if (peakPos !== null) {
            setCnTwoTheta(peakPos);
          } else {
            setCnTwoTheta((min + max) / 2);
          }
          // Perform batch calculation for all files based on this range
          const batch = handleBatchCalculateCN(min, max);
          setCnBatchResults(batch);
          setCnRange({ min, max });
          // Auto-return to pan mode
          setChartMode('pan');
        }
      }
    } else if (analysisMode === AnalysisMode.GRAIN_SIZE) {
      if (activeFileId) {
        const file = files.find(f => f.id === activeFileId);
        if (file) {
          const shift = file.twoThetaShift || 0;
          const shiftedData = shift ? file.data.map(p => ({ ...p, twoTheta: p.twoTheta + shift })) : file.data;
          const res = calculateFWHM(shiftedData, min, max);
          if (res) {
            setGsFWHMData(res);
            setCnTwoTheta(res.peak2Theta); // Pointer position for consistency
 
            // Perform batch calculation
            const batch = handleBatchCalculateGS(min, max);
            setGsBatchResults(batch);
            setGsRange({ min, max });
          }
          setChartMode('pan');
        }
      }
    }
  };


  const handleBatchCalculateGS = (min: number, max: number) => {
    return files.map(file => {
      const shift = file.twoThetaShift || 0;
      const shiftedData = shift ? file.data.map(p => ({ ...p, twoTheta: p.twoTheta + shift })) : file.data;
      const res = calculateFWHM(shiftedData, min, max);
      if (!res) return { fileId: file.id, filename: file.name, status: 'Error' };

      const grainSize = calculateGrainSize(kFactor, lambda, res.fwhm, res.peak2Theta);
      return {
        fileId: file.id,
        filename: file.name,
        peak2Theta: res.peak2Theta,
        fwhm: res.fwhm,
        grainSize: grainSize,
        fwhmData: res,
        status: 'OK'
      };
    });
  };

  const handleBatchCalculateCN = (min2Theta: number, max2Theta: number) => {
    const batchResults = files.map(file => {
      const shift = file.twoThetaShift || 0;
      const shiftedData = shift ? file.data.map(p => ({ ...p, twoTheta: p.twoTheta + shift })) : file.data;
      const peakPos = findPeakInTwoThetaRange(shiftedData, min2Theta, max2Theta);
      if (peakPos === null) return { fileId: file.id, filename: file.name, a: 0, c: 0, n: 0, status: 'Error' };

      const a = calculateLatticeParameter(lambda, 1, 1, 1, peakPos);
      const res = calculateCNRatioResult(a);
      return {
        fileId: file.id,
        filename: file.name,
        twoTheta: peakPos,
        a: a,
        c: res.cPercentage,
        n: res.nPercentage,
        status: 'OK'
      };
    });
    return batchResults;
  };

  // --- Auto-Sync Effects ---

  // Sync analysis markers and data when active file changes
  useEffect(() => {
    if (!activeFileId) return;

    if (analysisMode === AnalysisMode.CN_RATIO && cnRange) {
      const entry = cnBatchResults.find(r => r.fileId === activeFileId);
      if (entry && entry.status === 'OK') {
        setCnTwoTheta(entry.twoTheta);
      }
    } else if (analysisMode === AnalysisMode.GRAIN_SIZE && gsRange) {
      const entry = gsBatchResults.find(r => r.fileId === activeFileId);
      if (entry && entry.status === 'OK' && entry.fwhmData) {
        setGsFWHMData(entry.fwhmData);
      }
    }
  }, [activeFileId, analysisMode, cnBatchResults, gsBatchResults, cnRange, gsRange]);

  // Re-calculate CN batch when lambda changes
  useEffect(() => {
    if (analysisMode === AnalysisMode.CN_RATIO && cnRange) {
      const batch = handleBatchCalculateCN(cnRange.min, cnRange.max);
      setCnBatchResults(batch);
    }
  }, [lambda, files]);

  // Re-calculate Grain Size batch when parameters change
  useEffect(() => {
    if (analysisMode === AnalysisMode.GRAIN_SIZE && gsRange) {
      const batch = handleBatchCalculateGS(gsRange.min, gsRange.max);
      setGsBatchResults(batch);
    }
  }, [lambda, kFactor, files]);

  // --- File Handlers ---

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const newFiles: ParsedFile[] = [];
    const errors: string[] = [];
    let processedCount = 0;

    (Array.from(fileList) as File[]).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const isXRDML = file.name.toLowerCase().endsWith('.xrdml');
          const { data, normalizationFactor, wavelength } = isXRDML
            ? parseXRDMLFile(content)
            : parseXRDFile(content);

          if (wavelength && wavelength.kAlpha1 > 0) {
            setLambda(wavelength.kAlpha1);
            showNotification(`Wavelength updated from file: ${wavelength.kAlpha1} Å`);
          }

          newFiles.push({
            id: uuidv4(),
            name: file.name,
            data,
            normalizationFactor,
            twoThetaShift: 0
          });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          errors.push(`${file.name}: ${errorMessage} `);
        } finally {
          processedCount++;
          if (processedCount === fileList.length) {
            if (newFiles.length > 0) {
              // Sort files alphabetically by name
              const sortedFiles = [...newFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
              setFiles(sortedFiles);
              setActiveFileId(sortedFiles[0].id);
              setSelectedOverlapFileIds([sortedFiles[0].id]);
              setStep(AppStep.CONFIGURE);
            }
            if (errors.length > 0) {
              setError(`Errors: ${errors.join('; ')} `);
            } else {
              setError(null);
            }
          }
        }
      };
      reader.readAsText(file);
    });
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFiles = event.dataTransfer.files;
    if (droppedFiles.length > 0) {
      // Create a synthetic event
      const syntheticEvent = {
        target: { files: droppedFiles }
      } as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(syntheticEvent);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleCalculate = useCallback(() => {
    try {
      const batchResults: FileResult[] = files.map(file => {
        const shift = file.twoThetaShift || 0;
        const shiftedData = shift ? file.data.map(p => ({ ...p, twoTheta: p.twoTheta + shift })) : file.data;
        const tcs = calculateTC(activeDefinitions, shiftedData, file.normalizationFactor, formula);

        return {
          fileId: file.id,
          fileName: file.name,
          results: tcs
        };
      });

      setResults(batchResults);
      setStep(AppStep.RESULTS);
      setActivePlane(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError('Calculation failed: ' + errorMessage);
    }
  }, [files, activeDefinitions, formula]);

  const handleReset = () => {
    setStep(AppStep.UPLOAD);
    setFiles([]);
    setResults([]);
    setError(null);
    setActivePlane(null);
    setActiveFileId(null);
    setIsMenuOpen(false);
  };

  const handleGoHome = () => {
    if (files.length > 0 && !window.confirm("Going back to home will clear current data. Continue?")) {
      return;
    }
    handleReset();
  };
  const handleFormulaChange = useCallback((newFormula: string) => {
    setFormula(newFormula);
  }, []);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className={`p-2 rounded-lg transition-all ${isMenuOpen ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                <Menu size={24} />
              </button>

              {onBack && (
                <button
                  onClick={onBack}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-all ml-1"
                  title="Back to Launcher"
                >
                  <Home size={24} />
                </button>
              )}

              {isMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="px-4 py-1.5 border-b border-slate-50 mb-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Analysis Methods</p>
                  </div>

                  {[
                    { id: AnalysisMode.TC, name: 'TC Calculator', sub: 'Texture Coefficient Analysis', icon: Calculator, color: 'blue' },
                    { id: AnalysisMode.GRAIN_SIZE, name: 'Grain Size', sub: 'FWHM & Scherrer Analysis', icon: Ruler, color: 'purple' },
                    { id: AnalysisMode.CN_RATIO, name: 'C/N Ratio', sub: 'Lattice & Composition', icon: Activity, color: 'emerald' }
                  ].map(mode => (
                    <button
                      key={mode.id}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-all ${analysisMode === mode.id ? `bg-${mode.color}-50 text-${mode.color}-700 border-l-4 border-${mode.color}-600` : 'hover:bg-slate-50 text-slate-600'}`}
                      onClick={() => {
                        setAnalysisMode(mode.id as AnalysisMode);
                        setIsMenuOpen(false);
                        setChartMode(mode.id === AnalysisMode.TC ? 'pan' : 'select');
                        if (mode.id === AnalysisMode.CN_RATIO && MATERIALS['TiCN']) {
                          setActiveMaterialId('TiCN');
                          if (!visibleReferenceMaterials.includes('TiCN')) setVisibleReferenceMaterials(p => [...p, 'TiCN']);
                        }
                      }}
                    >
                      <div className={`p-1.5 rounded-md shadow-sm bg-white`}>
                        <mode.icon size={18} className={analysisMode === mode.id ? `text-${mode.color}-600` : 'text-slate-400'} />
                      </div>
                      <div>
                        <p className="font-bold text-sm tracking-tight">{mode.name}</p>
                        <p className={`text-[10px] font-medium text-${mode.color}-500`}>{mode.sub}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div
              className="flex items-center gap-3 cursor-pointer select-none group"
              onClick={handleGoHome}
            >
              <div className="bg-blue-600 p-2 rounded-lg shadow-md group-hover:bg-blue-700 transition-all">
                <Activity className="text-white" size={20} />
              </div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-800 tracking-tight">
                  Microstructure Analyzer
                </h1>
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">v5.4</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Material</span>
              <button
                onClick={() => setShowMaterialDropdown(v => !v)}
                className="text-sm font-bold text-slate-700 outline-none cursor-pointer hover:text-blue-600 transition-colors flex items-center gap-1"
              >
                {({ ...MATERIALS, ...customMaterials })[activeMaterialId]?.name ?? activeMaterialId}
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-400"><path d="M1 1l4 4 4-4"/></svg>
              </button>
              {showMaterialDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMaterialDropdown(false)} />
                  <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[220px] py-1">
                    {Object.entries({ ...MATERIALS, ...customMaterials }).map(([key, mat]) => (
                      <button
                        key={key}
                        onClick={() => { handleMaterialChange(key); setShowMaterialDropdown(false); }}
                        className={`w-full text-left px-4 py-2 text-sm font-medium transition-colors ${activeMaterialId === key ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        {mat.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={handleAddMaterial}
              className="p-1.5 bg-white border border-slate-200 rounded text-slate-500 hover:text-blue-600 hover:border-blue-400 transition-colors"
              title="Add new material"
            >
              <Plus size={16} />
            </button>
            {activeMaterialId.startsWith('custom_') && (
              <button
                onClick={handleRemoveMaterial}
                className="p-1.5 bg-white border border-slate-200 rounded text-slate-500 hover:text-red-600 hover:border-red-400 transition-colors"
                title="Remove current material"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 p-4 rounded-xl shadow-sm flex items-start animate-fade-in">
            <div className="flex-1">
              <h3 className="text-red-800 font-bold text-sm tracking-tight">Error</h3>
              <p className="text-red-700 text-xs mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">&times;</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-sm flex items-start animate-fade-in">
            <div className="flex-1">
              <h3 className="text-emerald-800 font-bold text-sm tracking-tight">Success</h3>
              <p className="text-emerald-700 text-xs mt-1">{successMsg}</p>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">&times;</button>
          </div>
        )}

        {/* STEP 1: UPLOAD */}
        {step === AppStep.UPLOAD && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in gap-8">
            <div className="text-center max-w-lg">
              <h2 className="text-3xl font-bold text-slate-900 mb-4">Upload XRD Data</h2>
              <p className="text-slate-500 text-lg">
                Upload your <code>.asc</code>, <code>.txt</code> or <code>.xrdml</code> files to begin analysis.
              </p>
            </div>

            {/* Dropzone */}
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all w-full max-w-2xl cursor-pointer ${isDragging
                ? 'border-blue-500 bg-blue-50 scale-[1.02]'
                : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
                }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-2">
                  <UploadCloud size={32} />
                </div>
                <h3 className="text-xl font-semibold text-slate-900">Drag & Drop Files Here</h3>
                <p className="text-slate-500">or click to browse from your computer</p>
                <input
                  type="file"
                  multiple
                  accept=".asc,.txt,.xrdml"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload-main"
                />
                <label
                  htmlFor="file-upload-main"
                  className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 cursor-pointer shadow-md transition-colors"
                >
                  Browse Files
                </label>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: CONFIGURE & VIEW */}
        <div className="space-y-6">
          {/* Navigation Tabs */}
          {((step === AppStep.CONFIGURE || step === AppStep.RESULTS) && activeFileId) && (
            <div className="flex items-center gap-1 bg-slate-200/50 p-1 rounded-xl w-fit border border-slate-200 mx-auto mb-2 overflow-x-auto max-w-full">
              <button
                onClick={() => {
                  setAnalysisMode(AnalysisMode.TC);
                  setChartMode('pan');
                  setActivePlane(null);
                }}
                className={`px-6 py-2.5 whitespace-nowrap rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${analysisMode === AnalysisMode.TC
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-500 hover:bg-slate-100'
                  }`}
              >
                <Calculator size={18} />
                TC Analysis
              </button>
              <button
                onClick={() => {
                  setAnalysisMode(AnalysisMode.CN_RATIO);
                  setChartMode('pan');
                  if (MATERIALS['TiCN']) {
                    setActiveMaterialId('TiCN');
                    if (!visibleReferenceMaterials.includes('TiCN')) {
                      setVisibleReferenceMaterials(prev => [...prev, 'TiCN']);
                    }
                  }
                }}
                className={`px-6 py-2.5 whitespace-nowrap rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${analysisMode === AnalysisMode.CN_RATIO
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-500 hover:bg-slate-100'
                  }`}
              >
                <Activity size={18} />
                TiCN Composition
              </button>
              <button
                onClick={() => {
                  setAnalysisMode(AnalysisMode.GRAIN_SIZE);
                  setChartMode('pan');
                }}
                className={`px-6 py-2.5 whitespace-nowrap rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${analysisMode === AnalysisMode.GRAIN_SIZE
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-500 hover:bg-slate-100'
                  }`}
              >
                <Ruler size={18} />
                Grain Size
              </button>
            </div>
          )}

          {(step === AppStep.CONFIGURE || step === AppStep.RESULTS) && activeFileId && (
            <div className="space-y-6">
              <div
              ref={gridRef}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-1 overflow-hidden transition-none"
              style={{ height: `${gridHeight || 600}px` }}
            >
              {/* Left Column: Shared Chart Area */}
              <div ref={leftColRef} className="lg:col-span-2 relative h-full overflow-hidden">
                <div className={`h-full bg-white rounded-2xl border flex flex-col overflow-hidden shadow-sm ${analysisMode === AnalysisMode.TC ? 'border-blue-100' : analysisMode === AnalysisMode.CN_RATIO ? 'border-emerald-100' : 'border-purple-100'}`}>
                  <div className="flex-1 bg-white h-full min-h-[500px]">
                    <ChartViewer
                      files={files}
                      activeFileId={activeFileId}
                      onFileChange={setActiveFileId}
                      peakDefinitions={activeDefinitions}
                      activePlane={activePlane}
                      onRangeSelect={handleChartRangeSelect}
                      onClearSelection={() => {
                        setActivePlane(null);
                        setCnTwoTheta(0);
                        setGsFWHMData(null);
                      }}
                      visibleReferenceMaterials={visibleReferenceMaterials}
                      allMaterialDefinitions={materialDefinitions}
                      mode={chartMode}
                      onModeChange={setChartMode}
                      selectedCnTwoTheta={analysisMode === AnalysisMode.CN_RATIO ? cnTwoTheta : null}
                      gsFWHMData={analysisMode === AnalysisMode.GRAIN_SIZE ? gsFWHMData : null}
                      chartFixedRange={cnFixedRange}
                      twoThetaShift={files.find(f => f.id === activeFileId)?.twoThetaShift || 0}
                      onUpdateShift={(shift) => updateFileShift(activeFileId!, shift)}
                      onUpdateFileYOffset={updateFileYOffset}
                      onUpdateFileOpacity={updateFileOpacity}
                      isOverlapMode={isOverlapMode}
                      selectedOverlapFileIds={selectedOverlapFileIds}
                      onToggleOverlap={() => setIsOverlapMode(!isOverlapMode)}
                      onToggleFileSelection={(id) => {
                        setSelectedOverlapFileIds(prev =>
                          prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
                        );
                      }}
                    />
                  </div>
                </div>
                {/* Notification Overlay in Chart Area */}
                {notification && (
                  <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-bold animate-fade-in pointer-events-none z-20 flex items-center gap-2">
                    <ZoomIn size={16} />
                    {notification}
                  </div>
                )}
              </div>

              {/* Right Column: Configuration Area (Context Specific) */}
              <div ref={rightColRef} className="h-full flex flex-col gap-4 overflow-hidden">
                <div className="flex-1 min-h-0 flex flex-col">
                  {analysisMode === AnalysisMode.TC && (step === AppStep.CONFIGURE || step === AppStep.RESULTS) && (
                    <PeakConfigurator
                      materialName={Object.entries({ ...MATERIALS, ...customMaterials }).find(([key]) => key === activeMaterialId)?.[1].name || activeMaterialId}
                      definitions={activeDefinitions}
                      onUpdateDefinition={handleUpdateDefinition}
                      onUpdateRange={updateRange}
                      activePlane={activePlane}
                      onSetActivePlane={handleSetActivePlane}
                      onAddPeak={addPeak}
                      onRemovePeak={removePeak}
                      onSavePreset={() => {
                        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
                        saved[activeMaterialId] = activeDefinitions;
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
                        showNotification('Preset Saved');
                      }}
                      onResetPreset={() => {
                        if (confirm('Reset to default factory settings for this material? This will clear all custom changes.')) {
                          const defaultDef = MATERIALS[activeMaterialId];
                          if (defaultDef) {
                            setMaterialDefinitions(prev => ({
                              ...prev,
                              [activeMaterialId]: presetToDefinitions(defaultDef)
                            }));
                            showNotification('Reset to Defaults');
                          } else {
                            alert('No default preset found for this material.');
                          }
                        }
                      }}
                      onCalculate={handleCalculate}
                      formula={formula}
                      onFormulaChange={handleFormulaChange}
                    />
                  )}

                  {analysisMode === AnalysisMode.CN_RATIO && (
                    <CNRatioConfigurator
                      lambda={lambda}
                      onLambdaChange={setLambda}
                      selectedTwoTheta={cnTwoTheta}
                      onCalculate={() => { }} // Logic shifted to chart selection
                      onSetMode={setChartMode}
                      batchResults={cnBatchResults}
                      activeFileId={activeFileId}
                      onSelectFile={setActiveFileId}
                    />
                  )}

                  {analysisMode === AnalysisMode.GRAIN_SIZE && (
                    <GrainSizeConfigurator
                      lambda={lambda}
                      onLambdaChange={setLambda}
                      kFactor={kFactor}
                      onKFactorChange={setKFactor}
                      selectedTwoTheta={cnTwoTheta}
                      onCalculate={() => { }}
                      onSetMode={setChartMode}
                      batchResults={gsBatchResults}
                      activeFileId={activeFileId}
                      onSelectFile={setActiveFileId}
                      data={files.find(f => f.id === activeFileId)?.data || []}
                    />
                  )}
                </div>

                {/* Shared Overlay Settings (Reference Visibility) */}
                <div className={`h-40 bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col ${analysisMode === AnalysisMode.TC ? 'border-slate-200' : analysisMode === AnalysisMode.CN_RATIO ? 'border-emerald-100' : 'border-purple-100'}`}>
                  <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest px-4 py-3 bg-slate-50 border-b border-slate-100">
                    Reference Overlays
                  </h3>
                  <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 custom-scrollbar">
                    {Object.entries({ ...MATERIALS, ...customMaterials }).map(([key, mat]) => (
                      <label key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all cursor-pointer group ${visibleReferenceMaterials.includes(key) ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${visibleReferenceMaterials.includes(key) ? (analysisMode === AnalysisMode.TC ? 'bg-blue-600 border-blue-600' : analysisMode === AnalysisMode.CN_RATIO ? 'bg-emerald-600 border-emerald-600' : 'bg-purple-600 border-purple-600') : 'border-slate-300'}`}>
                          {visibleReferenceMaterials.includes(key) && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                        </div>
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={visibleReferenceMaterials.includes(key)}
                          onChange={() => toggleReferenceVisibility(key)}
                        />
                        <span className={`text-xs font-semibold ${visibleReferenceMaterials.includes(key) ? 'text-slate-900' : 'text-slate-500'}`}>{mat.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Resize Handle */}
            <div
              className="w-full flex items-center justify-center -mt-1 pb-4 cursor-row-resize group"
              onMouseDown={handleGridResizeStart}
            >
              <div className="w-32 h-1.5 bg-slate-200 rounded-full group-hover:bg-blue-400 transition-colors flex items-center justify-center">
                <GripHorizontal size={14} className="text-slate-400 group-hover:text-white" />
              </div>
            </div>



            {/* Results specific to TC analysis mode */}
            {analysisMode === AnalysisMode.TC && step === AppStep.RESULTS && (
              <div className="mt-8 space-y-8 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <ResultsTable results={results} onReset={handleReset} />
                </div>
              </div>
            )}

            {/* Williamson-Hall Analysis Results (Grain  Size Mode) */}
            {analysisMode === AnalysisMode.GRAIN_SIZE && (
              <div className="mt-8 space-y-6 animate-fade-in">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-purple-200">
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <BarChart3 className="text-purple-600" size={20} />
                        Williamson-Hall Strain Analysis
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">Multi-peak stress and grain size calculation using TC peak definitions</p>
                    </div>
                    <button
                      onClick={() => {
                        if (activeFileId) {
                          const file = files.find(f => f.id === activeFileId);
                          if (file) {
                            // Pass all definitions and the excluded set
                            const whResult = calculateWilliamsonHall(activeDefinitions, file.data, lambda, kFactor, gsWHExcludedPeaks);
                            setGsWHAnalysis(whResult);
                          }
                        }
                      }}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg hover:opacity-90 transition-opacity shadow-sm"
                    >
                      <BarChart3 size={16} />
                      Analyze Strain
                    </button>
                  </div>

                  {gsWHAnalysis && (
                    <div className="space-y-6">
                      {/* Summary Cards */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl">
                          <label className="block text-xs text-purple-600 uppercase font-bold mb-2">Strain (ε)</label>
                          <div className="text-2xl font-mono font-bold text-purple-700">
                            {gsWHAnalysis.strain.toExponential(3)}
                          </div>
                        </div>
                        <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl">
                          <label className="block text-xs text-purple-600 uppercase font-bold mb-2">Grain Size (Å)</label>
                          <div className="text-2xl font-mono font-bold text-purple-700">
                            {gsWHAnalysis.grainSize.toFixed(2)}
                          </div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                          <label className="block text-xs text-slate-600 uppercase font-bold mb-2">R² (Fit Quality)</label>
                          <div className="text-2xl font-mono font-bold text-slate-700">
                            {gsWHAnalysis.rSquared.toFixed(4)}
                          </div>
                        </div>
                      </div>

                      {/* Peak-by-Peak Table */}
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 mb-3">Individual Peak Data (Select peaks to include)</h4>
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 border-b border-slate-200">
                              <tr>
                                <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase w-12">Use</th>
                                <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase">Plane</th>
                                <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase text-right">2θ (deg)</th>
                                <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase text-right">FWHM (deg)</th>
                                <th className="px-4 py-3 text-xs font-bold text-slate-600 uppercase text-right">Grain Size (Å)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {gsWHAnalysis.peakData.map((peak: any, i: number) => {
                                const peakDef = activeDefinitions.find(def => def.plane === peak.plane);
                                const isExcluded = peakDef ? gsWHExcludedPeaks.has(peakDef.id) : false;
                                return (
                                  <tr key={i} className={`hover:bg-purple-50/30 transition-colors ${isExcluded ? 'opacity-40' : ''}`}>
                                    <td className="px-4 py-3">
                                      <input
                                        type="checkbox"
                                        checked={!isExcluded}
                                        onChange={() => {
                                          if (peakDef) {
                                            setGsWHExcludedPeaks(prev => {
                                              const newSet = new Set(prev);
                                              if (newSet.has(peakDef.id)) {
                                                newSet.delete(peakDef.id);
                                              } else {
                                                newSet.add(peakDef.id);
                                              }
                                              return newSet;
                                            });
                                          }
                                        }}
                                        className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500"
                                      />
                                    </td>
                                    <td className="px-4 py-3 font-bold text-purple-700">{peak.plane}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-700">{peak.twoTheta.toFixed(4)}</td>
                                    <td className="px-4 py-3 text-right font-mono text-slate-700">{peak.fwhm.toFixed(4)}</td>
                                    <td className="px-4 py-3 text-right font-mono font-bold text-purple-700">{peak.grainSize.toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">💡 Toggle checkboxes to include/exclude peaks - results update automatically</p>
                      </div>

                      {/* W-H Plot */}
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 mb-3">Williamson-Hall Plot</h4>
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <div className="h-64 w-full relative">
                            <div className="absolute inset-0">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                  data={gsWHAnalysis.plotData}
                                  margin={{ top: 10, right: 30, left: 10, bottom: 30 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                  <XAxis
                                    dataKey="x"
                                    label={{ value: '4 sin θ', position: 'insideBottom', offset: -10, style: { fontWeight: 'bold', fontSize: 12 } }}
                                    tick={{ fontSize: 11 }}
                                  />
                                  <YAxis
                                    label={{ value: 'β cos θ (rad)', angle: -90, position: 'insideLeft', style: { fontWeight: 'bold', fontSize: 12 } }}
                                    tick={{ fontSize: 11 }}
                                  />
                                  <Tooltip
                                    content={({ active, payload }) => {
                                      if (active && payload && payload.length) {
                                        return (
                                          <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200">
                                            <p className="text-xs font-bold text-slate-700">X: {payload[0].payload.x.toFixed(4)}</p>
                                            <p className="text-xs font-bold text-purple-700">Y (measured): {payload[0].payload.y.toExponential(3)}</p>
                                            <p className="text-xs font-bold text-blue-700">Y (fit): {payload[0].payload.yFit.toExponential(3)}</p>
                                          </div>
                                        );
                                      }
                                      return null;
                                    }}
                                  />
                                  <Line
                                    type="linear"
                                    dataKey="yFit"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    dot={false}
                                    name="Linear Fit"
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="y"
                                    stroke="#9333ea"
                                    strokeWidth={0}
                                    activeDot={{ r: 8 }}
                                    dot={(props: any) => {
                                      const { cx, cy, payload } = props;
                                      const isExcluded = payload.isExcluded;
                                      return (
                                        <circle
                                          cx={cx}
                                          cy={cy}
                                          r={isExcluded ? 4 : 6}
                                          fill={isExcluded ? '#cbd5e1' : '#9333ea'}
                                          stroke={isExcluded ? '#94a3b8' : '#fff'}
                                          strokeWidth={2}
                                          style={{ opacity: isExcluded ? 0.6 : 1, cursor: 'pointer' }}
                                        />
                                      );
                                    }}
                                    name="Measured Data"
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="mt-3 text-xs text-slate-500 text-center">
                              Equation: β cos θ = ({gsWHAnalysis.slope.toExponential(3)}) × (4 sin θ) + {gsWHAnalysis.yIntercept.toExponential(3)} | R² = {gsWHAnalysis.rSquared.toFixed(4)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {!gsWHAnalysis && (
                    <div className="text-center py-12 text-slate-400">
                      <BarChart3 size={48} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm">Click "Analyze Strain" to perform Williamson-Hall analysis using TC peak definitions.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>

    {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 border-t border-slate-200 mt-auto">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-slate-400 text-[10px] uppercase tracking-wider font-medium">
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-4">
            <p>© 2026 Korloy CVD Development Team.</p>
            <p>Copyright Shin HyeonTae. All rights reserved.</p>
          </div>
          <p>Microstructure Analyzer v5.1</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
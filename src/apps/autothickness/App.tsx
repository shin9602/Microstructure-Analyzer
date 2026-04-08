import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { CanvasArea, type CanvasAreaHandle } from './components/CanvasArea';
import { ResultsPanel } from './components/ResultsPanel';
import { ImageManager } from './services/ImageManager';
import { CalibrationManager } from './services/CalibrationManager';
import { Measurement } from './services/Measurement';
import { AutoAnalyzer } from './services/AutoAnalyzer';
import { MicrostructureAnalyzer } from './services/MicrostructureAnalyzer';
import { ProfileChartManager } from './services/ProfileChartManager';
import { DebugOverlay } from './components/DebugOverlay';
import { Ruler, Home, Menu, UploadCloud, RotateCcw, Settings, Activity, ZoomIn, ZoomOut, X, Bug } from 'lucide-react';
import './styles/autothickness.css';

interface AppProps {
    onBack?: () => void;
}

interface ImageEntry {
    file: File;
    name: string;
    measurements: Measurement[];
}

const App: React.FC<AppProps> = ({ onBack }) => {
    // Services
    const imageManager = useMemo(() => new ImageManager(), []);
    const calibrationManager = useMemo(() => new CalibrationManager(), []);
    const chartManager = useMemo(() => {
        const cm = new ProfileChartManager('profile-chart', (index) => {
            if (index !== null && cm.currentProfileData[index]) {
                const point = cm.currentProfileData[index];
                const meas = selectedMeasurementRef.current;

                // FIX: Disable highlight line for microstructure (Histogram is not spatial)
                // This prevents "interference" between SEM histogram analysis and OM spatial profiles
                if (meas?.type === 'microstructure') {
                    setHighlightLine(null);
                    return;
                }

                const roi = meas?.data?.roi;

                if (meas?.type === 'profile' && roi) {
                    // Check orientation
                    const orientation = meas.data.orientation || (roi.width > roi.height ? 'horizontal' : 'vertical');

                    if (orientation === 'horizontal') {
                        // Horizontal scan (X-axis): Vertical highlight line
                        setHighlightLine({ type: 'vertical', pos: point.x, start: roi.y, end: roi.y + roi.height });
                    } else {
                        // Vertical scan (Y-axis): Horizontal highlight line
                        setHighlightLine({ type: 'horizontal', pos: point.y, start: roi.x, end: roi.x + roi.width });
                    }
                } else if (roi) {
                    // Thickness profile (always vertical scan): Horizontal highlight line
                    setHighlightLine({ type: 'horizontal', pos: point.y, start: roi.x, end: roi.x + roi.width });
                } else if (imageManager.image) {
                    // Fallback full image
                    if (point.y !== undefined) {
                        setHighlightLine({ type: 'horizontal', pos: point.y, start: 0, end: imageManager.image.width });
                    } else {
                        setHighlightLine({ type: 'vertical', pos: point.x, start: 0, end: imageManager.image.height });
                    }
                }
            } else {
                setHighlightLine(null);
            }
        });
        return cm;
    }, []);
    const canvasHandleRef = useRef<CanvasAreaHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // State
    const [currentTool, setTool] = useState<string | null>(null);
    const [measurements, setMeasurements] = useState<Measurement[]>([]);
    const [selectedMeasurement, setSelectedMeasurement] = useState<Measurement | null>(null);
    const [analysisMode, setAnalysisMode] = useState<string>('cvd-auto');
    const [appMode, setAppMode] = useState<'om' | 'sem'>('om'); // OM or SEM analysis mode
    const [calibrationVersion, setCalibrationVersion] = useState(0);

    // View state
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    const [imageVersion, setImageVersion] = useState(0);
    const [showGrid, setShowGrid] = useState(false);
    const [showDebug, setShowDebug] = useState(false); // Debug Overlay State

    // Analysis thresholds
    const [alStartThreshold, setAlStartThreshold] = useState(10);
    const [alEndThreshold, setAlEndThreshold] = useState(10);

    // Multi-image management
    const [imageList, setImageList] = useState<ImageEntry[]>([]);

    const [currentImageIndex, setCurrentImageIndex] = useState(-1);

    // Layout State
    const [sidebarWidth, setSidebarWidth] = useState(320);
    const [resultsWidth, setResultsWidth] = useState(240);
    const lastAnalysisTimeRef = useRef<number>(0); // [추가] 분석 성능 최적화를 위한 쓰로틀링 타임스탬프
    const [showProfileChart, setShowProfileChart] = useState(false); // Floating Chart Visibility
    const [chartPos, setChartPos] = useState({ x: 350, y: 60 }); // Position from top-left of parent (Moved to top by default)
    const [chartSize, setChartSize] = useState({ width: 600, height: 250 });
    const [zoomLevel, setZoomLevel] = useState(100);
    const [highlightLine, setHighlightLine] = useState<{ type: 'vertical' | 'horizontal'; pos: number; start: number; end: number } | null>(null);
    const [microPhaseMode, setMicroPhaseMode] = useState<'2-phase' | '3-phase'>('3-phase');
    const [roughnessOrientation, setRoughnessOrientation] = useState<'horizontal' | 'vertical'>('vertical');
    const [correctionMode, setCorrectionMode] = useState<'merge' | 'split' | 'reassign' | null>(null);

    // Ref to track selected measurement for hover callback (avoids stale closure)
    const selectedMeasurementRef = useRef<Measurement | null>(null);

    // Resizing Refs
    const isResizing = useRef<string | null>(null); // 'sidebar', 'results', 'chart-drag', 'chart-resize'
    const dragStart = useRef<{ x: number, y: number } | null>(null);

    // Undo/Redo
    const undoStack = useRef<Measurement[][]>([]);
    const redoStack = useRef<Measurement[][]>([]);

    // Toasts
    const [toasts, setToasts] = useState<Array<{ id: number, message: string, type: 'success' | 'error' | 'info' | 'warning', title: string }>>([]);
    const toastIdRef = useRef(0);

    const addToast = useCallback((title: string, message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
        const id = toastIdRef.current++;
        setToasts(prev => [...prev, { id, title, message, type }]);
        setTimeout(() => removeToast(id), 3000);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // --- Logic ---

    // Undo/Redo
    const pushUndo = useCallback(() => {
        undoStack.current.push([...measurements]);
        if (undoStack.current.length > 50) undoStack.current.shift();
        redoStack.current = [];
    }, [measurements]);

    const undo = useCallback(() => {
        if (undoStack.current.length === 0) return;
        const prev = undoStack.current.pop();
        if (prev) {
            redoStack.current.push([...measurements]);
            setMeasurements(prev);
            addToast('Undo', '작업을 되돌렸습니다.', 'info');
        }
    }, [measurements]);

    const redo = useCallback(() => {
        if (redoStack.current.length === 0) return;
        const next = redoStack.current.pop();
        if (next) {
            undoStack.current.push([...measurements]);
            setMeasurements(next);
            addToast('Redo', '작업을 다시 실행했습니다.', 'info');
        }
    }, [measurements]);


    const loadCalibrationFile = useCallback(async (file: File, silent = false) => {
        try {
            const data: any = await calibrationManager.loadFromFile(file);
            if (data && data.calibrations && data.calibrations.length > 0) {
                // Apply first one
                calibrationManager.applyCalibrationData(data.calibrations[0], file.name);

                // Add ALL to presets
                data.calibrations.forEach((cal: any, idx: number) => {
                    // Create a unique name
                    let name = cal.CalibName || `${file.name.replace('.cal', '')}-${idx + 1}`;
                    const tempMgr = new CalibrationManager();
                    if (tempMgr.applyCalibrationData(cal, file.name)) {
                        calibrationManager.pixelsPerUnit = tempMgr.pixelsPerUnit;
                        calibrationManager.unit = tempMgr.unit;
                        calibrationManager.notes = name;
                        calibrationManager.savePreset(name);
                    }
                });
            }
            setCalibrationVersion(v => v + 1);
            if (!silent) {
                addToast('캘리브레이션', `${file.name} (총 ${data.calibrations.length}개) 프리셋을 불러왔습니다.`, 'success');
            }
        } catch (e) {
            if (!silent) {
                addToast('오류', '캘리브레이션 파일 로드 실패', 'error');
            }
        }
    }, [calibrationManager, addToast]);

    const autoLoadCalibrations = useCallback(async () => {
        // Known files in Calibration folder (Moved to public/Calibration)
        const filesToLoad = ['calib.cal', 'calib1.cal', 'calib12.cal', 'calib2.cal', 'calib3.cal'];
        let successCount = 0;

        for (const filename of filesToLoad) {
            try {
                const response = await fetch(`./Calibration/${filename}`);
                if (!response.ok) continue;
                const blob = await response.blob();
                const file = new File([blob], filename);
                await loadCalibrationFile(file, true); // silent = true
                successCount++;
            } catch (e) {
                // Silent fail for auto-load
            }
        }

        if (successCount > 0) {
            setCalibrationVersion(v => v + 1);
            addToast('캘리브레이션', `폴더에서 ${successCount}개의 파일을 자동으로 로드했습니다.`, 'info');
        }

        // Set default to "청주신규 1600x"
        if (calibrationManager.loadPreset("청주신규 1600x")) {
            setCalibrationVersion(v => v + 1);
            addToast('캘리브레이션', '기본값 "청주신규 1600x"가 설정되었습니다.', 'info');
        }
    }, [calibrationManager, addToast, loadCalibrationFile]);

    const calibrationLoadedRef = useRef(false);

    // Auto-load calibrations on mount (once)
    useEffect(() => {
        if (!calibrationLoadedRef.current) {
            calibrationLoadedRef.current = true;
            autoLoadCalibrations();
        }
    }, [autoLoadCalibrations]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.ctrlKey) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        undo();
                        return;
                    case 'y':
                        e.preventDefault();
                        redo();
                        return;
                    case 'o':
                        e.preventDefault();
                        triggerFileUpload();
                        return;
                    case 'e': // Export
                        e.preventDefault();
                        handleExport();
                        return;
                }
            }

            switch (e.key.toLowerCase()) {
                case 'l': setTool(prev => prev === 'line' ? null : 'line'); break;
                case 'r': setTool(prev => prev === 'rectangle' ? null : 'rectangle'); break;
                case 's': setTool(prev => prev === 'area-profile' ? null : 'area-profile'); break;
                case 'p': setTool(prev => prev === 'parallel' ? null : 'parallel'); break;
                case 'c': setTool(prev => prev === 'calibration' ? null : 'calibration'); break;
                case 'a': // 'A' shortcut can be removed or left as is if we want to support it for auto-analysis
                    if (canvasHandleRef.current) {
                        canvasHandleRef.current.autoMeasure();
                        addToast('자동 분석', '자동 두께 분석을 실행했습니다.', 'success');
                    }
                    break;
                case 'q': // Auto analysis shortcut if ROI exists
                    if (canvasHandleRef.current) {
                        canvasHandleRef.current.autoMeasure();
                        addToast('자동 분석', '자동 두께 분석을 실행했습니다.', 'success');
                    }
                    break;
                case 'd':
                    if (canvasHandleRef.current) {
                        canvasHandleRef.current.toggleEdgeView();
                        addToast('Edge View', '에지 뷰를 토글했습니다.', 'info');
                    }
                    break;
                case 'g': setShowGrid(prev => !prev); break;
                case 'f':
                    if (canvasHandleRef.current) canvasHandleRef.current.fitToCanvas();
                    break;
                case 'escape':
                    setTool(null);
                    setSelectedMeasurement(null);
                    break;
                case 'backspace':
                    if (selectedMeasurement) {
                        handleDeleteMeasurement(measurements.indexOf(selectedMeasurement));
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        // Global Resize Handlers
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current) return;

            if (isResizing.current === 'sidebar') {
                const newWidth = Math.max(150, Math.min(400, e.clientX));
                setSidebarWidth(newWidth);
            } else if (isResizing.current === 'results') {
                const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX));
                setResultsWidth(newWidth);
            } else if (isResizing.current === 'chart-drag') {
                if (dragStart.current) {
                    const dx = e.clientX - dragStart.current.x;
                    const dy = e.clientY - dragStart.current.y;
                    setChartPos(prev => ({
                        x: prev.x + dx,
                        y: prev.y + dy
                    }));
                    dragStart.current = { x: e.clientX, y: e.clientY };
                }
            } else if (isResizing.current === 'chart-resize') {
                if (dragStart.current) {
                    const dx = e.clientX - dragStart.current.x;
                    const dy = e.clientY - dragStart.current.y;
                    setChartSize(prev => ({
                        width: Math.max(300, prev.width + dx),
                        height: Math.max(150, prev.height + dy)
                    }));
                    dragStart.current = { x: e.clientX, y: e.clientY };
                }
            }
        };

        const handleMouseUp = () => {
            isResizing.current = null;
            document.body.style.cursor = 'default';
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [undo, redo, measurements, selectedMeasurement]); // Dependencies updated

    // Tool change toast
    useEffect(() => {
        if (currentTool) {
            const labels: Record<string, string> = {
                'line': '선 측정 도구',
                'rectangle': '사각형 도구',
                'area-profile': '두께 분석 도구',
                'parallel': '평행선 도구',
                'calibration': '캘리브레이션 도구',
                'profile': '조도 분석 도구',
                'microstructure': '미세구조 분석 도구'
            };
            addToast('도구 선택', `${labels[currentTool]}가 선택되었습니다.`, 'info');
        }
    }, [currentTool]);

    // Zoom Handlers
    const handleZoomIn = () => canvasHandleRef.current?.zoomIn();
    const handleZoomOut = () => canvasHandleRef.current?.zoomOut();
    const handleZoomReset = () => canvasHandleRef.current?.fitToCanvas();
    const handleZoom100 = () => canvasHandleRef.current?.zoom100();

    // Initial load
    useEffect(() => {
        if (!imageManager.image) {
            // Can show placeholder or instruction
        }

        // Load default calibration presets (init)
        if (Object.keys(calibrationManager.getPresets()).length === 0) {
            calibrationManager.initDefaultPresets();
        }
    }, []);

    // File handling
    const triggerFileUpload = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files));
        }
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(Array.from(e.dataTransfer.files));
        }
    };

    const handleFiles = async (files: File[]) => {
        // Separate cal files and images
        const calFile = files.find(f => f.name.toLowerCase().endsWith('.cal'));
        const images = files.filter(f => f.type.startsWith('image/') ||
            ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.ang', '.osc'].some(ext => f.name.toLowerCase().endsWith(ext)));

        // Load cal file if present
        if (calFile) {
            await loadCalibrationFile(calFile);
        }

        if (images.length === 0) return;

        // Process images
        const newEntries: ImageEntry[] = [];
        for (const file of images) {
            newEntries.push({
                file,
                name: file.name,
                measurements: []
            });
        }

        setImageList(prev => {
            const combined = [...prev, ...newEntries];
            // If previous list was empty, select first new image
            if (prev.length === 0 && newEntries.length > 0) {
                // Trigger load for the first one shortly
                setTimeout(() => switchImage(0, combined), 50);
            }
            return combined;
        });

        if (newEntries.length > 0) {
            addToast('이미지 로드', `${newEntries.length}개의 이미지를 불러왔습니다.`, 'success');
        }
    };


    const handleImageManagerChange = useCallback(() => {
        setImageVersion(v => v + 1);
    }, []);

    const handleCalibrationChange = useCallback(() => {
        // 1. Trigger version update to re-render dumb components
        setCalibrationVersion(v => v + 1);

        // 2. Recalculate 'area-profile' measurements
        if (!calibrationManager.pixelsPerUnit) return;
        const ppu = calibrationManager.pixelsPerUnit;

        setMeasurements(prev => prev.map(m => {
            if (m.type === 'area-profile' && m.data.segments) {
                // Recalculate segments
                const newSegments = m.data.segments.map((s: any) => {

                    const pixels = s.yEnd - s.yStart;
                    return {
                        ...s,
                        thickness: pixels / ppu
                    };
                });

                // Rebuild results summary
                const newResults: Record<string, number> = {};
                newSegments.forEach((s: any) => {
                    newResults[s.label] = s.thickness;
                });

                // Preserve Total/Substrate logic implicitly via segments or ensure consistency?
                // Substrate summary key might be "모재".

                // Recalculate profileData distances if exists
                let newProfileData = m.data.profileData;
                if (newProfileData) {
                    newProfileData = newProfileData.map((p: any) => ({
                        ...p,
                        distancePixels: p.distancePixels != null ? p.distancePixels : p.distance * (m.data.oldPpu || ppu), // Ensure distancePixels is preserved or calculated
                        distance: p.distancePixels != null ? (p.distancePixels / ppu) : (p.distance * (m.data.oldPpu || ppu) / ppu)
                    }));
                }

                return new Measurement(m.type, {
                    ...m.data,
                    segments: newSegments,
                    results: newResults,
                    profileData: newProfileData,
                    oldPpu: ppu
                });
            }
            return m;
        }));

        addToast('캘리브레이션', '변경된 설정이 모든 측정값에 적용되었습니다.', 'success');
    }, [calibrationManager, addToast]);

    const switchImage = async (index: number, list = imageList) => {
        if (index < 0 || index >= list.length) return;

        // Save current measurements
        if (currentImageIndex !== -1 && imageList[currentImageIndex]) {
            imageList[currentImageIndex].measurements = [...measurements];
        }

        const entry = list[index];
        setCurrentImageIndex(index);

        // Load image
        try {
            await imageManager.loadImage(entry.file);
            setMeasurements(entry.measurements || []); // Load saved measurements

            // Trigger a re-render
            handleImageManagerChange();

            // Reset view
            if (canvasHandleRef.current) {
                canvasHandleRef.current.fitToCanvas();
            }
        } catch (error: any) {
            console.error("Image load error:", error);
            addToast('이미지 로드 실패', error.message || '이미지를 불러오는 중 오류가 발생했습니다.', 'error');
            // Revert state if possible or keep as is
        }
    }

    const deleteImage = (index: number) => {
        setImageList(prev => {
            const newList = [...prev];
            newList.splice(index, 1);

            if (newList.length === 0) {
                setCurrentImageIndex(-1);
                imageManager.image = null;
                setMeasurements([]);
                return newList;
            }

            // Adjust index
            if (index === currentImageIndex) {
                // Switch to previous or next
                const newIndex = index === 0 ? 0 : index - 1;
                setTimeout(() => switchImage(newIndex, newList), 50);
            } else if (index < currentImageIndex) {
                setCurrentImageIndex(currentImageIndex - 1);
            }

            return newList;
        });
    };

    // Measurements
    const handleSelectMeasurement = useCallback((m: Measurement | null) => {
        setSelectedMeasurement(m);
        selectedMeasurementRef.current = m;
        setHighlightLine(null);
        if (m && m.data && (m.data.profileData || m.data.histogram) && chartManager) {
            setShowProfileChart(true);
            let boundaries = m.data.boundaries || [];
            let labels = m.data.segments ? m.data.segments.map((s: any) => s.originalLabel || s.label) : [];
            let chartData = m.data.profileData;

            if (m.type === 'microstructure') {
                if (m.data.histogram) {
                    chartData = m.data.histogram.map((v: number, i: number) => ({ distance: i, value: v }));
                }

                const mode = m.data.mode || 'classic';
                const currentThres = m.data.manualThreshold !== undefined ? m.data.manualThreshold : m.data.threshold;

                boundaries = [];
                labels = [];

                if (mode === 'substrate') {
                    if (m.data.t1 !== undefined) { boundaries.push(m.data.t1); labels.push('T1'); }
                    if (m.data.t2 !== undefined) { boundaries.push(m.data.t2); labels.push('T2'); }
                } else if (mode === 'classic') {
                    if (m.data.t1 !== undefined) { boundaries.push(m.data.t1); labels.push('T1'); }
                    if (m.data.phaseMode === '3-phase' && m.data.t2 !== undefined) { boundaries.push(m.data.t2); labels.push('T2'); }
                } else {
                    // thin-film mode
                    boundaries.push(currentThres);
                    labels.push('Otsu');
                }

                const gmmCurves = m.data.gmmCurves || [];
                chartManager.update(chartData, 'Level', boundaries, labels, false, gmmCurves, false);
            } else {
                const showRGB = appMode === 'om' && m.type !== 'profile';
                chartManager.update(chartData, calibrationManager.unit, boundaries, labels, true, [], showRGB);
            }
        } else {
            setShowProfileChart(false);
        }
    }, [chartManager, calibrationManager.unit, appMode]);



    const handleUpdateMeasurement = useCallback((measurement: Measurement, updates: any, forceAnalysis: boolean = false) => {
        if (measurement.type === 'microstructure') {
            const hasUpdate = forceAnalysis ||
                updates.hasOwnProperty('t1') ||
                updates.hasOwnProperty('t2') ||
                updates.hasOwnProperty('manualThreshold') ||
                updates.hasOwnProperty('gmmSigma') ||
                updates.hasOwnProperty('mode') ||
                updates.hasOwnProperty('phaseMode') ||
                updates.hasOwnProperty('targetStep') ||
                updates.hasOwnProperty('debugStepIndex') ||
                updates.hasOwnProperty('minIslandSize');

            if (hasUpdate) {
                // [성능 최적화] 모드/체계 변경 시에는 강제 실행, 슬라이더 변경 시에는 쓰로틀링
                const now = Date.now();
                const isSliderUpdate = updates.hasOwnProperty('t1') || updates.hasOwnProperty('t2') || updates.hasOwnProperty('manualThreshold') || updates.hasOwnProperty('minIslandSize');
                
                if (!forceAnalysis && isSliderUpdate && (now - lastAnalysisTimeRef.current < 80)) {
                    return;
                }
                lastAnalysisTimeRef.current = now;

                const imageData = imageManager.getImageData();
                const roi = measurement.data.roi || measurement.data;

                if (imageData && roi) {
                    const currentData = measurement.data;
                    const isGmmUpdate = updates.hasOwnProperty('gmmSigma');

                    // [수정] 화면 보정치(밝기, 대비) 포함
                    const params: any = {
                        mode: updates.mode || currentData.mode || 'classic',
                        manualThreshold: updates.manualThreshold !== undefined ? updates.manualThreshold : currentData.manualThreshold,
                        t1: updates.hasOwnProperty('t1') ? updates.t1 : (isGmmUpdate ? undefined : currentData.t1),
                        t2: updates.hasOwnProperty('t2') ? updates.t2 : (isGmmUpdate ? undefined : currentData.t2),
                        phaseMode: updates.hasOwnProperty('phaseMode') ? updates.phaseMode : currentData.phaseMode,
                        targetStep: updates.hasOwnProperty('targetStep') ? updates.targetStep : currentData.targetStep,
                        debugStepIndex: updates.hasOwnProperty('debugStepIndex') ? updates.debugStepIndex : currentData.debugStepIndex,
                        minIslandSize: updates.hasOwnProperty('minIslandSize') ? updates.minIslandSize : currentData.minIslandSize,
                        splitSensitivity: updates.hasOwnProperty('splitSensitivity') ? updates.splitSensitivity : (currentData.splitSensitivity ?? 1.0),
                        brightness: imageManager.brightness,
                        contrast: imageManager.contrast
                    };

                    // [추가] 캐시 무효화: updates에 따라 기존 캐시(_cachedBitmap 등)를 제거하고 복사
                    const cleanCurrentData = { ...currentData };
                    Object.keys(cleanCurrentData).forEach(key => {
                        if (key.startsWith('_')) delete (cleanCurrentData as any)[key];
                    });

                    const result = MicrostructureAnalyzer.analyze(imageData, roi, params, cleanCurrentData);

                    // Calibrate results (Pixels -> Real Units)
                    const unitScale = calibrationManager.pixelsToReal(1);
                    if (unitScale !== null) {
                        if (result.avgGrainSize) result.avgGrainSize *= unitScale;
                        if (result.areaWeightedGrainSize) result.areaWeightedGrainSize *= unitScale;
                        if (result.meanFreePath) result.meanFreePath *= unitScale;
                    }

                    const updatedMeas = new Measurement(measurement.type as any, {
                        ...cleanCurrentData,
                        ...result,
                        ...params,
                        roi: roi, // 명시적으로 ROI 업데이트 보장
                        histogram: result.histogram
                    });
                    updatedMeas.id = measurement.id;
                    updatedMeas.selected = true;

                    setMeasurements(prev => prev.map(m => m.id === measurement.id ? updatedMeas : m));
                    setSelectedMeasurement(updatedMeas);
                    selectedMeasurementRef.current = updatedMeas;


                    if (chartManager && result.histogram) {
                        const chartData = result.histogram.map((val: number, idx: number) => ({
                            distance: idx,
                            value: val
                        }));

                        const boundaries: number[] = [];
                        const labels: string[] = [];

                        if (params.mode === 'substrate') {
                            if (result.t1 !== undefined) { boundaries.push(result.t1!); labels.push('T1'); }
                            if (result.t2 !== undefined) { boundaries.push(result.t2!); labels.push('T2'); }
                        } else if (params.mode === 'classic') {
                            if (result.t1 !== undefined) { boundaries.push(result.t1!); labels.push('T1'); }
                            if (params.phaseMode === '3-phase' && result.t2 !== undefined) { boundaries.push(result.t2!); labels.push('T2'); }
                        } else {
                            // thin-film mode
                            boundaries.push(result.threshold);
                            labels.push('Otsu');
                        }

                        let gmmCurves: any[] = [];
                        if (result.gmmCurves) {
                            // Convert from double array to expected format if needed, or pass directly
                            gmmCurves = result.gmmCurves as any;
                        }

                        chartManager.update(chartData, 'Level', boundaries, labels, false, gmmCurves, false);
                    }
                }
            }
        } else if (measurement.type === 'profile' || measurement.type === 'area-profile' || measurement.type === 'line' || measurement.type === 'rectangle') {
            const imageData = imageManager.getImageData();
            const roi = measurement.data.roi || { x: measurement.data.x, y: measurement.data.y, width: measurement.data.width, height: measurement.data.height };

            if (imageData && roi && roi.width) {
                let profileData: any[] = [];
                let boundaries: number[] = measurement.data.boundaries || [];
                let labels: string[] = measurement.data.segments ? measurement.data.segments.map((s: any) => s.originalLabel || s.label) : [];

                if (measurement.type === 'profile' && measurement.data.orientation === 'horizontal') {
                    profileData = AutoAnalyzer.getHorizontalMedianProfile(imageData, roi);
                } else if (measurement.type === 'line' && measurement.data.x1 !== undefined) {
                    profileData = AutoAnalyzer.getLineProfile(imageData, { x: measurement.data.x1, y: measurement.data.y1 }, { x: measurement.data.x2, y: measurement.data.y2 });
                } else {
                    profileData = AutoAnalyzer.getVerticalMedianProfile(imageData, roi);
                }

                if (profileData.length > 0) {
                    const calibratedProfile = profileData.map(p => ({
                        ...p,
                        distancePixels: p.distance,
                        distance: calibrationManager.pixelsToReal(p.distance)
                    }));

                    let newRoughness = measurement.data.roughness;
                    if (measurement.type === 'profile') {
                        newRoughness = AutoAnalyzer.calculateRoughness(profileData);
                    }

                    const updatedMeas = new Measurement(measurement.type as any, {
                        ...measurement.data,
                        profileData: calibratedProfile,
                        roughness: newRoughness
                    });
                    updatedMeas.id = measurement.id;
                    updatedMeas.selected = true;

                    setMeasurements(prev => prev.map(m => m.id === measurement.id ? updatedMeas : m));
                    setSelectedMeasurement(updatedMeas);
                    selectedMeasurementRef.current = updatedMeas;

                    if (chartManager) {
                        const showRGB = appMode === 'om' && measurement.type !== 'profile';
                        chartManager.update(calibratedProfile, calibrationManager.unit, boundaries, labels, true, [], showRGB);
                    }
                }
            }
        }
    }, [imageManager, chartManager, appMode, calibrationManager]);

    // Auto-update analysis when image parameters change (e.g. channel switch, mode switch)
    useEffect(() => {
        if (selectedMeasurementRef.current) {
            handleSelectMeasurement(selectedMeasurementRef.current);
            // If it's a microstructure measurement, re-analyze to sync with potential channel/mode change
            if (selectedMeasurementRef.current.type === 'microstructure') {
                handleUpdateMeasurement(selectedMeasurementRef.current, {}, true);
            }
        }
    }, [imageVersion, appMode, handleSelectMeasurement, handleUpdateMeasurement]);

    // Sync chart onClick callback
    useEffect(() => {
        if (chartManager) {
            chartManager.onClickCallback = (value: number) => {
                const current = selectedMeasurementRef.current;
                if (current && current.type === 'microstructure') {
                    handleUpdateMeasurement(current, { manualThreshold: value });
                }
            };
        }
    }, [chartManager, handleUpdateMeasurement]);

    // Keyboard Shortcuts (Moved here to fix hosting issue)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key.toLowerCase() === 'h') {
                const selected = selectedMeasurementRef.current;
                let nextOrientation: 'horizontal' | 'vertical';

                if (selected && selected.type === 'profile') {
                    // Start from the measurement's current orientation
                    const current = selected.data.orientation || 'vertical';
                    nextOrientation = current === 'vertical' ? 'horizontal' : 'vertical';
                } else {
                    // Toggle based on global preference
                    nextOrientation = roughnessOrientation === 'vertical' ? 'horizontal' : 'vertical';
                }

                setRoughnessOrientation(nextOrientation);
                addToast('조도 분석 방향', nextOrientation === 'vertical' ? '세로 (Vertical)' : '가로 (Horizontal)', 'info');

                if (selected && selected.type === 'profile' && selected.data.roi) {
                    const roi = selected.data.roi;
                    const imgData = imageManager.getImageData();

                    if (imgData) {
                        const profile = nextOrientation === 'horizontal'
                            ? AutoAnalyzer.getHorizontalMedianProfile(imgData, roi)
                            : AutoAnalyzer.getVerticalMedianProfile(imgData, roi);

                        if (profile.length >= 5) {
                            const roughness = AutoAnalyzer.calculateRoughness(profile);
                            const calibratedProfile = profile.map(p => ({
                                ...p,
                                distancePixels: p.distance,
                                distance: calibrationManager.pixelsToReal(p.distance)
                            }));

                            const updatedMeas = new Measurement('profile', {
                                ...selected.data,
                                orientation: nextOrientation,
                                profileData: calibratedProfile,
                                roughness: roughness
                            });
                            updatedMeas.id = selected.id;
                            updatedMeas.selected = true;

                            setMeasurements(prev => prev.map(m => m.id === selected.id ? updatedMeas : m));
                            handleSelectMeasurement(updatedMeas);
                        }
                    }
                }
            } else if (e.key.toLowerCase() === 'n') {
                const selected = selectedMeasurementRef.current;
                if (selected && selected.type === 'microstructure') {
                    const currentStep = selected.data.targetStep ?? 5;
                    if (currentStep < 5) {
                        handleUpdateMeasurement(selected, { targetStep: currentStep + 1 });
                        addToast('분석 진행', `알고리즘 ${currentStep + 1}단계로 진행합니다.`, 'info');
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [roughnessOrientation, imageManager, calibrationManager, addToast, handleSelectMeasurement]);

    const handleDeleteMeasurement = useCallback((index: number) => {
        pushUndo();
        setMeasurements(prev => {
            const next = [...prev];
            next.splice(index, 1);
            return next;
        });
        setSelectedMeasurement(null);
        addToast('삭제', '측정값을 삭제했습니다.', 'info');
    }, [pushUndo]);

    const handleClearAll = () => {
        if (confirm('모든 측정값을 삭제하시겠습니까?')) {
            pushUndo();
            setMeasurements([]);
            setSelectedMeasurement(null);
            addToast('초기화', '모든 측정값이 초기화되었습니다.', 'warning');
        }
    };

    const handleProfileUpdate = useCallback((profile: any[], boundaries: number[], labels: string[], extraSeries: number[][] = []) => {
        if (chartManager) {
            setShowProfileChart(true);
            const unit = (extraSeries && extraSeries.length > 0) ? 'Level' : calibrationManager.unit;
            const showRGB = appMode === 'om' && (!extraSeries || extraSeries.length === 0);
            chartManager.update(profile, unit, boundaries, labels, true, extraSeries, showRGB);
        }
    }, [chartManager, calibrationManager.unit, appMode]);

    // Auto Analysis
    const handleAutoAnalyze = async () => {
        if (canvasHandleRef.current) {
            // Force auto measure on full image
            canvasHandleRef.current.autoMeasure();
            addToast('자동 분석', '전체 이미지에 대한 자동 두께 분석을 시작합니다.', 'success');
        }
    };

    // Roughness Profile Update
    const handleRoughnessProfileUpdate = useCallback((profile: any[], _roughness: any) => {
        if (chartManager) {
            setShowProfileChart(true);
            chartManager.update(profile, calibrationManager.unit, [], [], true, [], false);
        }
    }, [chartManager, calibrationManager.unit]);

    // Batch Analysis
    const handleBatchAnalyze = async () => {
        if (imageList.length === 0) return;

        addToast('배치 분석', '전체 이미지 분석을 시작합니다...', 'info');

        const ppu = calibrationManager.pixelsPerUnit;
        if (!ppu) {
            addToast('배치 분석 실패', '캘리브레이션 정보가 없습니다.', 'error');
            return;
        }

        const oneMicronPixels = Math.round(calibrationManager.realToPixels(1.0) || 0);

        const newList = [...imageList];
        let processedCount = 0;

        for (let i = 0; i < newList.length; i++) {
            const entry = newList[i];
            try {
                // Temporarily load image data to analyze
                const img = new Image();
                const isTif = entry.file.name.toLowerCase().endsWith('.tif') || entry.file.name.toLowerCase().endsWith('.tiff');
                let url: string;

                if (isTif) {
                    // Decode TIF using utif2 via ImageManager's static decode
                    const arrayBuffer = await entry.file.arrayBuffer();
                    const UTIF = await import('utif2');
                    const ifds = UTIF.decode(arrayBuffer);
                    if (ifds.length === 0) continue;
                    const firstPage = ifds[0];
                    UTIF.decodeImage(arrayBuffer, firstPage);
                    const rgba = UTIF.toRGBA8(firstPage);
                    const tempDecodeCanvas = document.createElement('canvas');
                    tempDecodeCanvas.width = firstPage.width;
                    tempDecodeCanvas.height = firstPage.height;
                    const tempDecodeCtx = tempDecodeCanvas.getContext('2d');
                    if (!tempDecodeCtx) continue;
                    const imgDataTif = tempDecodeCtx.createImageData(firstPage.width, firstPage.height);
                    imgDataTif.data.set(new Uint8ClampedArray(rgba.buffer));
                    tempDecodeCtx.putImageData(imgDataTif, 0, 0);
                    url = tempDecodeCanvas.toDataURL('image/png');
                } else {
                    url = URL.createObjectURL(entry.file);
                }

                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = url;
                });

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (!tempCtx) continue;
                tempCtx.drawImage(img, 0, 0);
                const imageData = tempCtx.getImageData(0, 0, img.width, img.height);

                // Analyze Full Image
                const roi = { x: 0, y: 0, width: img.width, height: img.height };
                const profile = AutoAnalyzer.getVerticalMedianProfile(imageData, roi);

                if (profile.length > 5) {
                    const { boundaries, labels: labelOrder } = AutoAnalyzer.analyzeCvdCoating(
                        profile, oneMicronPixels, { alStartThreshold, alEndThreshold }
                    );

                    boundaries.sort((a: number, b: number) => a - b);
                    const summary: Record<string, number> = {};
                    const segments: any[] = [];
                    const boundaryPoints = [0, ...boundaries, profile.length];

                    let substrateCalculated = false;
                    let totalSubstrateHeight = 0;
                    let substrateYStart = -1;

                    for (let j = 0; j < boundaryPoints.length - 1; j++) {
                        const yStart = boundaryPoints[j];
                        const yEnd = boundaryPoints[j + 1];
                        let label = j < labelOrder.length ? labelOrder[j] : '모재';
                        const realHeight = (yEnd - yStart) / ppu;

                        if (label === '모재' || label === 'Substrate') {
                            if (!substrateCalculated) { substrateYStart = yStart; substrateCalculated = true; }
                            totalSubstrateHeight += realHeight;
                        } else {
                            let uniqueLabel = label;
                            if (summary.hasOwnProperty(uniqueLabel)) {
                                let count = 2;
                                while (summary.hasOwnProperty(`${label} (${count})`)) count++;
                                uniqueLabel = `${label} (${count})`;
                            }
                            summary[uniqueLabel] = realHeight;
                            segments.push({
                                label: uniqueLabel, originalLabel: label, thickness: realHeight,
                                yStart: yStart, yEnd: yEnd
                            });
                        }
                    }

                    if (substrateCalculated) {
                        summary['모재'] = totalSubstrateHeight;
                        segments.push({
                            label: '모재', thickness: totalSubstrateHeight, yStart: substrateYStart,
                            yEnd: profile.length - 1
                        });
                    }

                    const areaMeas = new Measurement('area-profile', {
                        results: summary, segments: segments, boundaries: boundaries, roi: { ...roi },
                        profileData: profile.map(p => ({
                            ...p,
                            distancePixels: p.distance,
                            distance: p.distance / ppu
                        })),
                        timestamp: new Date().toLocaleTimeString()
                    });

                    // Store results in the entry
                    entry.measurements = [areaMeas];
                    processedCount++;
                }

                URL.revokeObjectURL(url);
            } catch (e) {
                console.error("Batch fail for", entry.name, e);
            }
        }

        setImageList(newList);

        // If we are currently on an image that was analyzed, refresh measurements
        // If we are currently on an image that was analyzed, refresh measurements AND CHART
        if (currentImageIndex !== -1) {
            const currentEntry = newList[currentImageIndex];
            setMeasurements([...currentEntry.measurements]);

            // Auto-select the first measurement to show its chart
            if (currentEntry.measurements.length > 0) {
                const firstMeas = currentEntry.measurements[0];
                handleSelectMeasurement(firstMeas);
            }
        }

        addToast('배치 분석 완료', `${processedCount}개의 이미지 분석을 마쳤습니다.`, 'success');

        // Automatic Export after Batch
        if (processedCount > 0) {
            handleBatchExport(newList);
        }
    }

    // Batch Export Logic
    const handleBatchExport = (list = imageList) => {
        const analyzedImages = list.filter(entry => entry.measurements.some(m => m.type === 'area-profile'));
        if (analyzedImages.length === 0) {
            addToast('내보내기 실패', '분석된 데이터가 없습니다.', 'error');
            return;
        }

        // 1. Identify all possible labels for headers
        const allLabels = new Set<string>();
        analyzedImages.forEach(entry => {
            const m = entry.measurements.find(m => m.type === 'area-profile');
            if (m && m.data?.results) {
                Object.keys(m.data.results).forEach(l => allLabels.add(l));
            }
        });
        const labelList = Array.from(allLabels).sort();

        // 2. Generate CSV Header
        let csv = '\uFEFF'; // BOM for Excel
        csv += '파일명,' + labelList.join(',') + ',수행시간\n';

        // 3. Generate Rows
        analyzedImages.forEach(entry => {
            const m = entry.measurements.find(m => m.type === 'area-profile');
            if (m && m.data?.results) {
                // Remove extension from filename
                const nameWithoutExt = entry.name.replace(/\.[^/.]+$/, "");
                let row = `${nameWithoutExt},`;
                row += labelList.map(label => {
                    const val = m.data.results[label];
                    return val != null ? val.toFixed(3) : '';
                }).join(',');
                row += `,${m.data.timestamp || ''}\n`;
                csv += row;
            }
        });

        // 4. Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `batch_analysis_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        addToast('일괄 내보내기', '엑셀 리포트가 생성되었습니다.', 'success');
    };

    // Export
    const handleExport = () => {
        if (measurements.length === 0) {
            alert('내보낼 데이터가 없습니다.');
            return;
        }

        // CSV generation
        const header = "Type,Value,Unit,Time,Details\n";
        const rows = measurements.map(m => {
            let details = '';
            let val = m.getValue(calibrationManager);

            if (m.type === 'area-profile' && m.data?.results) {
                details = Object.entries(m.data.results)
                    .map(([k, v]) => `${k}:${(v as number).toFixed(2)}`)
                    .join('|');
            } else if (m.type === 'microstructure') {
                const d = m.data;
                const stats = [
                    `WC:${(d.wcFraction * 100).toFixed(1)}%`,
                    `Co:${(d.coFraction * 100).toFixed(1)}%`,
                    d.mcFraction ? `MC:${(d.mcFraction * 100).toFixed(1)}%` : '',
                    `AvgSize:${d.avgGrainSize?.toFixed(3)}`,
                    `AreaWeightedSize:${d.areaWeightedGrainSize?.toFixed(3)}`,
                    `Contiguity:${d.contiguity?.toFixed(3)}`,
                    `MeanFreePath:${d.meanFreePath?.toFixed(3)}`,
                    `GrainCount:${d.grainCount}`
                ].filter(s => s !== '').join('|');
                details = stats;
                val = d.avgGrainSize?.toFixed(3) || '0';
            }
            
            return `${m.type},${val},${calibrationManager.unit},${m.data?.timestamp || ''},"${details}"`;
        }).join('\n');

        const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `measurements_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        addToast('내보내기', 'CSV 파일로 저장되었습니다.', 'success');
    };

    return (
        <div className="autothickness-app flex flex-col h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-200 selection:text-blue-900">
            {/* Header - Light & Minimal */}
            <header className="bg-white border-b border-slate-200 h-12 flex items-center justify-between px-4 shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 select-none">
                        <Ruler className="text-blue-600" size={18} />
                        <h1 className="text-sm font-bold text-slate-900 tracking-wide">
                            Image Analyzer <span className="text-slate-400 font-normal ml-1">v1.0</span>
                        </h1>
                        {onBack && (
                            <button onClick={onBack} className="ml-2 text-slate-400 hover:text-slate-900 transition-colors bg-slate-100 hover:bg-slate-200 p-1 rounded-full" title="홈으로 이동">
                                <Home size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-100 rounded p-0.5 border border-slate-200">
                        <div className="px-3 py-0.5 text-[10px] font-bold bg-white text-blue-600 rounded shadow-sm border border-slate-200 cursor-default">
                            {zoomLevel}%
                        </div>
                        <button
                            onClick={handleZoomOut}
                            className="px-2 py-0.5 text-slate-500 hover:text-slate-900 transition-colors"
                            title="축소"
                        >
                            <ZoomOut size={14} />
                        </button>
                        <button
                            onClick={handleZoomIn}
                            className="px-2 py-0.5 text-slate-500 hover:text-slate-900 transition-colors"
                            title="확대"
                        >
                            <ZoomIn size={14} />
                        </button>
                        <button
                            onClick={handleZoomReset}
                            className="px-3 py-0.5 text-[10px] text-slate-500 hover:text-blue-600 transition-colors font-medium border-l border-slate-200"
                        >
                            초기화
                        </button>
                    </div>
                    <button
                        onClick={handleZoom100}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded text-[10px] font-bold ml-2 transition-colors flex items-center gap-1 shadow-sm"
                    >
                        <Activity size={10} /> 100%
                    </button>
                </div>
            </header>

            {/* Main Content - 3 Column Layout */}
            <div className="flex flex-1 overflow-hidden relative">

                {/* 1. Left Sidebar (Fixed Width) - Dynamic Width */}
                <div style={{ width: sidebarWidth }} className="bg-white border-r border-slate-200 flex flex-col z-10 shrink-0">
                    <Sidebar
                        currentTool={currentTool}
                        setTool={setTool}
                        calibrationManager={calibrationManager}
                        imageManager={imageManager}
                        onImageManagerChange={handleImageManagerChange}
                        onLoadImage={triggerFileUpload}
                        onCalibrationClick={() => setTool('calibration')}
                        onAnalysisModeChange={setAnalysisMode}
                        onExport={handleExport}
                        onClear={handleClearAll}
                        onBatchAnalyze={handleBatchAnalyze}
                        analysisMode={analysisMode}
                        onBrightnessChange={setBrightness}
                        onContrastChange={setContrast}
                        brightness={brightness}
                        contrast={contrast}
                        onCalibrationFileLoad={loadCalibrationFile}
                        onUndoClick={undo}
                        onRedoClick={redo}
                        alStartThreshold={alStartThreshold}
                        alEndThreshold={alEndThreshold}
                        onAlStartThresholdChange={setAlStartThreshold}
                        onAlEndThresholdChange={setAlEndThreshold}
                        calibrationVersion={calibrationVersion}
                        onAutoAnalyze={handleAutoAnalyze}
                        onCalibrationChange={handleCalibrationChange}
                        appMode={appMode}
                        onAppModeChange={setAppMode}
                        microPhaseMode={microPhaseMode}
                        onMicroPhaseModeChange={setMicroPhaseMode}
                    />
                </div>

                {/* Resizer Left */}
                <div
                    className="w-1 cursor-col-resize bg-slate-200 hover:bg-blue-400 z-20 shrink-0 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); isResizing.current = 'sidebar'; document.body.style.cursor = 'col-resize'; }}
                />

                {/* 2. Center Canvas (Flexible) */}
                <div id="center-panel" className="flex-1 bg-slate-50 relative flex flex-col min-w-0"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                >
                    {/* Image Tabs if multiple */}
                    {imageList.length > 0 && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-white border-b border-slate-200 overflow-x-auto no-scrollbar shrink-0 h-8">
                            {imageList.map((entry, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => switchImage(idx)}
                                    className={`px-3 py-1 text-[10px] cursor-pointer rounded-t-md border-t border-x flex items-center gap-2 min-w-[80px] max-w-[150px] transition-colors ${idx === currentImageIndex
                                        ? 'bg-slate-50 border-slate-200 text-blue-600 font-bold'
                                        : 'bg-white border-transparent text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    <span className="truncate">{entry.name}</span>
                                    {imageList.length > 1 && (
                                        <span className="hover:text-red-500 font-bold"
                                            onClick={(e) => { e.stopPropagation(); deleteImage(idx); }}
                                        >×</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex-1 relative overflow-hidden bg-white">
                        {(!imageManager.image && imageList.length === 0) ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-4 select-none">
                                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-2 border border-slate-200">
                                    <UploadCloud size={32} className="text-slate-300" />
                                </div>
                                <p className="text-sm font-medium text-slate-500">이미지를 드래그 & 드롭하거나<br />버튼을 클릭하여 불러오세요</p>
                            </div>
                        ) : (
                            <CanvasArea
                                ref={canvasHandleRef}
                                imageManager={imageManager}
                                calibrationManager={calibrationManager}
                                measurements={measurements}
                                setMeasurements={setMeasurements}
                                currentTool={currentTool}
                                setTool={setTool}
                                onSelectionChange={handleSelectMeasurement}
                                analysisMode={analysisMode}
                                onProfileUpdate={handleProfileUpdate}
                                onRoughnessProfileUpdate={handleRoughnessProfileUpdate}
                                alStartThreshold={alStartThreshold}
                                alEndThreshold={alEndThreshold}
                                onZoomChange={() => setZoomLevel(imageManager.getDisplayZoom())}
                                highlightLine={highlightLine}
                                roughnessOrientation={roughnessOrientation}
                                imageVersion={imageVersion}
                                microPhaseMode={microPhaseMode}
                                correctionMode={correctionMode}
                                onManualCorrection={(updates: any) => {
                                    if (selectedMeasurement) {
                                        handleUpdateMeasurement(selectedMeasurement, updates, true);
                                    }
                                }}
                            />
                        )}
                    </div>



                    {/* Floating Profile Chart Overlay */}
                    <div id="profile-chart-overlay"
                        style={{
                            left: chartPos.x,
                            top: chartPos.y,
                            width: chartSize.width,
                            height: chartSize.height
                        }}
                        className={`absolute bg-white/95 backdrop-blur-md border border-slate-300 rounded-lg shadow-2xl z-30 flex flex-col transition-opacity duration-300 ${(!imageManager.image || !showProfileChart) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                    >
                        {/* Drag Handle */}
                        <div
                            className="flex items-center justify-between px-3 py-1.5 bg-slate-100/80 rounded-t-lg border-b border-slate-200 cursor-move transition-colors hover:bg-slate-200/80 group shrink-0"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                isResizing.current = 'chart-drag';
                                dragStart.current = { x: e.clientX, y: e.clientY };
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <div className="p-1 bg-blue-500 rounded text-white group-hover:bg-blue-600 transition-colors">
                                    <Activity size={12} />
                                </div>
                                <span className="text-[11px] text-slate-700 font-bold tracking-tight">프로파일 분석 (Profile Analysis)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowProfileChart(false)}
                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                    title="닫기"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Chart Body */}
                        <div className="flex-1 relative p-3 bg-white overflow-hidden rounded-b-lg">
                            <canvas id="profile-chart" className="w-full h-full" />
                        </div>

                        {/* Resize Handle (Bottom Right) */}
                        <div
                            className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-40 group flex items-end justify-end p-1"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                isResizing.current = 'chart-resize';
                                dragStart.current = { x: e.clientX, y: e.clientY };
                            }}
                        >
                            <div className="w-3 h-3 border-b-2 border-r-2 border-slate-300 group-hover:border-blue-500 transition-colors rounded-br-[2px]" />
                        </div>
                    </div>
                </div>

                {/* Resizer Right */}
                <div
                    className="w-1 cursor-col-resize bg-slate-200 hover:bg-blue-400 z-20 shrink-0 transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); isResizing.current = 'results'; document.body.style.cursor = 'col-resize'; }}
                />

                {/* 3. Right Panel (Fixed Width) - Dynamic Width */}
                <div style={{ width: resultsWidth }} className="bg-white border-l border-slate-200 flex flex-col z-10 shrink-0">
                    <ResultsPanel
                        measurements={measurements}
                        calibrationManager={calibrationManager}
                        onDeleteMeasurement={handleDeleteMeasurement}
                        onSelectMeasurement={handleSelectMeasurement}
                        onUpdateMeasurement={handleUpdateMeasurement}
                        selectedMeasurement={selectedMeasurement}
                        addToast={addToast}
                        correctionMode={correctionMode}
                        setCorrectionMode={setCorrectionMode}
                    />
                </div>

            </div>

            {/* Copyright Footer */}
            <footer className="bg-white border-t border-slate-200 py-1.5 px-4 flex justify-between items-center text-[9px] text-slate-400 select-none shrink-0 z-20">
                <div>© 2026 Korloy CVD Development Team.</div>
                <div className="font-medium">Copyright Shin HyeonTae. All rights reserved.</div>
            </footer>

            {/* Toast Container */}
            <div style={{
                position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
                display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320
            }}>
                {toasts.map(t => (
                    <div key={t.id} className={`flex items-start gap-3 p-3 rounded-lg shadow-lg border backdrop-blur-sm animate-fade-in ${t.type === 'success' ? 'bg-emerald-900/90 border-emerald-700 text-emerald-100' :
                        t.type === 'error' ? 'bg-red-900/90 border-red-700 text-red-100' :
                            t.type === 'warning' ? 'bg-amber-900/90 border-amber-700 text-amber-100' :
                                'bg-slate-800/90 border-slate-600 text-slate-100'
                        }`}>
                        <span className="mt-0.5 text-lg">{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : t.type === 'warning' ? '⚠️' : 'ℹ️'}</span>
                        <div className="flex-1">
                            <h4 className="font-bold text-xs mb-0.5">{t.title}</h4>
                            <p className="text-[11px] opacity-90 leading-tight">{t.message}</p>
                        </div>
                        <button onClick={() => removeToast(t.id)} className="text-current opacity-50 hover:opacity-100">
                            <RotateCcw size={12} className="rotate-45" /> {/* Use X icon if available, reusing rotate for close */}
                        </button>
                    </div>
                ))}
            </div>

            {/* Custom Debug Overlay */}
            <DebugOverlay
                isOpen={showDebug}
                onClose={() => setShowDebug(false)}
                data={{
                    measurements,
                    calibration: calibrationManager,
                    image: imageManager.image ? { width: imageManager.image.width, height: imageManager.image.height } : null,
                    imagesLoad: imageList.length
                }}
            />

            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*,.cal,.png,.jpg,.jpeg,.bmp,.tif,.tiff,.ang,.osc"
                multiple
                onChange={handleFileChange}
            />
        </div >
    );

};

export default App;

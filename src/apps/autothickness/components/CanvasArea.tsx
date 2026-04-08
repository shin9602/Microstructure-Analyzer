import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { ImageManager } from '../services/ImageManager';
import type { CalibrationManager } from '../services/CalibrationManager';
import { Measurement } from '../services/Measurement';
import { AutoAnalyzer } from '../services/AutoAnalyzer';
import { EdgeDetector } from '../services/EdgeDetector';
import { MicrostructureAnalyzer } from '../services/MicrostructureAnalyzer';

export interface CanvasAreaProps {
    imageManager: ImageManager;
    calibrationManager: CalibrationManager;
    measurements: Measurement[];
    setMeasurements: React.Dispatch<React.SetStateAction<Measurement[]>>;
    currentTool: string | null;
    setTool: (tool: string | null) => void;
    onSelectionChange: (m: Measurement | null) => void;
    analysisMode: string;
    onProfileUpdate?: (profile: any[], boundaries: number[], labels: string[], extraSeries?: number[][]) => void;
    onRoughnessProfileUpdate?: (profile: any[], roughness: any) => void;
    alStartThreshold: number;
    alEndThreshold: number;
    onZoomChange?: () => void;
    highlightLine?: { type: 'vertical' | 'horizontal'; pos: number; start: number; end: number } | null;
    roughnessOrientation: 'horizontal' | 'vertical';
    imageVersion?: number;
    microPhaseMode: '2-phase' | '3-phase';
    correctionMode?: 'merge' | 'split' | 'reassign' | null;
    onManualCorrection?: (updates: any) => void;
}

export interface CanvasAreaHandle {
    fitToCanvas: () => void;
    autoMeasure: () => void;
    toggleEdgeView: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    zoom100: () => void;
    redraw: () => void;
}

const CanvasArea = forwardRef<CanvasAreaHandle, CanvasAreaProps>((props, ref) => {
    const {
        imageManager, calibrationManager, measurements, setMeasurements,
        currentTool, setTool, onSelectionChange, analysisMode,
        onProfileUpdate, onRoughnessProfileUpdate, alStartThreshold, alEndThreshold,
        imageVersion, microPhaseMode, correctionMode, onManualCorrection
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Interaction state
    const [isPanning, setIsPanning] = useState(false);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isShiftPressed, setIsShiftPressed] = useState(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const currentRoiRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

    // Click/Drag state
    const firstClickRef = useRef<{ x: number; y: number } | null>(null);
    const guideLineRef = useRef<{ x: number; y: number } | null>(null);
    const isDrawingRef = useRef(false);

    // Edge view
    const [showEdges, setShowEdges] = useState(false);
    const edgeCanvasRef = useRef<HTMLCanvasElement | null>(null);

    const rafRef = useRef<number | null>(null);

    // --- Helpers (Defined before use) ---

    // Draw grid helper
    // Grid removed

    // Clamp coordinates to image boundaries
    const clampToImage = useCallback((coord: { x: number, y: number }) => {
        if (!imageManager.image) return coord;
        return {
            x: Math.max(0, Math.min(imageManager.image.width, coord.x)),
            y: Math.max(0, Math.min(imageManager.image.height, coord.y))
        };
    }, [imageManager.image]);

    // Redraw logic
    const redraw = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);

        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const canvas = canvasRef.current;
            if (!canvas || !imageManager.ctx) return;
            const ctx = imageManager.ctx;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw image
            if (showEdges && edgeCanvasRef.current && imageManager.image) {
                ctx.save();
                if (imageManager.brightness !== 100 || imageManager.contrast !== 100) {
                    ctx.filter = `brightness(${imageManager.brightness}%) contrast(${imageManager.contrast}%)`;
                }
                ctx.translate(imageManager.offsetX, imageManager.offsetY);
                ctx.scale(imageManager.scale, imageManager.scale);
                ctx.drawImage(edgeCanvasRef.current, 0, 0);
                ctx.restore();
            } else {
                imageManager.draw();
            }



            measurements.forEach(m => m.draw(ctx, imageManager, calibrationManager));

            // Draw Guide (Active tool)
            if (firstClickRef.current && guideLineRef.current && currentTool) {
                ctx.save();
                ctx.translate(imageManager.offsetX, imageManager.offsetY);
                ctx.scale(imageManager.scale, imageManager.scale);
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 1.5 / imageManager.scale;
                ctx.globalAlpha = 0.7;
                ctx.setLineDash([5 / imageManager.scale, 3 / imageManager.scale]);

                const start = firstClickRef.current;
                const end = guideLineRef.current;

                if (currentTool === 'rectangle' || currentTool === 'area-profile' || currentTool === 'profile' || currentTool === 'microstructure') {
                    const rx = Math.min(start.x, end.x);
                    const ry = Math.min(start.y, end.y);
                    const rw = Math.abs(end.x - start.x);
                    const rh = Math.abs(end.y - start.y);

                    ctx.strokeRect(rx, ry, rw, rh);

                    // Add label for microstructure
                    if (currentTool === 'microstructure') {
                        ctx.save();
                        ctx.setLineDash([]);
                        ctx.fillStyle = '#3b82f6';
                        ctx.font = `${Math.max(10, 12 / imageManager.scale)}px sans-serif`;
                        const label = microPhaseMode === '3-phase' ? '3-phase (WC-γ-Co)' : '2-phase (WC-Co)';
                        const textWidth = ctx.measureText(label).width;
                        const padding = 4 / imageManager.scale;

                        ctx.fillRect(rx, ry - (18 / imageManager.scale), textWidth + padding * 2, 18 / imageManager.scale);
                        ctx.fillStyle = 'white';
                        ctx.fillText(label, rx + padding, ry - (5 / imageManager.scale));
                        ctx.restore();
                    }
                } else if (currentTool === 'line' || currentTool === 'calibration' || currentTool === 'parallel') {
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // Draw current ROI highlight
            if (currentRoiRef.current) {
                ctx.save();
                ctx.translate(imageManager.offsetX, imageManager.offsetY);
                ctx.scale(imageManager.scale, imageManager.scale);
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 1 / imageManager.scale;
                ctx.setLineDash([3 / imageManager.scale, 3 / imageManager.scale]);
                const roi = currentRoiRef.current;
                ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
                ctx.restore();
            }
            // Draw profile highlight line
            if (props.highlightLine) {
                const { type, pos, start, end } = props.highlightLine;
                ctx.save();
                ctx.translate(imageManager.offsetX, imageManager.offsetY);
                ctx.scale(imageManager.scale, imageManager.scale);
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 1.5 / imageManager.scale;
                ctx.setLineDash([4 / imageManager.scale, 3 / imageManager.scale]);
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                if (type === 'vertical') {
                    ctx.moveTo(pos, start);
                    ctx.lineTo(pos, end);
                } else {
                    ctx.moveTo(start, pos);
                    ctx.lineTo(end, pos);
                }
                ctx.stroke();
                ctx.restore();
            }
        });
    }, [imageManager, measurements, currentTool, showEdges, calibrationManager, props.highlightLine]);

    // Automatically redraw when measurements or other visual props change
    useEffect(() => {
        redraw();
    }, [measurements, showEdges, currentTool, redraw, props.highlightLine, imageVersion]);

    // Cleanup RAF on unmount
    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    // Fit to canvas
    const fitToCanvas = useCallback(() => {
        if (!canvasRef.current || !containerRef.current) return;
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        imageManager.setCanvas(canvasRef.current);
        imageManager.fitToCanvas();
        redraw();
    }, [imageManager, redraw]);

    // Perform Auto Measure
    const performAutoMeasure = useCallback(() => {
        let roi = currentRoiRef.current;
        if (!roi) {
            if (imageManager.image) {
                roi = { x: 0, y: 0, width: imageManager.image.width, height: imageManager.image.height };
                currentRoiRef.current = roi;
            } else return;
        }

        const imageData = imageManager.getImageData();
        if (!imageData) return;

        const profile = AutoAnalyzer.getVerticalMedianProfile(imageData, roi);
        if (profile.length < 5) return;

        if (!calibrationManager.pixelsPerUnit) return;
        const oneMicronPixels = Math.round(calibrationManager.realToPixels(1.0) || 0);
        const { boundaries, labels: labelOrder } = AutoAnalyzer.analyzeCvdCoating(
            profile, oneMicronPixels, { alStartThreshold, alEndThreshold }
        );

        boundaries.sort((a, b) => a - b);

        const summary: Record<string, number> = {};
        const segments: any[] = [];
        const boundaryPoints = [0, ...boundaries, profile.length];

        let substrateCalculated = false;
        let totalSubstrateHeight = 0;
        let substrateYStart = -1;

        for (let i = 0; i < boundaryPoints.length - 1; i++) {
            const yStart = boundaryPoints[i];
            const yEnd = boundaryPoints[i + 1];
            let label = i < labelOrder.length ? labelOrder[i] : '모재';
            const realHeight = calibrationManager.pixelsToReal(yEnd - yStart) || 0;

            if (label === '모재' || label === 'Substrate') {
                if (!substrateCalculated) {
                    substrateYStart = yStart; substrateCalculated = true;
                }
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
                    yStart: yStart + roi.y, yEnd: yEnd + roi.y
                });
            }
        }

        if (substrateCalculated) {
            summary['모재'] = totalSubstrateHeight;
            segments.push({
                label: '모재', thickness: totalSubstrateHeight, yStart: substrateYStart + roi.y,
                yEnd: (segments.length > 0 ? segments[segments.length - 1].yEnd : profile.length - 1 + (roi?.y || 0))
            });
        }

        const areaMeas = new Measurement('area-profile', {
            results: summary, segments: segments, boundaries: boundaries, roi: { ...roi },
            profileData: profile.map(p => ({
                ...p,
                distancePixels: p.distance,
                distance: calibrationManager.pixelsToReal(p.distance)
            })),
            timestamp: new Date().toLocaleTimeString()
        });

        setMeasurements(prev => [...prev.filter(m => m.type !== 'area-profile'), areaMeas]);
        if (onSelectionChange) onSelectionChange(areaMeas);
        if (onProfileUpdate) {
            const calibratedProfile = profile.map(p => ({ ...p, distancePixels: p.distance, distance: calibrationManager.pixelsToReal(p.distance) }));
            onProfileUpdate(calibratedProfile, boundaries, labelOrder);
        }
        redraw();
    }, [imageManager, calibrationManager, setMeasurements, redraw, onProfileUpdate, alStartThreshold, alEndThreshold, onSelectionChange]);

    // Perform Roughness Analysis on a given ROI
    const performRoughnessOnROI = useCallback((roi: { x: number, y: number, width: number, height: number }, orientation: 'horizontal' | 'vertical') => {
        const imageData = imageManager.getImageData();
        if (!imageData) return;

        // Get profile based on orientation
        const profile = orientation === 'horizontal'
            ? AutoAnalyzer.getHorizontalMedianProfile(imageData, roi)
            : AutoAnalyzer.getVerticalMedianProfile(imageData, roi);

        if (profile.length < 5) return;

        // Calculate roughness parameters
        const roughness = AutoAnalyzer.calculateRoughness(profile);

        // Create calibrated profile data
        const calibratedProfile = profile.map(p => ({
            ...p,
            distancePixels: p.distance,
            distance: calibrationManager.pixelsToReal(p.distance)
        }));

        // Create a profile measurement
        const profileMeas = new Measurement('profile', {
            roi: { ...roi },
            orientation,
            profileData: calibratedProfile,
            roughness: roughness,
            timestamp: new Date().toLocaleTimeString()
        });

        setMeasurements(prev => [...prev, profileMeas]);
        if (onSelectionChange) onSelectionChange(profileMeas);
        if (onRoughnessProfileUpdate) {
            onRoughnessProfileUpdate(calibratedProfile, roughness);
        }
        redraw();
    }, [imageManager, calibrationManager, setMeasurements, redraw, onSelectionChange, onRoughnessProfileUpdate]);

    const completeMeasurement = useCallback((start: { x: number, y: number }, end: { x: number, y: number }) => {
        firstClickRef.current = null;
        guideLineRef.current = null;
        isDrawingRef.current = false;

        if (currentTool === 'rectangle' || currentTool === 'area-profile' || currentTool === 'profile' || currentTool === 'microstructure') {
            const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
            const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
            
            // 공통 ROI 갱신 (모든 ROI 도구에 대해)
            currentRoiRef.current = { x, y, width: w, height: h };
            console.log(`[ROI Set] ${currentTool}: x=${Math.round(x)}, y=${Math.round(y)}, w=${Math.round(w)}, h=${Math.round(h)}`);

            if (w > 2 && h > 2) {
                if (currentTool === 'area-profile') {
                    performAutoMeasure();
                } else if (currentTool === 'microstructure') {
                    console.log(`Starting ${currentTool} Analysis...`, { x, y, width: w, height: h });
                    const imageData = imageManager.getImageData();
                    if (imageData) {
                        try {
                            const analysisParams = {
                                mode: 'classic' as const,
                                phaseMode: microPhaseMode,
                                targetStep: 0
                            };

                            const result = MicrostructureAnalyzer.analyze(
                                imageData,
                                { x, y, width: w, height: h },
                                analysisParams
                            );

                            const meas = new Measurement(currentTool as any, {
                                ...result,
                                mode: 'classic',
                                phaseMode: microPhaseMode,
                                targetStep: 0,
                                x: Math.round(x),
                                y: Math.round(y),
                                width: result.width,
                                height: result.height,
                                roi: { x: Math.round(x), y: Math.round(y), width: result.width, height: result.height },
                                wcFraction: result.wcFraction || 0
                            });

                            // Select the new measurement
                            meas.selected = true;
                            setMeasurements(prev => {
                                prev.forEach(m => m.selected = false);
                                return [...prev, meas];
                            });
                            onSelectionChange(meas);

                            // Call Profile Update to show chart
                            if (onProfileUpdate && result && result.histogram) {
                                const chartData = result.histogram.map((val: number, idx: number) => ({
                                    distance: idx,
                                    value: val
                                }));
                                const boundaries: number[] = [];
                                const labels: string[] = [];
                                if (result.t1 !== undefined) { boundaries.push(result.t1); labels.push('T1'); }
                                if (result.t2 !== undefined) { boundaries.push(result.t2); labels.push('T2'); }

                                onProfileUpdate(chartData, boundaries, labels, result.gmmCurves);
                            }

                        } catch (e) {
                            console.error(`${currentTool} Analysis Failed:`, e);
                        }
                    }
                    // setTool(null); // Keep tool active for continuous analysis
                } else if (currentTool === 'profile') {
                    // Roughness analysis on selected area (Using explicit orientation)
                    performRoughnessOnROI({ x, y, width: w, height: h }, props.roughnessOrientation);
                } else {
                    const meas = new Measurement('rectangle', { x, y, width: w, height: h });
                    const imageData = imageManager.getImageData();
                    if (imageData && onProfileUpdate) {
                        const profile = AutoAnalyzer.getVerticalMedianProfile(imageData, { x, y, width: w, height: h });
                        const calibratedProfile = profile.map(p => ({
                            ...p,
                            distancePixels: p.distance,
                            distance: calibrationManager.pixelsToReal(p.distance)
                        }));
                        onProfileUpdate(calibratedProfile, [], []);
                        meas.data.profileData = calibratedProfile;
                    }
                    setMeasurements(prev => [...prev, meas]);
                }
            }
        } else if (currentTool === 'line') {
            const meas = new Measurement('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y });
            const imageData = imageManager.getImageData();
            if (imageData && onProfileUpdate) {
                const points = AutoAnalyzer.getLineProfile(imageData, start, end);
                onProfileUpdate(points.map(p => ({ ...p, distance: calibrationManager.pixelsToReal(p.distance) })), [], []);
                meas.data.profileData = points;
            }
            setMeasurements(prev => [...prev, meas]);
        } else if (currentTool === 'calibration') {
            const length = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
            const realLength = window.prompt(`길이: ${length.toFixed(1)}px\n실제 길이를 입력하세요 (${calibrationManager.unit}):`);
            if (realLength && parseFloat(realLength) > 0) {
                calibrationManager.setCalibration(length, parseFloat(realLength), calibrationManager.unit, '', '');
            }
            setTool(null);
        } else if (correctionMode === 'split') {
            // Manual Split logic
            const selected = measurements.find(m => m.selected && m.type === 'microstructure');
            if (selected && onManualCorrection) {
                const rect = selected.data.roi || selected.data;
                const p1 = { x: start.x - rect.x, y: start.y - rect.y };
                const p2 = { x: end.x - rect.x, y: end.y - rect.y };
                
                const success = MicrostructureAnalyzer.manualSplit(selected.data, [p1, p2]);
                if (success && onManualCorrection) {
                    onManualCorrection({ _refresh: Date.now() });
                }
            }
        }
        redraw();
    }, [currentTool, imageManager, calibrationManager, setMeasurements, redraw, onProfileUpdate, setTool, performAutoMeasure, performRoughnessOnROI, correctionMode, onManualCorrection, measurements]);

    const toggleEdgeView = useCallback(() => {
        if (!showEdges) {
            if (!imageManager.image) return;
            const imageData = imageManager.getImageData();
            if (!imageData) return;
            const edges = EdgeDetector.cannyEdgeDetection(imageData, 15, 40);
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = imageData.width; tempCanvas.height = imageData.height;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) return;
            const outputImg = tempCtx.createImageData(imageData.width, imageData.height);
            for (let i = 0; i < edges.length; i++) {
                const val = edges[i];
                outputImg.data[i * 4] = val; outputImg.data[i * 4 + 1] = val;
                outputImg.data[i * 4 + 2] = val; outputImg.data[i * 4 + 3] = 255;
            }
            tempCtx.putImageData(outputImg, 0, 0);
            edgeCanvasRef.current = tempCanvas; setShowEdges(true);
        } else {
            setShowEdges(false); edgeCanvasRef.current = null;
        }
        redraw();
    }, [showEdges, imageManager, redraw]);

    // Mouse Handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const imgCoord = imageManager.screenToImage(sx, sy);

        if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
            setIsPanning(true);
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            return;
        }

        if (e.button !== 0) return;

        if (currentTool) {
            const clampedCoord = clampToImage(imgCoord);
            if (!firstClickRef.current) {
                firstClickRef.current = { x: clampedCoord.x, y: clampedCoord.y };
                guideLineRef.current = { x: clampedCoord.x, y: clampedCoord.y };
                isDrawingRef.current = true;
            } else {
                let end = { x: clampedCoord.x, y: clampedCoord.y };
                if (isShiftPressed) {
                    const start = firstClickRef.current;
                    if (Math.abs(end.x - start.x) > Math.abs(end.y - start.y)) end.y = start.y;
                    else end.x = start.x;
                }
                completeMeasurement(firstClickRef.current, end);
            }
            return;
        }

        // --- Manual Correction Mode Clicks ---
        if (correctionMode && correctionMode !== 'split') {
            const selected = measurements.find(m => m.selected && m.type === 'microstructure');
            if (selected) {
                const rect = selected.data.roi || selected.data;
                const localX = imgCoord.x - rect.x;
                const localY = imgCoord.y - rect.y;

                if (localX >= 0 && localX < rect.width && localY >= 0 && localY < rect.height) {
                    if (correctionMode === 'merge') {
                        const success = MicrostructureAnalyzer.manualMerge(selected.data, localX, localY);
                        if (success && onManualCorrection) onManualCorrection({ _refresh: Date.now() });
                    } else if (correctionMode === 'reassign') {
                        const label = selected.data.labels![localY * rect.width + localX];
                        // 배경(0) 혹은 유효하지 않은 레이블 예외 처리
                        if (label > 0 && selected.data.labelPhase) {
                            const currentPhase = selected.data.labelPhase[label] || 0;
                            const nextPhase = (currentPhase + 1) % 3;
                            const success = MicrostructureAnalyzer.manualReassign(selected.data, localX, localY, nextPhase);
                            if (success && onManualCorrection) onManualCorrection({ _refresh: Date.now() });
                        }
                    }
                    return;
                }
            }
        }
        
        // Manual Split starts here (as a line tool)
        if (correctionMode === 'split') {
            const clampedCoord = clampToImage(imgCoord);
            if (!firstClickRef.current) {
                firstClickRef.current = { x: clampedCoord.x, y: clampedCoord.y };
                guideLineRef.current = { x: clampedCoord.x, y: clampedCoord.y };
                isDrawingRef.current = true;
                return;
            }
        }

        // Selection
        let found: Measurement | null = null;
        for (let i = measurements.length - 1; i >= 0; i--) {
            if (measurements[i].containsPoint(imgCoord.x, imgCoord.y, imageManager)) {
                found = measurements[i]; break;
            }
        }
        onSelectionChange(found);
        if (found && found.data.profileData && onProfileUpdate) {
            onProfileUpdate(found.data.profileData.map((p: any) => ({ ...p, distance: calibrationManager.pixelsToReal(p.distance) })), [], []);
        }
    }, [currentTool, isSpacePressed, isShiftPressed, imageManager, measurements, onSelectionChange, completeMeasurement, calibrationManager.pixelsToReal, onProfileUpdate]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const imgCoord = imageManager.screenToImage(sx, sy);

        if (isPanning) {
            imageManager.pan(e.clientX - lastMousePos.current.x, e.clientY - lastMousePos.current.y);
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            redraw(); return;
        }

        if (firstClickRef.current) {
            const clampedCoord = clampToImage(imgCoord);
            let end = { x: clampedCoord.x, y: clampedCoord.y };
            if (isShiftPressed && (currentTool === 'line' || currentTool === 'calibration' || correctionMode === 'split')) {
                const start = firstClickRef.current;
                if (Math.abs(end.x - start.x) > Math.abs(end.y - start.y)) end.y = start.y;
                else end.x = start.x;
            }
            guideLineRef.current = end;
            redraw();
        }
    }, [isPanning, isShiftPressed, currentTool, imageManager, redraw]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        if (isPanning) {
            setIsPanning(false);
            return;
        }

        if (isDrawingRef.current && firstClickRef.current && guideLineRef.current) {
            const start = firstClickRef.current;
            const end = guideLineRef.current;
            const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));

            // 드래그 방식 지원: 일정 거리 이상 움직인 상태에서 마우스를 떼면 즉시 완성
            if (dist * imageManager.scale > 10) {
                completeMeasurement(start, end);
            }
            // 작은 움직임이나 단순 클릭의 경우 클릭-투-클릭 모드로 유지 (firstClickRef를 지우지 않음)
        }
    }, [isPanning, imageManager.scale, completeMeasurement]);

    // Wheel Handler
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            imageManager.zoom(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
            redraw();
            props.onZoomChange?.();
        };
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', onWheel);
    }, [imageManager, redraw, props.onZoomChange]);

    // Keys
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === 'Space') { setIsSpacePressed(true); if (e.target === document.body) e.preventDefault(); }
            if (e.shiftKey) setIsShiftPressed(true);
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') setIsSpacePressed(false);
            if (!e.shiftKey) setIsShiftPressed(false);
        };
        window.addEventListener('keydown', down); window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, []);

    useImperativeHandle(ref, () => ({
        fitToCanvas: () => { fitToCanvas(); props.onZoomChange?.(); },
        redraw, autoMeasure: performAutoMeasure, toggleEdgeView,
        zoomIn: () => { imageManager.zoomIn(); redraw(); props.onZoomChange?.(); },
        zoomOut: () => { imageManager.zoomOut(); redraw(); props.onZoomChange?.(); },
        zoom100: () => { imageManager.fitToCanvas(); redraw(); props.onZoomChange?.(); }
    }), [fitToCanvas, redraw, performAutoMeasure, toggleEdgeView, imageManager, props.onZoomChange]);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-slate-50 select-none">
            <canvas id="main-canvas" ref={canvasRef} className={`w-full h-full block ${isPanning ? 'cursor-grabbing' : (isSpacePressed ? 'cursor-grab' : (correctionMode ? 'cursor-cell' : 'cursor-crosshair'))}`}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onContextMenu={e => e.preventDefault()} />
            <div className="absolute top-2 right-2 px-2 py-1 bg-white/80 text-slate-600 text-[10px] border border-slate-200 rounded-md shadow-sm pointer-events-none font-bold">
                {imageManager.getDisplayZoom()}%
            </div>
            {correctionMode && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-full shadow-lg border-2 border-amber-400 flex items-center gap-2 animate-bounce">
                    <span>⚠️ 보정 모드 활성: {correctionMode.toUpperCase()}</span>
                    <button onClick={() => props.setTool?.(null)} className="ml-2 bg-white/20 hover:bg-white/30 rounded px-2">ESC로 종료</button>
                </div>
            )}
        </div>
    );
});

CanvasArea.displayName = 'CanvasArea';
export { CanvasArea };

/**
 * Measurement class
 * Ported from AutoThickness_v1.0.0/app.js Measurement class
 */

import type { ImageManager } from './ImageManager';
import type { CalibrationManager } from './CalibrationManager';
import { OM_LAYER_ORDER, formatOMLayer, type OMLayerName, type OMLayerReport } from './OMLayerAnalyzer';

/** OM 층 자동측정 오버레이 색 */
export const OM_LAYER_COLORS: Record<string, string> = {
    Al2O3: '#a855f7',
    Bonding: '#f59e0b',
    TiCN: '#22c55e',
};

export class Measurement {
    id: number;
    type: string; // 'line', 'rectangle', 'auto', 'color-segment', 'parallel', 'profile', 'area-profile'
    data: any;
    selected: boolean;
    locked: boolean;

    constructor(type: string, data: any) {
        this.id = Date.now() + Math.random();
        this.type = type;
        this.data = data;
        this.selected = false;
        this.locked = false;
    }

    draw(ctx: CanvasRenderingContext2D, imageManager: ImageManager, calibrationManager: CalibrationManager, isHovered: boolean = false) {
        ctx.save();
        ctx.translate(imageManager.offsetX, imageManager.offsetY);
        ctx.scale(imageManager.scale, imageManager.scale);

        // Unified style: always dashed, always simpler alpha
        // Selection is indicated ONLY by color (orange) as requested

        ctx.setLineDash([5 / imageManager.scale, 3 / imageManager.scale]);
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.5 / imageManager.scale;

        // No shadow to match user request "completely identical style"
        ctx.shadowBlur = 0;

        ctx.strokeStyle = this.getColor();
        ctx.fillStyle = this.getColor();

        if (this.type === 'line' || this.type === 'auto' || this.type === 'parallel') {
            this.drawLine(ctx, imageManager, calibrationManager);
        } else if (this.type === 'om-layers') {
            this.drawOMLayers(ctx, imageManager, calibrationManager);
        } else if (this.type === 'profile') {
            if (this.data.roi) {
                // Roughness profile: keep specific style but respect selection
                const rectData = this.data.roi;
                ctx.save();
                if (!this.selected && !isHovered) {
                    // Default style
                } else {
                    // Selected style (orange)
                }
                ctx.setLineDash([6 / imageManager.scale, 4 / imageManager.scale]);
                ctx.globalAlpha = 0.5; // Always semi-transparent for ROI rect
                ctx.strokeRect(rectData.x, rectData.y, rectData.width, rectData.height);
                ctx.restore();
                // Show roughness summary on image
                if (this.data.roughness) {
                    const r = this.data.roughness;
                    const text = `Ra:${r.Ra.toFixed(2)} Rq:${r.Rq.toFixed(2)} Rt:${r.Rt.toFixed(2)}`;
                    this.drawLabel(ctx, imageManager, rectData.x + rectData.width / 2, rectData.y + 15 / imageManager.scale, text, 'center');
                }
            }
        } else if (this.type === 'rectangle' || this.type === 'color-segment' || this.type === 'area-profile') {
            const rectData = this.type === 'area-profile' ? this.data.roi : this.data;
            if (rectData) {
                ctx.strokeRect(rectData.x, rectData.y, rectData.width, rectData.height);

                // Draw detected boundaries for area-profile
                if (this.type === 'area-profile' && this.data.boundaries && this.data.boundaries.length > 0) {
                    ctx.save();
                    ctx.strokeStyle = '#ef4444';
                    ctx.lineWidth = 1 / imageManager.scale;
                    ctx.setLineDash([4 / imageManager.scale, 4 / imageManager.scale]);

                    ctx.beginPath();
                    this.data.boundaries.forEach((yRel: number) => {
                        const yAbs = rectData.y + yRel;
                        ctx.moveTo(rectData.x, yAbs);
                        ctx.lineTo(rectData.x + rectData.width, yAbs);
                    });
                    ctx.stroke();
                    ctx.restore();

                    // Draw Labels and thickness on image
                    if (this.data.segments) {
                        this.data.segments.forEach((seg: any) => {
                            const midY = (seg.yStart + seg.yEnd) / 2;
                            const text = `${seg.label}: ${seg.thickness.toFixed(2)}${calibrationManager.unit}`;
                            // Offset a bit from the left edge of ROI for visibility
                            this.drawLabel(ctx, imageManager, rectData.x + 5 / imageManager.scale, midY, text, 'left');
                        });
                    }
                }

                // For normal rectangles, show dimensions if selected
                if (this.type === 'rectangle' && (this.selected || isHovered)) {
                    const { width, height } = this.data;
                    const dimText = `${width.toFixed(0)} × ${height.toFixed(0)}`;
                    this.drawLabel(ctx, imageManager, rectData.x + rectData.width / 2, rectData.y + rectData.height + 15 / imageManager.scale, dimText, 'center');
                }
            }
        } else if (this.type === 'microstructure') {
            const { x, y, width, height, overlayData, grainCount, avgGrainSize } = this.data;
            if (overlayData) {
                // [추가] Debug Step Index 지원
                const stepIdx = this.data.debugStepIndex;
                let activeOverlay = overlayData;
                let cacheKey = '_cachedBitmap';

                if (stepIdx !== undefined && this.data.debugSteps && this.data.debugSteps[stepIdx]) {
                    activeOverlay = this.data.debugSteps[stepIdx].data;
                    cacheKey = `_cachedBitmap_step_${stepIdx}`;
                }

                // Determine bitmap cache
                if (!this.data[cacheKey]) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = width;
                    tempCanvas.height = height;
                    const tCtx = tempCanvas.getContext('2d');
                    if (tCtx) {
                        const iData = new ImageData(activeOverlay, width, height);
                        tCtx.putImageData(iData, 0, 0);
                        this.data[cacheKey] = tempCanvas;
                    }
                }
                if (this.data[cacheKey]) {
                    ctx.drawImage(this.data[cacheKey], x, y);
                }
            }
            ctx.strokeRect(x, y, width, height);

            // Draw stats text
            if (grainCount !== undefined) {
                const text = `WC: ${grainCount} | Avg: ${avgGrainSize.toFixed(1)}px`;
                this.drawLabel(ctx, imageManager, x + width / 2, y - 15 / imageManager.scale, text, 'center');
            }

            // Draw Phase Legend
            if (this.selected) {
                const padding = 10 / imageManager.scale;
                const legendX = x + width + padding;
                const legendY = y;
                const boxSize = 12 / imageManager.scale;
                const lineSpacing = 18 / imageManager.scale;

                // Legend entries: Label, Color (Fill), TextColor
                const legends = [
                    { label: 'WC (Heavy)', color: '#ffffff', textColor: '#000000' },
                    { label: 'Co (Light)', color: '#000000', textColor: '#ffffff' }
                ];

                ctx.save();
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = `${12 / imageManager.scale}px Inter, sans-serif`;

                legends.forEach((item, idx) => {
                    const currentY = legendY + (idx * lineSpacing);

                    // Draw color box stroke
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 1 / imageManager.scale;
                    ctx.strokeRect(legendX, currentY, boxSize, boxSize);

                    // Draw color box fill
                    ctx.fillStyle = item.color;
                    ctx.fillRect(legendX, currentY, boxSize, boxSize);

                    // Draw text background for visibility
                    const textX = legendX + boxSize + (5 / imageManager.scale);
                    const textY = currentY + boxSize / 2;
                    const textWidth = ctx.measureText(item.label).width;

                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(textX - (2 / imageManager.scale), currentY - (2 / imageManager.scale), textWidth + (4 / imageManager.scale), boxSize + (4 / imageManager.scale));

                    // Draw label text
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(item.label, textX, textY);
                });

                ctx.restore();
            }
        }

        ctx.restore();
    }

    drawLine(ctx: CanvasRenderingContext2D, imageManager: ImageManager, calibrationManager: CalibrationManager) {
        const { x1, y1, x2, y2 } = this.data;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Draw endpoints if selected
        if (this.selected) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(x1, y1, 5 / imageManager.scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x2, y2, 5 / imageManager.scale, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw label
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;

        const label = this.data.layerType
            ? `[${this.data.layerType}] ${calibrationManager.formatMeasurement(length)} | ${angle.toFixed(1)}°`
            : `${calibrationManager.formatMeasurement(length)} | ${angle.toFixed(1)}°`;
        this.drawLabel(ctx, imageManager, midX, midY - 10 / imageManager.scale, label);
    }

    drawOMLayers(ctx: CanvasRenderingContext2D, imageManager: ImageManager, calibrationManager: CalibrationManager) {
        type Pt = { x: number; y: number };
        const lines = this.data.lines as Record<OMLayerName, { top: Pt[]; bottom: Pt[] }> | undefined;
        const layers = this.data.layers as Record<OMLayerName, OMLayerReport> | undefined;
        if (!lines || !layers) return;
        const unit = calibrationManager.unit;
        const bands = OM_LAYER_ORDER
            .filter(L => layers[L]?.status === 'present' && lines[L]?.top?.length >= 2)
            .map(L => ({ key: L, upper: lines[L].top, lower: lines[L].bottom, color: OM_LAYER_COLORS[L] }));
        if (bands.length === 0) return;

        ctx.save();
        ctx.setLineDash([]);
        for (const b of bands) {
            ctx.beginPath();
            ctx.moveTo(b.upper[0].x, b.upper[0].y);
            for (let i = 1; i < b.upper.length; i++) ctx.lineTo(b.upper[i].x, b.upper[i].y);
            for (let i = b.lower.length - 1; i >= 0; i--) ctx.lineTo(b.lower[i].x, b.lower[i].y);
            ctx.closePath();
            ctx.globalAlpha = this.selected ? 0.32 : 0.22;
            ctx.fillStyle = b.color;
            ctx.fill();
        }
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 2 / imageManager.scale;
        const strokePoly = (pts: Pt[], color: string, dashed: boolean) => {
            if (pts.length < 2) return;
            ctx.setLineDash(dashed ? [8 / imageManager.scale, 6 / imageManager.scale] : []);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.strokeStyle = color;
            ctx.stroke();
        };
        for (const b of bands) {
            const amb = !!layers[b.key]?.ambiguous;
            strokePoly(b.upper, '#ffffff', amb);
            strokePoly(b.lower, b.color, amb);
        }
        ctx.restore();

        const ref = bands[0];
        const first = ref.upper[0], last = ref.upper[ref.upper.length - 1];
        const horizontal = Math.abs(last.x - first.x) >= Math.abs(last.y - first.y);
        const lineH = 22;
        OM_LAYER_ORDER.forEach((L, bi) => {
            const band = bands.find(b => b.key === L);
            const report = layers[L];
            if (!report) return;
            const text = formatOMLayer(L, report, unit);
            const anchor = band ?? ref;
            const i1 = anchor.upper.length - 1;
            const it = {
                text, color: band ? band.color : '#94a3b8', absent: !band,
                p0: { x: (anchor.upper[0].x + anchor.lower[0].x) / 2, y: (anchor.upper[0].y + anchor.lower[0].y) / 2 },
                p1: { x: (anchor.upper[i1].x + anchor.lower[i1].x) / 2, y: (anchor.upper[i1].y + anchor.lower[i1].y) / 2 },
            };
            if (horizontal) {
                const leftFirst = it.p0.x <= it.p1.x;
                const off = it.absent ? { dx: 0, dy: lineH * (bi + 1) } : undefined;
                this.drawLabel(ctx, imageManager, it.p0.x, it.p0.y, it.text, leftFirst ? 'left' : 'right', it.color, off);
                this.drawLabel(ctx, imageManager, it.p1.x, it.p1.y, it.text, leftFirst ? 'right' : 'left', it.color, off);
            } else {
                const topFirst = it.p0.y <= it.p1.y;
                const stackTop = { dx: 0, dy: lineH * (bi + 1) };
                const stackBottom = { dx: 0, dy: -lineH * (OM_LAYER_ORDER.length - bi) };
                this.drawLabel(ctx, imageManager, it.p0.x, it.p0.y, it.text, 'center', it.color, topFirst ? stackTop : stackBottom);
                this.drawLabel(ctx, imageManager, it.p1.x, it.p1.y, it.text, 'center', it.color, topFirst ? stackBottom : stackTop);
            }
        });
        const flags = (this.data.flags || []) as string[];
        if (flags.length) {
            const mid = Math.floor(ref.upper.length / 2);
            this.drawLabel(ctx, imageManager, ref.upper[mid].x, ref.upper[mid].y, `★ ${flags.join('; ')}`, 'center', '#f59e0b', { dx: 0, dy: -lineH });
        }
    }

    drawLabel(ctx: CanvasRenderingContext2D, imageManager: ImageManager, x: number, y: number, text: string, align: 'center' | 'left' | 'right' = 'center', accent?: string, screenOffset?: { dx: number; dy: number }) {
        ctx.save();
        ctx.resetTransform();

        const screenPos = imageManager.imageToScreen(x, y);
        if (screenOffset) { screenPos.x += screenOffset.dx; screenPos.y += screenOffset.dy; }

        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = align;
        ctx.textBaseline = 'middle';

        const metrics = ctx.measureText(text);
        const paddingH = 6;
        const paddingV = 3;
        const height = 14;

        let rectX = screenPos.x;
        if (align === 'center') rectX -= metrics.width / 2 + paddingH;
        else if (align === 'right') rectX -= metrics.width + paddingH * 2;
        else rectX -= paddingH;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(
            rectX,
            screenPos.y - height / 2 - paddingV,
            metrics.width + paddingH * 2,
            height + paddingV * 2
        );
        if (accent) {
            ctx.fillStyle = accent;
            ctx.fillRect(rectX, screenPos.y - height / 2 - paddingV, 3, height + paddingV * 2);
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, screenPos.x, screenPos.y);

        ctx.restore();
    }

    getColor(): string {
        // Request: Use the blue color from "Reset" button/Zoom text
        const themeBlue = '#3b82f6';
        if (this.selected) return '#f97316'; // Orange for selection

        switch (this.type) {
            case 'line': return themeBlue;
            case 'auto': return '#10b981';
            case 'rectangle': return themeBlue;
            case 'color-segment': return '#f59e0b';
            case 'parallel': return themeBlue;
            case 'profile': return themeBlue;
            case 'area-profile': return themeBlue;
            case 'microstructure': return '#4f46e5';
            case 'om-layers': return '#a855f7';
            default: return themeBlue;
        }
    }

    getTypeName(): string {
        const typeNames: Record<string, string> = {
            'line': '선 측정',
            'rectangle': '사각형',
            'auto': '자동 감지',
            'color-segment': '색상 영역',
            'parallel': '평행선 거리',
            'profile': '조도 분석',
            'area-profile': '두께 자동분석',
            'microstructure': 'SEM 미세구조 분석',
            'om-layers': 'OM 층 자동측정'
        };
        return typeNames[this.type] || '알 수 없음';
    }

    getValue(calibrationManager: CalibrationManager): string {
        if (this.type === 'line' || this.type === 'auto' || this.type === 'parallel') {
            const length = Math.sqrt(
                Math.pow(this.data.x2 - this.data.x1, 2) +
                Math.pow(this.data.y2 - this.data.y1, 2)
            );
            const formatted = calibrationManager.formatMeasurement(length);
            return this.data.layerType ? `${this.data.layerType} ${formatted}` : formatted;
        } else if (this.type === 'profile') {
            if (this.data.roughness) {
                const r = this.data.roughness;
                return `Ra:${r.Ra.toFixed(2)} | Rq:${r.Rq.toFixed(2)} | Rt:${r.Rt.toFixed(2)}`;
            } else if (this.data.x1 !== undefined) {
                const length = Math.sqrt(
                    Math.pow(this.data.x2 - this.data.x1, 2) +
                    Math.pow(this.data.y2 - this.data.y1, 2)
                );
                return calibrationManager.formatMeasurement(length);
            }
            return '-';
        } else if (this.type === 'rectangle' || this.type === 'color-segment') {
            const w = calibrationManager.formatMeasurement(this.data.width);
            const h = calibrationManager.formatMeasurement(this.data.height);
            return `${w} × ${h}`;
        } else if (this.type === 'area-profile') {
            if (!this.data.results) return '';
            const excludeLabels = ['Background', '배경', 'Substrate', '모재'];
            let totalThickness = 0;
            const parts = Object.entries(this.data.results).map(([label, val]) => {
                if (!excludeLabels.includes(label)) totalThickness += val as number;
                return `${label}: ${(val as number).toFixed(2)}`;
            });
            // return `Total: ${totalThickness.toFixed(2)}`;
            return parts.slice(0, 3).join(', ') + (parts.length > 3 ? '...' : '');
        } else if (this.type === 'microstructure') {
            return `${this.data.grainCount || 0} grains, ${(this.data.wcFraction * 100).toFixed(1)}% WC`;
        } else if (this.type === 'om-layers') {
            const layers = this.data.layers as Record<OMLayerName, OMLayerReport> | undefined;
            if (!this.data.ok || !layers) return '검출 실패';
            const star = this.data.ambiguous ? '★ ' : '';
            return star + OM_LAYER_ORDER
                .map(L => layers[L]?.status === 'absent' ? `${L} 없음` : `${(layers[L]?.ambiguous ? '★' : '')}${L} ${(layers[L]?.value as number)?.toFixed(2) ?? '-'}`)
                .join(' | ');
        }
        return '-';
    }

    getAngle(): string | null {
        if (this.type === 'line' || this.type === 'auto' || this.type === 'parallel') {
            const { x1, y1, x2, y2 } = this.data;
            const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
            return angle.toFixed(1) + '°';
        }
        return null;
    }

    getLength(calibrationManager: CalibrationManager): string {
        if (this.type === 'line' || this.type === 'auto' || this.type === 'parallel') {
            const { x1, y1, x2, y2 } = this.data;
            const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            return calibrationManager.formatMeasurement(length);
        } else if (this.type === 'profile') {
            if (this.data.roughness) {
                const r = this.data.roughness;
                return `Ra:${r.Ra.toFixed(2)} Rq:${r.Rq.toFixed(2)} Rp:${r.Rp.toFixed(2)} Rv:${r.Rv.toFixed(2)} Rt:${r.Rt.toFixed(2)} Rz:${r.Rz.toFixed(2)}`;
            }
            return this.getValue(calibrationManager);
        } else if (this.type === 'rectangle' || this.type === 'color-segment') {
            const { width, height } = this.data;
            return `${calibrationManager.formatMeasurement(width)} × ${calibrationManager.formatMeasurement(height)}`;
        } else if (this.type === 'area-profile') {
            const count = Object.keys(this.data.results || {}).length;
            return `${count}개 층 분석됨`;
        } else if (this.type === 'om-layers') {
            return `${this.data.nSlabs || 0} slab`;
        }
        return '';
    }

    containsPoint(x: number, y: number, imageManager: ImageManager): boolean {
        const threshold = 10 / imageManager.scale;

        if (this.type === 'line' || this.type === 'auto' || this.type === 'parallel') {
            const { x1, y1, x2, y2 } = this.data;
            if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return false;
            const dist = this.pointToLineDistance(x, y, x1, y1, x2, y2);
            return dist < threshold;
        } else if (this.type === 'profile') {
            if (this.data.roi) {
                const { x: rx, y: ry, width, height } = this.data.roi;
                return x >= rx && x <= rx + width && y >= ry && y <= ry + height;
            } else if (this.data.x1 !== undefined) {
                const { x1, y1, x2, y2 } = this.data;
                const dist = this.pointToLineDistance(x, y, x1, y1, x2, y2);
                return dist < threshold;
            }
        } else if (this.type === 'om-layers') {
            const lines = this.data.lines as Record<OMLayerName, { top: { x: number; y: number }[]; bottom: { x: number; y: number }[] }> | undefined;
            if (!lines) return false;
            const pts = OM_LAYER_ORDER.flatMap(L => [...(lines[L]?.top || []), ...(lines[L]?.bottom || [])]);
            if (pts.length === 0) return false;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of pts) {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
            return x >= minX && x <= maxX && y >= minY && y <= maxY;
        } else if (this.type === 'rectangle' || this.type === 'color-segment' || this.type === 'area-profile' || this.type === 'microstructure') {
            const rectData = this.type === 'area-profile' ? this.data.roi : this.data;
            if (!rectData) return false;
            const { x: rx, y: ry, width, height } = rectData;
            return x >= rx && x <= rx + width && y >= ry && y <= ry + height;
        }

        return false;
    }

    pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = x1; yy = y1;
        } else if (param > 1) {
            xx = x2; yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;

        return Math.sqrt(dx * dx + dy * dy);
    }
}

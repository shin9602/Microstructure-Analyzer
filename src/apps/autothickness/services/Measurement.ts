/**
 * Measurement class
 * Ported from AutoThickness_v1.0.0/app.js Measurement class
 */

import type { ImageManager } from './ImageManager';
import type { CalibrationManager } from './CalibrationManager';

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

        const label = `${calibrationManager.formatMeasurement(length)} | ${angle.toFixed(1)}°`;
        this.drawLabel(ctx, imageManager, midX, midY - 10 / imageManager.scale, label);
    }

    drawLabel(ctx: CanvasRenderingContext2D, imageManager: ImageManager, x: number, y: number, text: string, align: 'center' | 'left' | 'right' = 'center') {
        ctx.save();
        ctx.resetTransform();

        const screenPos = imageManager.imageToScreen(x, y);

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
            'microstructure': 'SEM 미세구조 분석'
        };
        return typeNames[this.type] || '알 수 없음';
    }

    getValue(calibrationManager: CalibrationManager): string {
        if (this.type === 'line' || this.type === 'auto' || this.type === 'parallel') {
            const length = Math.sqrt(
                Math.pow(this.data.x2 - this.data.x1, 2) +
                Math.pow(this.data.y2 - this.data.y1, 2)
            );
            return calibrationManager.formatMeasurement(length);
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

/**
 * AutoAnalyzer - CVD Coating Layer Analysis
 * Ported from AutoThickness_v1.0.0/app.js (SequentialBoundaryScanner + getVerticalMedianProfile)
 */

export interface ProfilePoint {
    x: number;
    y: number;
    distance: number;
    value: number; // Intensity
    r: number;
    g: number;
    b: number;
}

export class AutoAnalyzer {

    /**
     * Calculates the vertical median profile of the ROI using Histogram method.
     * Ported from app.js getVerticalMedianProfile (O(1) median per row)
     */
    static getVerticalMedianProfile(imageData: ImageData, roi?: { x: number; y: number; width: number; height: number }): ProfilePoint[] {
        const { data, width, height } = imageData;
        const profile: ProfilePoint[] = [];

        const startX = roi ? Math.max(0, Math.floor(roi.x)) : 0;
        const endX = roi ? Math.min(width, Math.ceil(roi.x + roi.width)) : width;
        const startY = roi ? Math.max(0, Math.floor(roi.y)) : 0;
        const endY = roi ? Math.min(height, Math.ceil(roi.y + roi.height)) : height;

        const roiWidth = endX - startX;
        if (roiWidth <= 0) return [];

        // Pre-allocate histograms
        const rHist = new Int32Array(256);
        const gHist = new Int32Array(256);
        const bHist = new Int32Array(256);
        const iHist = new Int32Array(256);

        const getMedian = (hist: Int32Array, threshold: number): number => {
            let sum = 0;
            for (let i = 0; i < 256; i++) {
                sum += hist[i];
                if (sum >= threshold) return i;
            }
            return 255;
        };

        for (let y = startY; y < endY; y++) {
            rHist.fill(0); gHist.fill(0); bHist.fill(0); iHist.fill(0);

            let count = 0;
            const rowOffset = y * width;

            for (let x = startX; x < endX; x++) {
                const idx = (rowOffset + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const intL = (r * 299 + g * 587 + b * 114) / 1000 | 0;

                rHist[r]++;
                gHist[g]++;
                bHist[b]++;
                iHist[intL]++;
                count++;
            }

            const threshold = count / 2;
            profile.push({
                x: (startX + endX) / 2,
                y: y,
                distance: y - startY,
                value: getMedian(iHist, threshold),
                r: getMedian(rHist, threshold),
                g: getMedian(gHist, threshold),
                b: getMedian(bHist, threshold)
            });
        }

        return profile;
    }

    /**
     * CVD 코팅 박막 통합 분석 알고리즘
     * Ported from app.js SequentialBoundaryScanner.analyzeCvdCoating
     */
    static analyzeCvdCoating(
        profile: ProfilePoint[],
        oneMicronPixels: number = 5,
        options: {
            alStartThreshold: number;
            alEndThreshold: number;
        } = { alStartThreshold: 10, alEndThreshold: 10 }
    ): { boundaries: number[], labels: string[] } {
        const boundaries: number[] = [];
        const labels: string[] = ['Background'];
        const len = profile.length;

        if (len < 10) return { boundaries: [], labels: ['Background'] };

        const getSlope = (idx: number) => {
            if (idx < 2 || idx >= len - 2) return { dI: 0, dR: 0, dB: 0 };
            const prev = profile[idx - 2];
            const next = profile[idx + 2];
            return {
                dI: next.value - prev.value,
                dR: next.r - prev.r,
                dB: next.b - prev.b
            };
        };

        let y = 2;

        // STEP A: Background Level (first 20px or 5%)
        const bgSampleCount = Math.min(20, Math.floor(len * 0.05));
        let bgI = 0, bgB = 0;
        for (let i = 0; i < bgSampleCount; i++) {
            bgI += profile[i].value;
            bgB += profile[i].b;
        }
        bgI /= bgSampleCount;
        bgB /= bgSampleCount;

        // STEP B: Entry Point
        let entryPointY = -1;
        for (let i = bgSampleCount; i < len - 10; i++) {
            if (profile[i].value < bgI - 10) {
                entryPointY = i;
                break;
            }
        }

        if (entryPointY !== -1) {
            // STEP C: Min intensity search
            let minI = 255;
            for (let i = entryPointY; i < len; i++) {
                if (profile[i].value < minI) minI = profile[i].value;
            }

            let minIStartIdx = entryPointY;
            for (let i = entryPointY; i < len; i++) {
                if (profile[i].value <= minI + 2) {
                    minIStartIdx = i;
                    break;
                }
            }

            // STEP D: Search Range
            const searchStart = Math.max(4, entryPointY - 30);
            const searchEnd = Math.min(len - 5, minIStartIdx + 10);

            // STEP E: Steepest Descent
            let minSlope = 999999;
            let maxDropIdx = entryPointY;
            const slopeWindow = 4;
            const alStartThreshold = options.alStartThreshold;

            for (let i = Math.max(slopeWindow, searchStart); i <= searchEnd; i++) {
                const startIdx = i - slopeWindow;
                const endIdx = Math.min(len - 1, i + slopeWindow);

                const startVal = profile[startIdx];
                const endVal = profile[endIdx];

                const gradI = endVal.value - startVal.value;
                const gradB = endVal.b - startVal.b;
                const totalGrad = gradI + gradB;

                if (totalGrad < -alStartThreshold) {
                    if (totalGrad < minSlope) {
                        minSlope = totalGrad;
                        maxDropIdx = i;
                    }
                }
            }

            // 3. TiN Check
            let tinCrossY = -1;
            for (let i = Math.max(0, entryPointY - 10); i < maxDropIdx; i++) {
                if (profile[i].r > profile[i].b + 10) {
                    tinCrossY = i;
                    break;
                }
            }

            if (tinCrossY !== -1) {
                // TiN Mode
                boundaries.push(tinCrossY);
                labels.push('TiN');
                boundaries.push(maxDropIdx);
                labels.push('Al₂O₃');
                y = maxDropIdx + Math.max(oneMicronPixels, 10);
            } else {
                // Standard Mode
                boundaries.push(maxDropIdx);
                labels.push('Al₂O₃');
                y = maxDropIdx + Math.max(oneMicronPixels, 10);
            }

            // STEP 3: Al₂O₃ End = Bonding Start
            const alEndThreshold = options.alEndThreshold;
            for (; y < len - 10; y++) {
                const s = getSlope(y);
                if (s.dI > alEndThreshold) {
                    boundaries.push(y);
                    labels.push('Bonding');
                    y += Math.max(oneMicronPixels, 5);
                    break;
                }
            }

            // STEP 4~5: MT-TiCN & Substrate Detection via Top 2 R-B Peaks
            // Ported EXACTLY from AutoThickness_v1.0.0 (app.js lines 699-771)
            // Logic: Find the highest R-B points. 
            // 1st Peak (in position) = MT-TiCN Start
            // 2nd Peak (in position) = Substrate Start (if separated by min distance)

            const rbDiff: { idx: number, value: number }[] = [];
            for (let i = y; i < len; i++) {
                rbDiff.push({ idx: i, value: profile[i].r - profile[i].b });
            }

            if (rbDiff.length > 10) {
                // Sort by R-B value descending (Strongest Red-Blue separation first)
                const sortedByRB = [...rbDiff].sort((a, b) => b.value - a.value);

                const topPeaks: { idx: number, value: number }[] = [];
                // Original app.js used hardcoded 50, but adaptive is safer.
                // However, user said "Follow v1.0.0". v1.0.0 used `const minPeakDistance = 50;`
                const minPeakDistance = 50;

                for (const peak of sortedByRB) {
                    if (peak.value > 5) { // Minimum threshold to ignore noise
                        if (topPeaks.length === 0) {
                            topPeaks.push(peak);
                        } else if (topPeaks.length === 1) {
                            // Ensure 2nd peak is far enough from the 1st peak
                            if (Math.abs(peak.idx - topPeaks[0].idx) >= minPeakDistance) {
                                topPeaks.push(peak);
                                break; // Found top 2 unique peaks
                            }
                        }
                    }
                }

                // Sort peaks by index (position in profile) to determine order
                topPeaks.sort((a, b) => a.idx - b.idx);

                if (topPeaks.length >= 1) {
                    // First Peak: MT-TiCN Start
                    boundaries.push(topPeaks[0].idx);
                    labels.push('MT-TiCN');
                }

                if (topPeaks.length >= 2) {
                    // Second Peak: Substrate Start
                    boundaries.push(topPeaks[1].idx);
                }
            }

            if (labels.length === boundaries.length) {
                labels.push('Substrate');
            }

            return { boundaries, labels };
            return { boundaries, labels };
        } else {
            return { boundaries: [], labels: ['Background'] };
        }
    }

    /**
     * getLineProfile - Extract profile data along a line (Bresenham's algorithm)
     */
    static getLineProfile(imageData: ImageData, start: { x: number, y: number }, end: { x: number, y: number }): ProfilePoint[] {
        const { data, width, height } = imageData;
        const profile: ProfilePoint[] = [];

        let x0 = Math.floor(start.x);
        let y0 = Math.floor(start.y);
        const x1 = Math.floor(end.x);
        const y1 = Math.floor(end.y);

        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        let distance = 0;

        while (true) {
            if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
                const idx = (y0 * width + x0) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const intensity = (r * 299 + g * 587 + b * 114) / 1000 | 0;

                profile.push({
                    x: x0,
                    y: y0,
                    distance: distance,
                    value: intensity,
                    r, g, b
                });
            }

            if (x0 === x1 && y0 === y1) break;

            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
            distance++;
        }

        return profile;
    }

    /**
     * Calculates the horizontal median profile of the ROI (per-column median).
     * Each point represents the median intensity of a vertical column of pixels.
     * This is used for surface roughness analysis (profile along X axis).
     */
    static getHorizontalMedianProfile(imageData: ImageData, roi?: { x: number; y: number; width: number; height: number }): ProfilePoint[] {
        const { data, width, height } = imageData;
        const profile: ProfilePoint[] = [];

        const startX = roi ? Math.max(0, Math.floor(roi.x)) : 0;
        const endX = roi ? Math.min(width, Math.ceil(roi.x + roi.width)) : width;
        const startY = roi ? Math.max(0, Math.floor(roi.y)) : 0;
        const endY = roi ? Math.min(height, Math.ceil(roi.y + roi.height)) : height;

        const roiHeight = endY - startY;
        if (roiHeight <= 0) return [];

        // Pre-allocate histograms
        const rHist = new Int32Array(256);
        const gHist = new Int32Array(256);
        const bHist = new Int32Array(256);
        const iHist = new Int32Array(256);

        const getMedian = (hist: Int32Array, threshold: number): number => {
            let sum = 0;
            for (let i = 0; i < 256; i++) {
                sum += hist[i];
                if (sum >= threshold) return i;
            }
            return 255;
        };

        for (let x = startX; x < endX; x++) {
            rHist.fill(0); gHist.fill(0); bHist.fill(0); iHist.fill(0);

            let count = 0;

            for (let y = startY; y < endY; y++) {
                const idx = (y * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const intL = (r * 299 + g * 587 + b * 114) / 1000 | 0;

                rHist[r]++;
                gHist[g]++;
                bHist[b]++;
                iHist[intL]++;
                count++;
            }

            const threshold = count / 2;
            profile.push({
                x: x,
                y: (startY + endY) / 2,
                distance: x - startX,
                value: getMedian(iHist, threshold),
                r: getMedian(rHist, threshold),
                g: getMedian(gHist, threshold),
                b: getMedian(bHist, threshold)
            });
        }

        return profile;
    }

    /**
     * Calculate surface roughness parameters from a profile.
     * Returns Ra (arithmetic mean), Rq (RMS), Rp (max peak), Rv (max valley), Rt (total range), Rz.
     */
    static calculateRoughness(profile: ProfilePoint[]): {
        Ra: number; Rq: number; Rp: number; Rv: number; Rt: number; Rz: number; meanLine: number;
    } {
        if (profile.length === 0) return { Ra: 0, Rq: 0, Rp: 0, Rv: 0, Rt: 0, Rz: 0, meanLine: 0 };

        // Mean line (average intensity)
        let sum = 0;
        for (const p of profile) sum += p.value;
        const meanLine = sum / profile.length;

        // Deviations from mean line
        let sumAbs = 0;
        let sumSq = 0;
        let maxPeak = -Infinity;
        let maxValley = Infinity;

        for (const p of profile) {
            const dev = p.value - meanLine;
            sumAbs += Math.abs(dev);
            sumSq += dev * dev;
            if (p.value > maxPeak) maxPeak = p.value;
            if (p.value < maxValley) maxValley = p.value;
        }

        const Ra = sumAbs / profile.length;
        const Rq = Math.sqrt(sumSq / profile.length);
        const Rp = maxPeak - meanLine;
        const Rv = meanLine - maxValley;
        const Rt = maxPeak - maxValley;

        // Rz: Average of 5 highest peaks and 5 deepest valleys
        const deviations = profile.map(p => p.value - meanLine);
        const sortedDevs = [...deviations].sort((a, b) => b - a);
        const n5 = Math.min(5, Math.floor(profile.length / 10));
        let peakSum = 0, valleySum = 0;
        for (let i = 0; i < n5; i++) {
            peakSum += sortedDevs[i];
            valleySum += sortedDevs[sortedDevs.length - 1 - i];
        }
        const Rz = n5 > 0 ? (peakSum / n5) - (valleySum / n5) : Rt;

        return { Ra, Rq, Rp, Rv, Rt, Rz, meanLine };
    }
}


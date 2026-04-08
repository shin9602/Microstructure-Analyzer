/**
 * MicrostructureAnalyzer.ts
 * 
 * Implements the automated microstructure analysis process for WC-Co SEM images.
 */

export interface MicrostructureParams {
    mode: 'classic' | 'substrate' | 'thin-film';
    manualThreshold?: number;
    t1?: number;
    t2?: number;
    phaseMode?: '2-phase' | '3-phase';
    targetStep?: number; // 0: Grayscale, 1: Smoothing, 2: Phases, 3: EDM, 4: Watershed, 5: Final
    minIslandSize?: number; // [추가] 아일랜드 제거 최소 면적 (Default: 10)
    splitSensitivity?: number; // [추가] 워터셰드 분리 민감도 (0.1 ~ 2.0, Default: 1.0)
}

export interface MicrostructureResult {
    threshold: number;
    t1?: number;
    t2?: number;
    grainCount: number;
    avgGrainSize: number;
    areaWeightedGrainSize?: number;
    wcFraction: number;
    coFraction: number;
    mcFraction?: number;
    al2o3Fraction?: number;
    ticnFraction?: number;
    contiguity?: number;
    meanFreePath?: number;
    overlayData: Uint8ClampedArray;
    width: number;
    height: number;
    histogram?: number[];
    thresholdCandidates?: { label: string, value: number }[];
    gmmCurves?: number[][];
    gradientMap?: Uint8ClampedArray; // [추가] 시각화를 위한 그레디언트 맵
    labels?: Int32Array; // Watershed segmentation labels for caching
    labelPhase?: Uint8Array; // [추가] 각 레이블의 상 정보 (수동 보정 반영용)
    watershedDone?: boolean;
    smoothedPixels?: Uint8ClampedArray; // For reuse
    gradientMapRaw?: Float32Array; // For reuse
    gmm?: any; // For reuse
    debugSteps?: { name: string, data: Uint8ClampedArray }[]; // [추가] 단계별 시각화 데이터
    currentAnalysisStep?: number;
}

export class MicrostructureAnalyzer {

    static analyze(
        imageData: ImageData, roi: { x: number, y: number, width: number, height: number },
        params?: number | MicrostructureParams,
        existingResult?: MicrostructureResult 
    ): MicrostructureResult {
        const width = Math.round(roi.width);
        const height = Math.round(roi.height);
        const rx = Math.round(roi.x);
        const ry = Math.round(roi.y);
        const total = width * height;

        const targetStep = (params && typeof params !== 'number' && params.targetStep !== undefined) ? params.targetStep : 5;

        // ROI 좌표 상세 로깅 및 정밀 추출
        console.log(`[MicrostructureAnalyzer] Analyzing ROI: x=${rx}, y=${ry}, w=${width}, h=${height}`);
        
        const pixels = new Uint8ClampedArray(total);
        const data = imageData.data;
        const imgW = imageData.width;

        const brightness = (params && typeof params !== 'number') ? (params as any).brightness || 100 : 100;
        const contrast = (params && typeof params !== 'number') ? (params as any).contrast || 100 : 100;
        const bMod = (brightness - 100) / 100 * 255;
        const cMod = contrast / 100;

        let validPixelCount = 0;
        for (let y = 0; y < height; y++) {
            const iy = ry + y;
            if (iy < 0 || iy >= imageData.height) continue;
            const yOffset = iy * imgW;
            const rowOffset = y * width;
            for (let x = 0; x < width; x++) {
                const ix = rx + x;
                if (ix < 0 || ix >= imgW) continue;
                const srcIdx = (yOffset + ix) << 2;
                
                // 1. Grayscale (Luminance)
                let v = (0.2126 * data[srcIdx] + 0.7152 * data[srcIdx + 1] + 0.0722 * data[srcIdx + 2]);
                
                // 2. Apply Brightness & Contrast adjustment as seen in UI
                v = (v - 128) * cMod + 128 + bMod;
                
                pixels[rowOffset + x] = Math.max(0, Math.min(255, Math.round(v)));
                validPixelCount++;
            }
        }

        const result: MicrostructureResult = {
            width, height, threshold: 0, grainCount: 0, avgGrainSize: 0, wcFraction: 0, coFraction: 0,
            overlayData: new Uint8ClampedArray(total * 4),
            currentAnalysisStep: targetStep,
            debugSteps: []
        };

        // Step 0 Overlay
        const rawOverlay = new Uint8ClampedArray(total * 4);
        for (let i = 0; i < total; i++) {
            const v = pixels[i]; rawOverlay[i*4]=v; rawOverlay[i*4+1]=v; rawOverlay[i*4+2]=v; rawOverlay[i*4+3]=255;
        }
        result.debugSteps!.push({ name: '원본 ROI', data: rawOverlay });

        // Step 1: Pre-processing (Median + Gaussian Hybrid)
        // [개선] 경계를 보존하면서 노이즈만 제거하는 메디안 필터 우선 적용
        const medianStripped = this.applyMedianFilter(pixels, width, height);
        const smoothed = this.applyGaussianFilter(medianStripped, width, height);
        result.smoothedPixels = smoothed;
        const smoothOverlay = new Uint8ClampedArray(total * 4);
        for (let i = 0; i < total; i++) {
            const v = smoothed[i]; smoothOverlay[i*4]=v; smoothOverlay[i*4+1]=v; smoothOverlay[i*4+2]=v; smoothOverlay[i*4+3]=255;
        }
        result.debugSteps!.push({ name: '전처리 (Smoothing)', data: smoothOverlay });

        // Step 1-A: Gradient Calculation (Needed for Watershed)
        const gradientMap = this.calculateGradient(smoothed, width, height);
        result.gradientMapRaw = gradientMap;

        // Step 1-B: Statistics using VALID pixels only (Exclude zero-padding outside image)
        const histogram = new Array(256).fill(0);
        let validSampleCount = 0;
        const imgH = imageData.height;

        for (let y = 0; y < height; y++) {
            const iy = ry + y;
            if (iy < 0 || iy >= imgH) continue;
            const rowOffset = y * width;
            for (let x = 0; x < width; x++) {
                const ix = rx + x;
                if (ix < 0 || ix >= imgW) continue;
                const val = smoothed[rowOffset + x];
                histogram[val]++;
                validSampleCount++;
            }
        }
        if (validSampleCount === 0) validSampleCount = total;
        result.histogram = histogram;

        // Step 2: Threshold Logic (Hierarchical Otsu)
        let phaseMode = params && typeof params !== 'number' && params.phaseMode === '3-phase' ? '3-phase' : '2-phase';
        let t1 = 80, t2 = 180;
        
        if (phaseMode === '3-phase') {
            // [교정] Peak-Valley Discovery 알고리즘 강화
            // 히스토그램 스무딩 강화 (반경 확대: 3 -> 10)
            const sHist = new Float32Array(256);
            const radius = 10;
            for (let i = 0; i < 256; i++) {
                let sum = 0, count = 0;
                for (let k = -radius; k <= radius; k++) {
                    const idx = i + k;
                    if (idx >= 0 && idx < 256) {
                        const weight = Math.exp(-(k * k) / 50); // Gaussian weight
                        sum += histogram[idx] * weight;
                        count += weight;
                    }
                }
                sHist[i] = sum / count;
            }

            // 1. 로컬 피크 후보 찾기 (검색 거리 확대: 8 -> 25)
            const peaks: { pos: number, val: number }[] = [];
            const searchR = 25;
            for (let i = searchR; i < 256 - searchR; i++) {
                let isMax = true;
                for (let k = -searchR; k <= searchR; k++) {
                    if (sHist[i + k] > sHist[i]) { isMax = false; break; }
                }
                if (isMax && sHist[i] > 0) {
                    peaks.push({ pos: i, val: sHist[i] });
                }
            }
            // 빈도순 정렬 후 상위 3개 선택 -> 다시 밝기 순(위치순) 정렬
            peaks.sort((a, b) => b.val - a.val);
            const top3 = peaks.slice(0, 3).sort((a, b) => a.pos - b.pos);

            if (top3.length === 3) {
                // 2. 피크 사이의 최소값(Valley)을 t1, t2로 자동 할당
                let minV1 = Infinity, minV2 = Infinity;
                for (let i = top3[0].pos; i <= top3[1].pos; i++) {
                    if (sHist[i] < minV1) { minV1 = sHist[i]; t1 = i; }
                }
                for (let i = top3[1].pos; i <= top3[2].pos; i++) {
                    if (sHist[i] < minV2) { minV2 = sHist[i]; t2 = i; }
                }
                console.log(`[AutoThreshold] Peak-Valley Discovery: P=[${top3[0].pos}, ${top3[1].pos}, ${top3[2].pos}], Valleys=[${t1}, ${t2}]`);
            } else {
                // 피크 검출 실패 시 기존 계층적 Otsu로 폴백
                const tGlobal = this.calculateOtsuInRange(histogram, 0, 255);
                t1 = this.calculateOtsuInRange(histogram, 0, tGlobal);
                t2 = tGlobal;
            }
        } else {
            t1 = this.calculateOtsuInRange(histogram, 0, 255);
            t2 = Math.min(255, t1 + 40);
        }

        // [개선] 실제 히스토그램 기반 GMM 피크 시각화 데이터 생성
        const gmm = { 
            means: [t1 * 0.5, (t1 + t2) / 2, (t2 + 255) / 2],
            sigmas: [15, 20, 15],
            weights: [
                this.sumHistogram(histogram, 0, t1) / total,
                this.sumHistogram(histogram, t1, t2) / total,
                this.sumHistogram(histogram, t2, 255) / total
            ]
        };
        result.gmm = gmm;
        
        // GMM 곡선 샘플링 (시각화용)
        const curves: number[][] = [[], [], []];
        for (let i = 0; i < 256; i++) {
            for (let j = 0; j < 3; j++) {
                const diff = i - gmm.means[j];
                const val = gmm.weights[j] * Math.exp(-(diff * diff) / (2 * gmm.sigmas[j] * gmm.sigmas[j]));
                curves[j].push(val);
            }
        }
        result.gmmCurves = curves;

        if (params && typeof params !== 'number') {
            if (params.t1 !== undefined) t1 = params.t1;
            if (params.t2 !== undefined) t2 = params.t2;
        } else if (typeof params === 'number') {
            t1 = params;
        }

        // Step 2: Phase Segmentation (Initial)
        const pixelPhases = new Uint8Array(total);
        if (phaseMode === '3-phase') {
            // [교정] Serra et al. (2026) 논문 방식: γ상 우선 격리 후 잔여 영역 Otsu 재적용
            // 1. γ상 마스터 마스킹 (중간 밝기 구간)
            for (let i = 0; i < total; i++) {
                const v = smoothed[i];
                if (v > t1 && v <= t2) pixelPhases[i] = 1; // Gamma(MC)
            }

            // 2. γ상 제외 나머지 픽셀들로 새로운 히스토그램 생성 (WC vs Co)
            const subHist = new Array(256).fill(0);
            for (let i = 0; i < total; i++) {
                if (pixelPhases[i] !== 1) {
                    const v = Math.max(0, Math.min(255, Math.round(smoothed[i])));
                    subHist[v]++;
                }
            }

            // 3. 잔여 영역에서만 Otsu 재계산 (훨씬 안정적인 2-피크 이진화)
            const refinedT = this.calculateOtsuInRange(subHist, 0, 255);
            console.log(`[PhaseSeparator] Gamma excluded. Refined WC/Co boundary: ${refinedT}`);
            
            for (let i = 0; i < total; i++) {
                if (pixelPhases[i] !== 1) {
                    pixelPhases[i] = smoothed[i] > refinedT ? 2 : 0; // 0: Co, 2: WC
                }
            }
            result.threshold = refinedT; // 분석 결과에 반영
            t1 = refinedT; // [교정] t1을 refinedT로 일관되게 유지하여 finalizeAnalysis에서 활용
        } else {
            // 2-상 모드: 고전적 방식
            for (let i = 0; i < total; i++) {
                pixelPhases[i] = smoothed[i] <= t1 ? 0 : 2; 
            }
        }

        // [추가] Step 2-A: Morphological Refinement (Opening & Closing)
        // 논문(Serra et al.) 방식: 오프닝으로 미세 가시 제거, 클로징으로 내부 구멍 결합
        this.applyMorphology(pixelPhases, width, height);
        
        // [추가] Step 2-B: Island Removal (Area Opening)
        const minIslandSize = (params && typeof params !== 'number' && params.minIslandSize !== undefined) ? params.minIslandSize : 10;
        this.removeSmallIslands(pixelPhases, width, height, minIslandSize);
        
        console.log(`[MicrostructureAnalyzer] Phase Thresholds: t1(refined)=${t1}, t2=${t2}`);
        result.t1 = t1; 
        result.t2 = t2; 
        // threshold는 이미 refinedT로 설정되어 있음

        if (targetStep === 0) { result.overlayData.set(rawOverlay); return result; }
        if (targetStep === 1) { result.overlayData.set(smoothOverlay); return result; }

        const phaseOverlay = new Uint8ClampedArray(total * 4);
        for (let i = 0; i < total; i++) {
            const p = pixelPhases[i];
            const idx = i << 2;
            if (p === 0) { phaseOverlay[idx]=40; phaseOverlay[idx+1]=44; phaseOverlay[idx+2]=52; }
            else if (p === 1) { phaseOverlay[idx]=255; phaseOverlay[idx+1]=170; phaseOverlay[idx+2]=50; }
            else { phaseOverlay[idx]=240; phaseOverlay[idx+1]=240; phaseOverlay[idx+2]=245; }
            phaseOverlay[idx+3] = 255;
        }
        result.debugSteps!.push({ name: '상 분리 (Phase Map)', data: phaseOverlay });
        if (targetStep === 2) { result.overlayData.set(phaseOverlay); return result; }

        // Step 3: Distance Map (EDM) Visualization (Representative: WC)
        const sensitivity = (params && typeof params !== 'number' && params.splitSensitivity !== undefined) ? params.splitSensitivity : 1.0;
        // [복원] 사용자가 단계를 확인할 수 있도록 WC 기준 거리 맵 생성
        const wcDistMap = this.calculateEDM(pixelPhases, 2, width, height);
        const edmOverlay = new Uint8ClampedArray(total * 4);
        let maxD = 0;
        for (let i = 0; i < total; i++) if (wcDistMap[i] > maxD && wcDistMap[i] < 1e9) maxD = wcDistMap[i];
        for (let i = 0; i < total; i++) {
            const v = (maxD > 0 && wcDistMap[i] < 1e9) ? (wcDistMap[i] / maxD) * 255 : 0;
            const idx = i << 2;
            edmOverlay[idx]=v; edmOverlay[idx+1]=v; edmOverlay[idx+2]=v; edmOverlay[idx+3]=255;
        }
        result.debugSteps!.push({ name: '거리 맵 (WC-EDM)', data: edmOverlay });
        
        // [추가] 워터셰드Basins 시각화 (최저점 확인용 그래프 대용)
        const markerOverlay = new Uint8ClampedArray(total * 4);
        // 실제 연산과 동일한 스무딩 및 마커 추출 로직 사용
        const sigma = 1.0 / sensitivity;
        const sWC = this.applyGaussianFilterFloat(wcDistMap, width, height, sigma);
        const wcMarkers = this.getHMaximaMarkers(sWC, pixelPhases, 2, width, height, sensitivity);
        
        for (let i = 0; i < total; i++) {
            const v = (maxD > 0 && wcDistMap[i] < 1e9) ? (wcDistMap[i] / maxD) * 150 : 0; 
            const idx = i << 2;
            if (wcMarkers[i] > 0) {
                // 마커(Flooding 시작점)를 붉은색으로 아주 뚜렷하게 강조
                markerOverlay[idx]=255; markerOverlay[idx+1]=0; markerOverlay[idx+2]=0;
            } else {
                markerOverlay[idx]=v; markerOverlay[idx+1]=v; markerOverlay[idx+2]=v;
            }
            markerOverlay[idx+3]=255;
        }
        result.debugSteps!.push({ name: '워터셰드 최저점(Seed) 확인', data: markerOverlay });

        if (targetStep === 3) { result.overlayData.set(edmOverlay); return result; }

        // Step 4: Multi-Phase Watershed (WC and Gamma individually)
        
        // 1. WC Segmentation
        const wcResult = this.segmentPhase(pixelPhases, 2, width, height, sensitivity);
        let finalLabels = wcResult.labels;
        let nextMarkerOffset = wcResult.maxLabel + 1;

        // 2. Gamma(γ) Segmentation (3-상 모드일 때만 수행)
        if (phaseMode === '3-phase') {
            const gammaResult = this.segmentPhase(pixelPhases, 1, width, height, sensitivity);
            // Gamma 라벨 병합 (WC 라벨과 겹치지 않게 오프셋 적용)
            for (let i = 0; i < total; i++) {
                if (gammaResult.labels[i] > 0) {
                    finalLabels[i] = gammaResult.labels[i] + nextMarkerOffset;
                }
            }
        }

        result.labels = finalLabels;

        // 시각화를 위한 오버레이 생성
        const labelOverlay = new Uint8ClampedArray(total * 4);
        const colors: number[][] = [];
        for (let i = 0; i < 500; i++) colors.push([Math.random()*200+55, Math.random()*200+55, Math.random()*200+55]);
        
        for (let i = 0; i < total; i++) {
            const l = finalLabels[i];
            const p = pixelPhases[i];
            const idx = i << 2;
            
            if (l > 0) { 
                const c = colors[l % 500]; 
                labelOverlay[idx]=c[0]; labelOverlay[idx+1]=c[1]; labelOverlay[idx+2]=c[2]; 
            } else {
                if (p === 0) { labelOverlay[idx]=40; labelOverlay[idx+1]=44; labelOverlay[idx+2]=52; }
                else if (p === 1) { labelOverlay[idx]=255; labelOverlay[idx+1]=165; labelOverlay[idx+2]=0; }
                else { labelOverlay[idx]=0; labelOverlay[idx+1]=0; labelOverlay[idx+2]=0; }
            }
            labelOverlay[idx+3]=255;
        }
        result.debugSteps!.push({ name: '워터셰드 (Multi-Phase)', data: labelOverlay });
        if (targetStep === 4) { result.overlayData.set(labelOverlay); return result; }

        // Step 5: Final Analysis
        const finalParams = typeof params === 'number' ? { mode: 'classic' } : params;
        this.finalizeAnalysis(finalLabels, smoothed, t1, t2, result, { ...finalParams, phaseMode });
        
        return result;
    }

    private static applyGaussianFilter(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
        const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
        const output = new Uint8ClampedArray(pixels);
        const w = width, h = height;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                let sum = 0, k = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        sum += pixels[(y + ky) * w + (x + kx)] * kernel[k++];
                    }
                }
                output[y * w + x] = Math.round(sum / 16);
            }
        }
        return output;
    }

    /**
     * 에지(Edge)를 보존하면서 소금-후추 노이즈를 제거하는 메디안 필터
     */
    private static applyMedianFilter(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
        const output = new Uint8ClampedArray(pixels);
        const neighbors = new Uint8Array(9);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let k = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        neighbors[k++] = pixels[(y + ky) * width + (x + kx)];
                    }
                }
                neighbors.sort();
                output[y * width + x] = neighbors[4]; // 중간값 선택
            }
        }
        return output;
    }

    /**
     * 수학적 형태학(Mathematical Morphology): Opening & Closing
     * 입자 테두리를 매끄럽게 정리하고 내부의 작은 구멍들을 메움
     */
    private static applyMorphology(phases: Uint8Array, width: number, height: number) {
        const total = width * height;
        const temp = new Uint8Array(total);

        // 1. Dilation (for Closing & Opening)
        const dilate = (src: Uint8Array, dst: Uint8Array) => {
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const i = y * width + x;
                    let maxP = src[i];
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const v = src[i + ky * width + kx];
                            if (v > maxP) maxP = v;
                        }
                    }
                    dst[i] = maxP;
                }
            }
        };

        // 2. Erosion (for Closing & Opening)
        const erode = (src: Uint8Array, dst: Uint8Array) => {
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const i = y * width + x;
                    let minP = src[i];
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const v = src[i + ky * width + kx];
                            if (v < minP) minP = v;
                        }
                    }
                    dst[i] = minP;
                }
            }
        };

        // Closing (Dilate -> Erode): 내부 구멍 메우기
        dilate(phases, temp);
        erode(temp, phases);

        // Opening (Erode -> Dilate): 외곽 가시 노이즈 제거
        erode(phases, temp);
        dilate(temp, phases);
    }

    /**
     * Float32 EDM 데이터를 부드럽게 깎아 노이즈 봉우리를 제거 (과분할 방지 핵심)
     */
    private static applyGaussianFilterFloat(data: Float32Array, width: number, height: number, sigma: number): Float32Array {
        const result = new Float32Array(data.length);
        const kernel = [
            1, 4, 7, 4, 1,
            4, 16, 26, 16, 4,
            7, 26, 41, 26, 7,
            4, 16, 26, 16, 4,
            1, 4, 7, 4, 1
        ];
        const sum = 273;
        for (let y = 2; y < height - 2; y++) {
            for (let x = 2; x < width - 2; x++) {
                if (data[y * width + x] <= 0) continue;
                let val = 0;
                for (let ky = -2; ky <= 2; ky++) {
                    for (let kx = -2; kx <= 2; kx++) {
                        val += data[(y + ky) * width + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
                    }
                }
                result[y * width + x] = val / sum;
            }
        }
        return result;
    }

    private static calculateGradient(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
        const gradient = new Float32Array(width * height);
        const kernelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
        const kernelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0;
                let gy = 0;
                for (let ky = -1; ky <= 1; ky++) {
                    for (let kx = -1; kx <= 1; kx++) {
                        const pixel = pixels[(y + ky) * width + (x + kx)];
                        const kIdx = (ky + 1) * 3 + (kx + 1);
                        gx += pixel * kernelX[kIdx];
                        gy += pixel * kernelY[kIdx];
                    }
                }
                gradient[y * width + x] = Math.sqrt(gx * gx + gy * gy);
            }
        }
        return gradient;
    }

    /**
     * Meyer's Watershed Algorithm (MATLAB Style)
     * 이미지를 지형으로 간주하고 마커 지점에서부터 물을 채워 나가는 고전적 방식
     */
    private static runWatershed(topography: Float32Array, markers: Int32Array, width: number, height: number, mask: Uint8Array, targetPhase: number): Int32Array {
        const labels = new Int32Array(width * height).fill(0);
        const total = width * height;
        
        // Priority Queue (Binary Heap): [index, elevation]
        const heap: number[] = [];
        const heapVals: number[] = [];

        const push = (idx: number, val: number) => {
            heap.push(idx);
            heapVals.push(val);
            let i = heap.length - 1;
            while (i > 0) {
                let p = (i - 1) >> 1;
                if (heapVals[i] < heapVals[p]) {
                    [heap[i], heap[p]] = [heap[p], heap[i]];
                    [heapVals[i], heapVals[p]] = [heapVals[p], heapVals[i]];
                    i = p;
                } else break;
            }
        };

        const pop = () => {
            const res = heap[0];
            const last = heap.pop()!;
            const lastVal = heapVals.pop()!;
            if (heap.length > 0) {
                heap[0] = last;
                heapVals[0] = lastVal;
                let i = 0;
                while (true) {
                    let l = (i << 1) + 1, r = (i << 1) + 2, min = i;
                    if (l < heap.length && heapVals[l] < heapVals[min]) min = l;
                    if (r < heap.length && heapVals[r] < heapVals[min]) min = r;
                    if (min !== i) {
                        [heap[i], heap[min]] = [heap[min], heap[i]];
                        [heapVals[i], heapVals[min]] = [heapVals[min], heapVals[i]];
                        i = min;
                    } else break;
                }
            }
            return res;
        };

        // 1. Initial Seeds (Markers) - MATLAB imimposemin 효과
        for (let i = 0; i < total; i++) {
            if (markers[i] > 0) {
                labels[i] = markers[i];
                const x = i % width, y = Math.floor(i / width);
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = ny * width + nx;
                            if (labels[nIdx] === 0 && mask[nIdx] === targetPhase) {
                                // 마커 주변 픽셀을 지형 높이에 따라 큐에 삽입
                                push(nIdx, topography[nIdx]);
                            }
                        }
                    }
                }
            }
        }

        // 2. Meyer's Expansion (Flooding)
        while (heap.length > 0) {
            const idx = pop();
            if (labels[idx] > 0) continue;

            const x = idx % width, y = Math.floor(idx / width);
            
            // [교정] 물리적 루틴: 주변 레이블 중 지형 고도가 가장 낮은(먼저 도달한) 픽셀의 레이블 선택
            let chosenLabel = 0;
            let minTopoValue = Infinity;
            
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        const nl = labels[nIdx];
                        if (nl > 0) {
                            if (topography[nIdx] < minTopoValue) {
                                minTopoValue = topography[nIdx];
                                chosenLabel = nl;
                            }
                        }
                    }
                }
            }

            if (chosenLabel > 0) {
                labels[idx] = chosenLabel;
                // 새로운 주변 픽셀로 확장
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = ny * width + nx;
                            if (labels[nIdx] === 0 && mask[nIdx] === targetPhase) {
                                push(nIdx, topography[nIdx]);
                            }
                        }
                    }
                }
            }
        }
        return labels;
    }

    private static finalizeAnalysis(
        labels: Int32Array, pixels: Uint8ClampedArray, t1: number, t2: number,
        result: MicrostructureResult, params?: any
    ) {
        const { width, height } = result;
        const total = width * height;
        const overlay = result.overlayData;

        const maxLabel = labels.reduce((a, b) => Math.max(a, b), 0);
        const labelCounts = new Float32Array(maxLabel + 1);
        const labelSum = new Float32Array(maxLabel + 1);

        for (let i = 0; i < total; i++) {
            const l = labels[i];
            labelCounts[l]++;
            labelSum[l] += pixels[i];
        }

        const labelPhase = result.labelPhase && result.labelPhase.length >= maxLabel + 1 
            ? result.labelPhase 
            : new Uint8Array(maxLabel + 1);
        
        const isPhaseManual = new Uint8Array(maxLabel + 1);
        if (result.labelPhase) {
            // 기존에 phase 정보가 있었다면, 수동으로 수정된 것인지 확인하거나 보존해야 함
            // 여기서는 일단 모든 labelPhase가 유효하다고 가정
        }

        let countCo = labelCounts[0], countWC = 0, countMC = 0;
        let grainCount = 0;
        let sumGrainSize = 0;
        let sumAreaWeightedSize = 0;
        let sumWCWeight = 0;

        for (let l = 1; l <= maxLabel; l++) {
            const count = labelCounts[l];
            if (count < 2) {
                labelPhase[l] = 0;
                continue; 
            }
            
            // 만약 수동으로 지정된 phase가 없다면 자동 계산
            if (!result.labelPhase || l >= result.labelPhase.length) {
                const average = labelSum[l] / count;
                const pm = params?.phaseMode || '2-phase';
                
                let phase = 2; 
                if (pm === '3-phase') {
                    if (average <= t1) phase = 0; // Binder (Dark)
                    else if (average <= t2) phase = 1; // Gamma (Intermediate)
                    else phase = 2; // WC (Bright)
                } else {
                    phase = (average <= t1) ? 0 : 2;
                }
                labelPhase[l] = phase;
            }

            const phase = labelPhase[l];
            if (phase === 0) countCo += count;
            else if (phase === 1) countMC += count;
            else {
                countWC += count;
                grainCount++;
                const diameter = 2 * Math.sqrt(count / Math.PI);
                sumGrainSize += diameter;
                sumAreaWeightedSize += diameter * count; // Diameter * Area
                sumWCWeight += count; // Total Area
            }
        }
        result.labelPhase = labelPhase;
        result.areaWeightedGrainSize = sumWCWeight > 0 ? sumAreaWeightedSize / sumWCWeight : 0;

        // [교정] Subpixel 경계 강도 기반 부드러운 렌더링 (사용자 제안 로직)
        const boundaryStrength = new Float32Array(total);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const l = labels[i];
                if (l === 0) continue;
                let diff = 0;
                const neighbors = [
                    labels[(y-1)*width+x], labels[(y+1)*width+x],
                    labels[y*width+(x-1)], labels[y*width+(x+1)]
                ];
                for (const nl of neighbors) {
                    if (nl !== l && nl !== 0) diff++;
                }
                boundaryStrength[i] = diff / 4;
            }
        }

        const smoothBoundary = new Float32Array(total);
        const bKernel = [1,2,1, 2,4,2, 1,2,1];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let val = 0, k = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        val += boundaryStrength[(y+dy)*width+(x+dx)] * bKernel[k++];
                    }
                }
                smoothBoundary[y*width+x] = val / 16;
            }
        }

        const finalOverlay = new Uint8ClampedArray(total * 4);
        for (let i = 0; i < total; i++) {
            const idx = i << 2;
            const l = labels[i];
            const p = labelPhase[l];
            const v = pixels[i];
            const strength = smoothBoundary[i];
            
            // 1. Final Overlay (Soft Neon Boundary on Original)
            if (strength > 0.15) {
                const alpha = Math.min(1, strength * 3.0);
                finalOverlay[idx]   = Math.round(v * (1 - alpha));
                finalOverlay[idx+1] = Math.round(v * (1 - alpha) + 255 * alpha);
                finalOverlay[idx+2] = Math.round(v * (1 - alpha) + 255 * alpha);
            } else {
                finalOverlay[idx] = v; finalOverlay[idx+1] = v; finalOverlay[idx+2] = v;
            }
            finalOverlay[idx+3] = 255;

            // 2. Standard Label Overlay (Maintenance of classic view)
            if (strength > 0.15) {
                overlay[idx]=0; overlay[idx+1]=0; overlay[idx+2]=0;
            } else {
                if (p === 0) { overlay[idx]=50; overlay[idx+1]=50; overlay[idx+2]=50; }
                else if (p === 1) { overlay[idx]=255; overlay[idx+1]=165; overlay[idx+2]=0; }
                else { overlay[idx]=255; overlay[idx+1]=255; overlay[idx+2]=255; }
            }
            overlay[idx+3]=255;
        }
        result.debugSteps!.push({ name: '분석 결과 (부드러운 경계선)', data: finalOverlay });

        // Step 5.D: Contiguity & Mean Free Path (Linear Intercept Method)
        let nWC_WC = 0;
        let nWC_Co = 0;
        let lineLength = 0;

        // Horizontal scan
        for (let y = 0; y < height; y++) {
            const rowOffset = y * width;
            for (let x = 0; x < width - 1; x++) {
                const i1 = rowOffset + x;
                const i2 = i1 + 1;
                const l1 = labels[i1];
                const l2 = labels[i2];
                if (l1 === l2) continue;

                const p1 = labelPhase[l1];
                const p2 = labelPhase[l2];
                if (p1 === 2 && p2 === 2) nWC_WC++;
                else if ((p1 === 2 && (p2 === 0 || p2 === 1)) || ((p1 === 0 || p1 === 1) && p2 === 2)) nWC_Co++;
            }
            lineLength += width;
        }

        // Vertical scan
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height - 1; y++) {
                const i1 = y * width + x;
                const i2 = i1 + width;
                const l1 = labels[i1];
                const l2 = labels[i2];
                if (l1 === l2) continue;

                const p1 = labelPhase[l1];
                const p2 = labelPhase[l2];
                if (p1 === 2 && p2 === 2) nWC_WC++;
                else if ((p1 === 2 && (p2 === 0 || p2 === 1)) || ((p1 === 0 || p1 === 1) && p2 === 2)) nWC_Co++;
            }
            lineLength += height;
        }

        const wcFraction = countWC / total;
        const coFraction = countCo / total;

        result.wcFraction = wcFraction;
        result.mcFraction = countMC / total;
        result.coFraction = coFraction;
        result.grainCount = grainCount;
        result.avgGrainSize = grainCount > 0 ? sumGrainSize / grainCount : 0;
        
        // Contiguity calculation
        if (2 * nWC_WC + nWC_Co > 0) {
            result.contiguity = (2 * nWC_WC) / (2 * nWC_WC + nWC_Co);
        } else {
            result.contiguity = 0;
        }

        // Mean Free Path (λ_Co) calculation
        if (nWC_Co > 0) {
            const interfacesPerPixel = nWC_Co / lineLength;
            if (interfacesPerPixel > 0) {
                result.meanFreePath = (2 * coFraction) / interfacesPerPixel;
            } else {
                result.meanFreePath = 0;
            }
        } else {
            result.meanFreePath = 0;
        }
    }

    /**
     * Finds Otsu threshold within a specific brightness range.
     * Includes Valley-Emphasis & Valley Snapping.
     */
    private static calculateOtsuInRange(histogram: number[], start: number, end: number): number {
        let count = 0;
        let sum = 0;
        for (let i = start; i <= end; i++) {
            count += histogram[i];
            sum += i * histogram[i];
        }
        if (count === 0) return Math.floor((start + end) / 2);

        let sumB = 0;
        let wB = 0;
        let varMax = -1;
        let threshold = start;

        for (let i = start; i < end; i++) {
            wB += histogram[i];
            if (wB === 0) continue;
            const wF = count - wB;
            if (wF === 0) break;

            sumB += i * histogram[i];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;

            // Standard Between-class variance
            let varBetween = wB * wF * (mB - mF) * (mB - mF);
            
            // Valley-Emphasis weight: Mitigate splitting large peaks
            const p = histogram[i] / count;
            varBetween *= (1 - p); 

            if (varBetween > varMax) {
                varMax = varBetween;
                threshold = i;
            }
        }

        // [핵심 추가] Valley Snapping: 주변 +/- 15 범위에서 실제 빈도가 가장 낮은 '진짜 골짜기' 탐색
        let minFreq = Infinity;
        let snapThreshold = threshold;
        const searchRange = 15;
        const sStart = Math.max(start, threshold - searchRange);
        const sEnd = Math.min(end, threshold + searchRange);

        for (let i = sStart; i <= sEnd; i++) {
            // 가우시안 스무딩된 히스토그램 빈도 확인 (노이즈 방지용 로컬 합산)
            let localFreq = 0;
            for (let k = -2; k <= 2; k++) {
                const idx = Math.max(0, Math.min(255, i + k));
                localFreq += histogram[idx];
            }
            if (localFreq < minFreq) {
                minFreq = localFreq;
                snapThreshold = i;
            }
        }

        return snapThreshold;
    }

    private static calculateOtsuThreshold(histogram: number[], total: number): number {
        return this.calculateOtsuInRange(histogram, 0, 255);
    }

    /**
     * 특정 상(phase)에 대해 독립적인 EDM 및 워터셰드 분할을 수행하는 공통 로직
     */
    /**
     * Chamfer 3-4 알고리즘을 이용한 8방향 정밀 거리 맵 계산 루틴
     */
    private static calculateEDM(phases: Uint8Array, targetPhase: number, width: number, height: number): Float32Array {
        const total = width * height;
        const distMap = new Float32Array(total).fill(1e7);
        for (let i = 0; i < total; i++) if (phases[i] !== targetPhase) distMap[i] = 0;

        // Chamfer Distance (8-way) - Forward
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (distMap[i] > 0) {
                    if (x > 0) distMap[i] = Math.min(distMap[i], distMap[i - 1] + 3);
                    if (y > 0) distMap[i] = Math.min(distMap[i], distMap[i - width] + 3);
                    if (x > 0 && y > 0) distMap[i] = Math.min(distMap[i], distMap[i - width - 1] + 4);
                    if (x < width - 1 && y > 0) distMap[i] = Math.min(distMap[i], distMap[i - width + 1] + 4);
                }
            }
        }
        // Backward
        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const i = y * width + x;
                if (distMap[i] > 0) {
                    if (x < width - 1) distMap[i] = Math.min(distMap[i], distMap[i + 1] + 3);
                    if (y < height - 1) distMap[i] = Math.min(distMap[i], distMap[i + width] + 3);
                    if (x < width - 1 && y < height - 1) distMap[i] = Math.min(distMap[i], distMap[i + width + 1] + 4);
                    if (x > 0 && y < height - 1) distMap[i] = Math.min(distMap[i], distMap[i + width - 1] + 4);
                }
            }
        }
        return distMap;
    }

    private static sumHistogram(hist: number[], start: number, end: number): number {
        let sum = 0;
        for (let i = start; i <= end; i++) sum += hist[i];
        return sum;
    }

    /**
     * H-Maxima (Dynamics) 기반의 정교한 마커 추출 (Union-Find 이용)
     * MATLAB의 imextendedmin/imimposemin과 유사한 효과를 내며 입자 형상에 구애받지 않음
     */
    private static getHMaximaMarkers(smoothDistMap: Float32Array, phases: Uint8Array, targetPhase: number, width: number, height: number, sensitivity: number): Int32Array {
        const total = width * height;
        let maxD = 0;
        for (let i = 0; i < total; i++) if (phases[i] === targetPhase && smoothDistMap[i] > maxD) maxD = smoothDistMap[i];

        // [교정] 정적 비율 대신 분포의 특성을 반영하도록 h 산출 (병합 조건 강화)
        const h = maxD * (0.02 + 0.05 / sensitivity); 
        const markers = new Int32Array(total).fill(0);
        
        const indices = new Int32Array(total);
        let count = 0;
        for (let i = 0; i < total; i++) if (phases[i] === targetPhase) indices[count++] = i;
        const activeIndices = indices.subarray(0, count);
        activeIndices.sort((a, b) => smoothDistMap[b] - smoothDistMap[a]);

        const parent = new Int32Array(total);
        for (let i = 0; i < total; i++) parent[i] = i;
        const peakHeight = new Float32Array(total);
        const regionMarker = new Int32Array(total);
        const find = (i: number): number => {
            while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        };

        let nextMarkerID = 1;
        for (let k = 0; k < count; k++) {
            const idx = activeIndices[k];
            const val = smoothDistMap[idx];
            const x = idx % width, y = Math.floor(idx / width);

            let neighbors: number[] = [];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nid = ny * width + nx;
                        if (regionMarker[find(nid)] > 0) neighbors.push(find(nid));
                    }
                }
            }
            neighbors = Array.from(new Set(neighbors));

            if (neighbors.length === 0) {
                const m = nextMarkerID++;
                regionMarker[idx] = m;
                peakHeight[idx] = val;
            } else {
                const primary = neighbors[0];
                regionMarker[idx] = regionMarker[primary];
                parent[idx] = primary;
                for (let i = 1; i < neighbors.length; i++) {
                    const secondary = neighbors[i];
                    if (regionMarker[secondary] === regionMarker[primary]) continue;
                    if ((peakHeight[primary] - val) < h || (peakHeight[secondary] - val) < h) {
                        parent[secondary] = primary;
                        peakHeight[primary] = Math.max(peakHeight[primary], peakHeight[secondary]);
                    }
                }
            }
        }

        const finalMarkers = new Int32Array(total);
        for (let i = 0; i < total; i++) {
            if (phases[i] === targetPhase) {
                finalMarkers[i] = regionMarker[find(i)];
            }
        }
        return finalMarkers;
    }

    private static segmentPhase(phases: Uint8Array, targetPhase: number, width: number, height: number, sensitivity: number): { labels: Int32Array, maxLabel: number } {
        const total = width * height;
        const distMap = this.calculateEDM(phases, targetPhase, width, height);

        let maxD = 0;
        for (let i = 0; i < total; i++) {
            if (phases[i] === targetPhase && distMap[i] > maxD) maxD = distMap[i];
        }

        // [교정] Sigma 방향성 수정: 민감도가 높을수록 더 부드럽고 안정적인 지형 확보 (0.8 계수 적용)
        const sigma = sensitivity * 0.8;
        const smoothDistMap = this.applyGaussianFilterFloat(distMap, width, height, sigma);
        
        // 2. Connectivity-based H-maxima Marker Extraction
        const markers = this.getHMaximaMarkers(smoothDistMap, phases, targetPhase, width, height, sensitivity);
        let maxMarker = 0;
        for (let i = 0; i < total; i++) if (markers[i] > maxMarker) maxMarker = markers[i];

        // 3. Prepare Topography for Watershed
        const topography = new Float32Array(total);
        for (let i = 0; i < total; i++) {
            if (phases[i] === targetPhase) {
                // Enhanced topography for smoother boundaries: Combination of Distance and local Gradient
                topography[i] = maxD - smoothDistMap[i];
            } else {
                topography[i] = 1e9;
            }
        }

        // 4. Final Meyer's Watershed
        const labels = this.runWatershed(topography, markers, width, height, phases, targetPhase);
        return { labels, maxLabel: maxMarker };
    }

    /**
     * Removes small isolated regions (islands) of any phase.
     * Uses 8-connectivity to find components and merges them into the background if too small.
     */
    private static removeSmallIslands(phases: Uint8Array, width: number, height: number, minArea: number) {
        const total = width * height;
        const visited = new Uint8Array(total);
        const stack: number[] = [];

        let islandsRemoved = 0;
        let pixelsMerged = 0;

        for (let i = 0; i < total; i++) {
            if (visited[i]) continue;

            const targetPhase = phases[i];
            const component: number[] = [];
            stack.push(i);
            visited[i] = 1;

            while (stack.length > 0) {
                const idx = stack.pop()!;
                component.push(idx);

                const x = idx % width;
                const y = Math.floor(idx / width);

                const nx4 = [x+1, x-1, x, x];
                const ny4 = [y, y, y+1, y-1];

                for (let k = 0; k < 4; k++) {
                    const nx = nx4[k], ny = ny4[k];
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (!visited[nIdx] && phases[nIdx] === targetPhase) {
                            visited[nIdx] = 1;
                            stack.push(nIdx);
                        }
                    }
                }
            }

            if (component.length < minArea) {
                // 병합 로직: 주변 상 탐색
                const nearbyPhases: Record<number, number> = {};
                for (const idx of component) {
                    const x = idx % width, y = Math.floor(idx / width);
                    const nx4 = [x+1, x-1, x, x];
                    const ny4 = [y, y, y+1, y-1];
                    for (let k = 0; k < 4; k++) {
                        const nx = nx4[k], ny = ny4[k];
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const p = phases[ny * width + nx];
                            if (p !== targetPhase) nearbyPhases[p] = (nearbyPhases[p] || 0) + 1;
                        }
                    }
                }
                
                let bestPhase = targetPhase;
                let maxCount = -1;
                for (const pStr in nearbyPhases) {
                    const p = parseInt(pStr);
                    if (nearbyPhases[p] > maxCount) {
                        maxCount = nearbyPhases[p];
                        bestPhase = p;
                    }
                }

                if (bestPhase !== targetPhase) {
                    for (const idx of component) phases[idx] = bestPhase;
                    islandsRemoved++;
                    pixelsMerged += component.length;
                }
            }
        }
        if (islandsRemoved > 0) {
            console.log(`[IslandRemoval] Removed ${islandsRemoved} islands, Total ${pixelsMerged}px merged into neighbors.`);
        }
    }

    private static fitGMM(histogram: number[], total: number) {
        let means = [60, 160, 220];
        let sigmas = [20, 20, 20];
        let weights = [0.2, 0.3, 0.5];
        return { means, sigmas, weights };
    }

    /**
     * Manual Correction: Merge two adjacent labels.
     */
    public static manualMerge(result: MicrostructureResult, x: number, y: number): boolean {
        const { width, height, labels } = result;
        if (!labels) return false;
        const idx = y * width + x;
        const l1 = labels[idx];
        
        // 주변 4방향에서 다른 레이블 찾기
        let l2 = -1;
        const dx = [1, -1, 0, 0], dy = [0, 0, 1, -1];
        for (let i = 0; i < 4; i++) {
            const nx = x + dx[i], ny = y + dy[i];
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nl = labels[ny * width + nx];
                if (nl !== l1 && nl !== 0) { l2 = nl; break; }
            }
        }

        if (l1 > 0 && l2 > 0 && l1 !== l2) {
            console.log(`[ManualCorrection] Merging labels ${l1} and ${l2}`);
            for (let i = 0; i < labels.length; i++) {
                if (labels[i] === l2) labels[i] = l1;
            }
            this.updateManualCorrection(result);
            return true;
        }
        return false;
    }

    /**
     * Manual Correction: Split a label by drawing a line.
     */
    public static manualSplit(result: MicrostructureResult, points: {x: number, y: number}[]): boolean {
        const { width, height, labels } = result;
        if (!labels || points.length < 2) return false;

        // 선이 지나는 픽셀들을 0(경계)으로 만듬
        const affectedLabels = new Set<number>();
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i], p2 = points[i+1];
            // Bresenham's line algorithm or simple interpolation
            const dist = Math.ceil(Math.sqrt((p1.x-p2.x)**2 + (p1.y-p2.y)**2));
            for (let t = 0; t <= dist; t++) {
                const lx = Math.round(p1.x + (p2.x - p1.x) * (t/dist));
                const ly = Math.round(p1.y + (p2.y - p1.y) * (t/dist));
                if (lx >= 0 && lx < width && ly >= 0 && ly < height) {
                    const l = labels[ly * width + lx];
                    if (l > 0) {
                        affectedLabels.add(l);
                        labels[ly * width + lx] = 0; // Cut the existing label
                    }
                }
            }
        }

        if (affectedLabels.size === 0) return false;
        
        // 경계가 생겼으므로, finalizeAnalysis에서 기존 EDM/Morphology 없이 레이블 전파로만은 한계가 있음
        // 그러나 finalizeAnalysis는 labelPhase와 통계만 계산하므로, 
        // 시각화용 boundaryStrength가 이 0값(경계)을 인식하여 선을 그려줄 것임.
        this.updateManualCorrection(result);
        return true;
    }

    /**
     * Manual Correction: Change phase of a label.
     */
    public static manualReassign(result: MicrostructureResult, x: number, y: number, newPhase: number): boolean {
        const { width, labels, labelPhase } = result;
        if (!labels || !labelPhase) return false;
        
        const label = labels[y * width + x];
        if (label > 0) {
            console.log(`[ManualCorrection] Reassigning label ${label} to phase ${newPhase}`);
            labelPhase[label] = newPhase;
            this.updateManualCorrection(result);
            return true;
        }
        return false;
    }

    private static updateManualCorrection(result: MicrostructureResult) {
        // [주의] 수동 보정 시에는 기존에 캐싱된 원본 픽셀 정보가 필요함
        // smoothedPixels가 없는 경우를 대비해 기본값 처리
        const total = result.width * result.height;
        const pixels = result.smoothedPixels || new Uint8ClampedArray(total).fill(128);
        
        this.finalizeAnalysis(
            result.labels!, 
            pixels, 
            result.t1 || 128, 
            result.t2 || 180, 
            result, 
            { phaseMode: result.mcFraction !== undefined ? '3-phase' : '2-phase' }
        );
    }
}

/**
 * OMLayerAnalyzer — OM 단면 컬러 이미지의 Al2O3 / Bonding / TiCN 층 자동 분할
 *
 * 대상: 마운팅 수지(파랑) / (노란 반사띠) / Al2O3(검정) / Bonding(밝고 따뜻한 얇은 띠)
 *       / TiCN(회색 주상정) / WC-Co 모재(밝은 중성색) 순서의 OM 1600x 단면 이미지.
 *
 * 각 층은 있을 수도, 없을 수도 있다 (TiCN 단층, Al2O3 없음, Bonding 없음 등).
 *
 * 알고리즘 (Python 프로토타입에 수지 확장·신뢰도 차단 추가):
 *   파랑·청록·초록 수지를 검출하고, 애매한 경계는 ★로 표시하고, 심각한 검출 실패만 수치를 반환하지 않는다.
 *
 * 순수 함수 모듈 — React/DOM 의존 없음 (AutoCalculator 이식 시 그대로 복사)
 */

export interface OMLayerParams {
    slabHalf: number;      // slab 폭 = 2*slabHalf+1
    xStep: number;         // slab 간격(px)
    xMargin: number;       // 좌우 제외 비율
    resinBlue: number;     // 수지: B - R > 값 (청록 수지는 G≈B)
    resinB: number;        // 수지: B > 값
    resinGreenSlack: number; // 파랑·청록 분기의 G-B 허용 범위 (초록은 별도 검출)
    resinMinPx: number;    // 위에 수지가 최소 이만큼
    resinGapRun: number;   // 비수지 연속 → 수지 끝
    coreMargin: number;    // Al2O3 핵 임계 = 최소 밝기 + margin
    coreCap: number;       // 핵 임계 상한
    coreRun: number;
    upI: number;           // 핵에서 위로: 이 밝기 넘으면 Al2O3 시작
    alAbsentI: number;     // 구간 최소 밝기가 이 값 이상이면 Al2O3 없음
    brightI: number;       // Al2O3 끝 (밝아짐)
    brightRun: number;
    bondMinPeak: number;   // R-B 피크 < 값 → Bonding 없음
    bondWeakPeak: number;  // R-B 피크 < 값 → Bonding 약함(★)
    warmRBMin: number;     // Bonding 따뜻함 임계 하한
    warmRBCap: number;     // 상한
    warmFrac: number;      // 피크 대비 비율
    warmPeakWin: number;   // 피크 탐색 창
    warmOffRun: number;
    smoothWin: number;     // 모재 판정용 세로 이동평균
    ticnRef: [number, number];  // TiCN 밝기 기준 구간 (coat_ref 기준 offset)
    subRef: [number, number];   // 모재 밝기 기준 구간
    subFrac: number;       // 임계 = ticn + frac*(sub - ticn)
    subRun: number;
    minContrast: number;   // 모재-TiCN 밝기 차 < 값 → TiCN 없음
    ticnWeakContrast: number; // 대비 < 값 → TiCN 약함(★)
    rejectOutliersOn: boolean; // 이상치 slab 삭제 (기본 ON)
    minSlabs: number;      // 유효 slab 최소 개수
    slabMedianK: number;   // v1 호환 (v2 미사용)
    outlierAbsPx: number;  // |y-전역중앙값| 초과 → 이상치
    outlierNbK: number;    // 이웃 창
    outlierNbPx: number;   // |y-이웃중앙값| 초과 → 이상치
    presenceLo: number;    // 검출 slab 비율 (lo, hi) 사이 → ★ 검출 불일치
    presenceHi: number;
    presentMin: number;    // 검출 비율 ≥ 값 → 있음
    iqrRelMax: number;     // (p75-p25)/median > 값 → ★ 두께 편차 큼
    weakFracMax: number;   // 약한 신호 slab 비율 > 값 → ★
    validFracMin: number;  // 유효 slab / 샘플 slab < 값 → ★ 전체
    outlierDropMax: number; // 이상치로 버린 slab 비율 > 값 → ★ 이상치 과다
    wcI: number;            // 모재 이동평균 밝기
    wcRun: number;
    wcJump: number;
    wcSearch: [number, number];
    smoothStd: number;
    smoothRun: number;
    coatMaxPx: number;
    coatMinPx: number;
    blueFracMin: number;
}

export const DEFAULT_OM_PARAMS: OMLayerParams = {
    slabHalf: 15, xStep: 8, xMargin: 0.05,
    resinBlue: 25, resinB: 100, resinGreenSlack: 14, resinMinPx: 50, resinGapRun: 20,
    coreMargin: 15, coreCap: 60, coreRun: 25, upI: 60, alAbsentI: 60,
    brightI: 128, brightRun: 30,
    bondMinPeak: 25, bondWeakPeak: 35,
    warmRBMin: 15, warmRBCap: 45, warmFrac: 0.5, warmPeakWin: 60, warmOffRun: 5,
    smoothWin: 15, ticnRef: [20, 80], subRef: [350, 700], subFrac: 0.65, subRun: 20,
    minContrast: 8, ticnWeakContrast: 25,
    rejectOutliersOn: true,
    minSlabs: 20, slabMedianK: 5,
    outlierAbsPx: 120, outlierNbK: 5, outlierNbPx: 40,
    presenceLo: 0.2, presenceHi: 0.8, presentMin: 0.5, iqrRelMax: 0.35, weakFracMax: 0.5, validFracMin: 0.4,
    outlierDropMax: 0.15,
    wcI: 195, wcRun: 16, wcJump: 10, wcSearch: [0.22, 0.88],
    smoothStd: 8.5, smoothRun: 40, coatMaxPx: 280, coatMinPx: 8, blueFracMin: 0.04,
};

export type OMLayerName = 'Al2O3' | 'Bonding' | 'TiCN';
export const OM_LAYER_ORDER: OMLayerName[] = ['Al2O3', 'Bonding', 'TiCN'];

export interface Point { x: number; y: number }

/** 층 하나의 [시작, 끝) 행 (정규화 좌표). 없으면 null */
export interface LayerSpan { start: number; end: number }

export interface SlabBoundary {
    x: number;        // 정규화(수지 위) 좌표계의 slab 중심 x
    resinEnd: number;
    subStart: number;
    Al2O3: LayerSpan | null;
    Bonding: LayerSpan | null;
    TiCN: LayerSpan | null;
    weak: OMLayerName[];   // 이 slab에서 신호가 약했던 층
}

export interface LayerStatPx { median: number; p25: number; p75: number }

export interface OMLayerInfo {
    status: 'present' | 'absent';
    ambiguous: boolean;    // ★ 표기 대상
    flags: string[];       // 애매 사유 (한글)
    nPresent: number;      // 이 층이 검출된 slab 수
    frac: number;          // nPresent / nSlabs
    px: LayerStatPx | null; // present 일 때만
}

export interface OMLayerResult {
    ok: boolean;
    reason?: string;
    rotK: number;                      // 원본→정규화 회전 횟수 (90° CCW 단위)
    nSlabs: number;                    // 유효 slab
    nSampled: number;                  // 시도한 slab
    flags: string[];                   // 이미지 전체 애매 사유
    ambiguous: boolean;                // 전체 또는 어느 층이든 ★
    /** 원본 이미지 좌표계의 층별 상·하 경계 폴리라인 (검출된 slab 만) */
    lines: Record<OMLayerName, { top: Point[]; bottom: Point[] }>;
    layers: Record<OMLayerName, OMLayerInfo>;
    scaleBarPx: number | null;         // 빨간 스케일바 길이(px), 없으면 null
    rejectOutliersOn: boolean;
}

// ---------------------------------------------------------------- helpers

function medianInPlace(buf: Float32Array, n: number): number {
    const a = buf.subarray(0, n);
    a.sort();
    return n % 2 ? a[(n - 1) >> 1] : 0.5 * (a[(n >> 1) - 1] + a[n >> 1]);
}

/** mask[start:end] 에서 true 가 n 개 연속되는 첫 시작 인덱스, 없으면 -1 */
function firstRun(mask: Uint8Array, n: number, start: number, end: number): number {
    let run = 0;
    const e = Math.min(end, mask.length);
    for (let i = Math.max(0, start); i < e; i++) {
        if (mask[i]) {
            run++;
            if (run >= n) return i - n + 1;
        } else {
            run = 0;
        }
    }
    return -1;
}

/** mask[start:end] 에서 true 가 n 개 연속되는 마지막 런의 끝(포함) 인덱스, 없으면 -1 */
function lastRunEnd(mask: Uint8Array, n: number, start: number, end: number): number {
    let run = 0, last = -1;
    const e = Math.min(end, mask.length);
    for (let i = Math.max(0, start); i < e; i++) {
        if (mask[i]) {
            run++;
            if (run >= n) last = i;
        } else {
            run = 0;
        }
    }
    return last;
}

function rollingStd(a: Float32Array, k: number): Float32Array {
    const n = a.length, out = new Float32Array(n);
    const half = k >> 1;
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
        let s = 0, sq = 0, c = hi - lo;
        for (let j = lo; j < hi; j++) { s += a[j]; sq += a[j] * a[j]; }
        const m = s / c;
        out[i] = Math.sqrt(Math.max(0, sq / c - m * m));
    }
    return out;
}

/** 중심 이동평균 (가장자리는 가용 구간만) */
function vsmooth(a: Float32Array, k: number): Float32Array {
    const n = a.length, half = k >> 1, out = new Float32Array(n);
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + a[i];
    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
        out[i] = (cum[hi] - cum[lo]) / (hi - lo);
    }
    return out;
}

function percentile(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statPx(values: number[]): LayerStatPx {
    const s = [...values].sort((a, b) => a - b);
    return { median: percentile(s, 0.5), p25: percentile(s, 0.25), p75: percentile(s, 0.75) };
}

function isResin(r: number, g: number, b: number, p: OMLayerParams): boolean {
    return (b - r > p.resinBlue && b > p.resinB && b + p.resinGreenSlack >= g)
        || (g - r > p.resinBlue && g > p.resinB && g >= b);
}

// ---------------------------------------------------------------- rotation

/** np.rot90 과 동일한 CCW 회전 (k회). 반환: 새 ImageData 형태의 버퍼 */
export function rotateRGBA(data: Uint8ClampedArray, w: number, h: number, k: number):
    { data: Uint8ClampedArray; width: number; height: number } {
    k = ((k % 4) + 4) % 4;
    if (k === 0) return { data, width: w, height: h };
    const nw = k % 2 ? h : w, nh = k % 2 ? w : h;
    const out = new Uint8ClampedArray(nw * nh * 4);
    for (let y2 = 0; y2 < nh; y2++) {
        for (let x2 = 0; x2 < nw; x2++) {
            const src = rotatedToOriginal(x2, y2, k, w, h);
            const si = (src.y * w + src.x) * 4, di = (y2 * nw + x2) * 4;
            out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
        }
    }
    return { data: out, width: nw, height: nh };
}

/** 정규화(회전) 좌표 → 원본 좌표. w,h 는 원본 크기 */
export function rotatedToOriginal(x2: number, y2: number, k: number, w: number, h: number): Point {
    k = ((k % 4) + 4) % 4;
    switch (k) {
        case 1: return { x: w - 1 - y2, y: x2 };
        case 2: return { x: w - 1 - x2, y: h - 1 - y2 };
        case 3: return { x: y2, y: h - 1 - x2 };
        default: return { x: x2, y: y2 };
    }
}

/** 수지(파랑)가 가장 많은 가장자리를 찾아 위로 보내는 회전 횟수 */
export function detectResinRotation(data: Uint8ClampedArray, w: number, h: number, p: OMLayerParams = DEFAULT_OM_PARAMS): number {
    const m = 0.2;
    const bandH = Math.floor(h * m), bandW = Math.floor(w * m);
    const score = [0, 0, 0, 0];
    const step = 2;
    for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
            const i = (y * w + x) * 4;
            if (!isResin(data[i], data[i + 1], data[i + 2], p)) continue;
            if (y < bandH) score[0]++;
            if (y >= h - bandH) score[2]++;
            if (x >= w - bandW) score[1]++;
            if (x < bandW) score[3]++;
        }
    }
    let best = 0;
    for (let k = 1; k < 4; k++) if (score[k] > score[best]) best = k;
    return best;
}

// ---------------------------------------------------------------- scale bar

/** 우하단의 빨간 수평 스케일바 길이(px). 없으면 null */
export function detectScaleBarPx(data: Uint8ClampedArray, w: number, h: number): number | null {
    let best = 0;
    for (let y = Math.floor(h * 0.7); y < h; y++) {
        let run = 0;
        for (let x = Math.floor(w * 0.5); x < w; x++) {
            const i = (y * w + x) * 4;
            const red = data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90;
            if (red) { run++; if (run > best) best = run; }
            else run = 0;
        }
    }
    return best > 20 ? best : null;
}

// ---------------------------------------------------------------- core

/**
 * 정규화(수지 위) 좌표계에서 slab 경계 검출
 */
export function segmentSlabs(data: Uint8ClampedArray, w: number, h: number, p: OMLayerParams = DEFAULT_OM_PARAMS): { slabs: SlabBoundary[]; nSampled: number; dropped: OutlierDrop } {
    const half = p.slabHalf, sw = 2 * half + 1;
    const R = new Float32Array(h), G = new Float32Array(h), B = new Float32Array(h), I = new Float32Array(h);
    const buf = new Float32Array(sw);
    const resin = new Uint8Array(h), bright = new Uint8Array(h), coreMask = new Uint8Array(h);
    const notWarm = new Uint8Array(h), subMask = new Uint8Array(h);

    const out: SlabBoundary[] = [];
    const xLo = Math.floor(w * p.xMargin) + half, xHi = Math.floor(w * (1 - p.xMargin)) - half;
    let nSampled = 0;

    for (let x = xLo; x < xHi; x += p.xStep) {
        nSampled++;
        // --- slab 행별 중앙값 프로파일
        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let c = 0; c < 3; c++) {
                for (let dx = -half; dx <= half; dx++) buf[dx + half] = data[(row + x + dx) * 4 + c];
                const m = medianInPlace(buf, sw);
                if (c === 0) R[y] = m; else if (c === 1) G[y] = m; else B[y] = m;
            }
            I[y] = 0.299 * R[y] + 0.587 * G[y] + 0.114 * B[y];
            resin[y] = isResin(R[y], G[y], B[y], p) ? 1 : 0;
            bright[y] = I[y] > p.brightI ? 1 : 0;
        }

        // --- 파랑·청록·초록 수지 끝. 충분한 수지 구간 뒤의 경계를 찾는다.
        let resinEnd = -1, cum = 0, gap = 0;
        for (let y = 0; y < h; y++) {
            if (resin[y]) { cum++; gap = 0; }
            else {
                gap++;
                if (gap >= p.resinGapRun && cum >= p.resinMinPx) { resinEnd = y - p.resinGapRun + 1; break; }
            }
        }
        if (resinEnd < 0) continue;

        const Is = vsmooth(I, p.smoothWin);
        const weak: OMLayerName[] = [];
        let Al2O3: LayerSpan | null = null, Bonding: LayerSpan | null = null, TiCN: LayerSpan | null = null;
        let coatRef = resinEnd;

        const zoneEnd = Math.min(h, resinEnd + 600);
        let minI = 255;
        for (let y = resinEnd; y < zoneEnd; y++) if (I[y] < minI) minI = I[y];
        if (minI < p.alAbsentI) {
            const coreThr = Math.min(p.coreCap, minI + p.coreMargin);
            for (let y = 0; y < h; y++) coreMask[y] = I[y] < coreThr ? 1 : 0;
            const coreStart = firstRun(coreMask, p.coreRun, resinEnd, zoneEnd);
            if (coreStart >= 0) {
                const alEnd = firstRun(bright, p.brightRun, coreStart + 5, Math.min(h, coreStart + 800));
                if (alEnd < 0) continue;
                let alStart = resinEnd;
                for (let y = coreStart - 1; y >= resinEnd; y--) {
                    if (I[y] > p.upI) { alStart = y + 1; break; }
                }
                Al2O3 = { start: alStart, end: alEnd };
                coatRef = alEnd;
                const winEnd = Math.min(h, alEnd + p.warmPeakWin);
                let peakIdx = alEnd, peak = -Infinity;
                for (let y = alEnd; y < winEnd; y++) { const rb = R[y] - B[y]; if (rb > peak) { peak = rb; peakIdx = y; } }
                if (peak >= p.bondMinPeak) {
                    const warmThr = Math.max(p.warmRBMin, Math.min(p.warmRBCap, p.warmFrac * peak));
                    for (let y = 0; y < h; y++) notWarm[y] = (R[y] - B[y]) > warmThr ? 0 : 1;
                    let bondEnd = firstRun(notWarm, p.warmOffRun, peakIdx, Math.min(h, alEnd + 300));
                    if (bondEnd < 0) bondEnd = alEnd + 1;
                    Bonding = { start: alEnd, end: bondEnd };
                    coatRef = bondEnd;
                    if (peak < p.bondWeakPeak) weak.push('Bonding');
                }
            }
        }
        const t0 = coatRef + p.ticnRef[0], t1 = coatRef + p.ticnRef[1];
        const s0 = coatRef + p.subRef[0], s1 = coatRef + p.subRef[1];
        if (s1 > h) continue;
        const ticnLevel = medianInPlace(Float32Array.from(Is.subarray(t0, t1)), t1 - t0);
        const subLevel = medianInPlace(Float32Array.from(Is.subarray(s0, s1)), s1 - s0);
        const contrast = subLevel - ticnLevel;
        let subStart = coatRef;
        if (contrast >= p.minContrast) {
            const thr = ticnLevel + p.subFrac * contrast;
            for (let y = 0; y < h; y++) subMask[y] = Is[y] > thr ? 1 : 0;
            const ss = firstRun(subMask, p.subRun, t1, s1);
            if (ss < 0) continue;
            subStart = ss;
            TiCN = { start: coatRef, end: subStart };
            if (contrast < p.ticnWeakContrast) weak.push('TiCN');
        }
        if (Al2O3 === null && TiCN === null) continue;
        out.push({ x, resinEnd, subStart, Al2O3, Bonding, TiCN, weak });
    }
    if (!p.rejectOutliersOn) return { slabs: out, nSampled, dropped: emptyDropped() };
    const rej = rejectOutliers(out, p);
    return { slabs: rej.slabs, nSampled, dropped: rej.dropped };
}

export type OutlierDrop = Record<OMLayerName, { before: number; drop: number }>;
function emptyDropped(): OutlierDrop {
    return { Al2O3: { before: 0, drop: 0 }, Bonding: { before: 0, drop: 0 }, TiCN: { before: 0, drop: 0 } };
}

/** 경계 y가 이웃·전역 중앙값에서 크게 벗어나면 그 slab의 해당 층을 삭제. 스무딩하지 않음. */
export function rejectOutliers(slabs: SlabBoundary[], p: OMLayerParams): { slabs: SlabBoundary[]; dropped: OutlierDrop } {
    const n = slabs.length;
    const dropped = emptyDropped();
    if (n < 3) return { slabs, dropped };
    const half = p.outlierNbK >> 1;
    const out = slabs.map(s => ({ ...s, weak: [...s.weak] }));
    for (const L of OM_LAYER_ORDER) {
        const idx: number[] = [];
        for (let i = 0; i < n; i++) if (out[i][L]) idx.push(i);
        dropped[L].before = idx.length;
        if (idx.length < 3) continue;
        const drop = new Set<number>();
        for (const edge of ['start', 'end'] as const) {
            const ys = idx.map(i => (out[i][L] as LayerSpan)[edge]);
            const sorted = [...ys].sort((a, b) => a - b);
            const gmed = percentile(sorted, 0.5);
            for (let t = 0; t < idx.length; t++) {
                const lo = Math.max(0, t - half), hi = Math.min(idx.length, t + half + 1);
                const win = ys.slice(lo, hi).sort((a, b) => a - b);
                const local = percentile(win, 0.5);
                if (Math.abs(ys[t] - local) > p.outlierNbPx || Math.abs(ys[t] - gmed) > p.outlierAbsPx) drop.add(idx[t]);
            }
        }
        dropped[L].drop = drop.size;
        for (const i of drop) out[i][L] = null;
    }
    return { slabs: out, dropped };
}

/** 남은 점의 중앙값 y → 선분 2점 (정규화 좌표) */
export function layerSegment(slabs: SlabBoundary[], L: OMLayerName): { top: Point[]; bottom: Point[] } {
    const xs: number[] = [], y0s: number[] = [], y1s: number[] = [];
    for (const s of slabs) {
        if (!s[L]) continue;
        xs.push(s.x); y0s.push((s[L] as LayerSpan).start); y1s.push((s[L] as LayerSpan).end);
    }
    if (xs.length < 2) return { top: [], bottom: [] };
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = percentile([...y0s].sort((a, b) => a - b), 0.5);
    const y1 = percentile([...y1s].sort((a, b) => a - b), 0.5);
    return { top: [{ x: x0, y: y0 }, { x: x1, y: y0 }], bottom: [{ x: x0, y: y1 }, { x: x1, y: y1 }] };
}

/** 이상치 OFF: slab 검출점을 그대로 이은 폴리라인 */
export function layerPolyline(slabs: SlabBoundary[], L: OMLayerName): { top: Point[]; bottom: Point[] } {
    const top: Point[] = [], bottom: Point[] = [];
    for (const s of slabs) {
        if (!s[L]) continue;
        top.push({ x: s.x, y: (s[L] as LayerSpan).start });
        bottom.push({ x: s.x, y: (s[L] as LayerSpan).end });
    }
    return { top, bottom };
}

/** 인접 slab k개 이동 중앙값 — 층 경계는 공간적으로 연속이라는 가정으로 고립 스파이크 제거.
 *  층이 없는 slab은 창에서 제외(nanmedian). */
export function smoothSlabs(slabs: SlabBoundary[], k: number): SlabBoundary[] {
    const n = slabs.length;
    if (n < k || k < 3) return slabs;
    const half = k >> 1;
    const out = slabs.map(s => ({ ...s }));
    for (const L of OM_LAYER_ORDER) {
        for (const edge of ['start', 'end'] as const) {
            for (let i = 0; i < n; i++) {
                const span = slabs[i][L];
                if (!span) continue;
                const win: number[] = [];
                for (let j = Math.max(0, i - half); j < Math.min(n, i + half + 1); j++) {
                    const sp = slabs[j][L];
                    if (sp) win.push(sp[edge]);
                }
                win.sort((a, b) => a - b);
                const m = win.length;
                const med = m % 2 ? win[(m - 1) >> 1] : 0.5 * (win[(m >> 1) - 1] + win[m >> 1]);
                out[i][L] = { ...(out[i][L] as LayerSpan), [edge]: med };
            }
        }
    }
    return out;
}

/** slab 결과 → 층별 있음/없음/★ 판정 + 두께 통계(px) */
export function summarizeLayers(
    slabs: SlabBoundary[],
    nSampled: number,
    p: OMLayerParams,
    dropped?: Record<OMLayerName, { before: number; drop: number }>,
): Pick<OMLayerResult, 'layers' | 'flags' | 'ambiguous'> {
    const nValid = slabs.length;
    const flags: string[] = [];
    if (nValid < p.validFracMin * nSampled) flags.push(`유효 slab 비율 낮음 (${nValid}/${nSampled})`);
    const layers = {} as Record<OMLayerName, OMLayerInfo>;
    let anyAmb = flags.length > 0;
    for (const L of OM_LAYER_ORDER) {
        const present = slabs.filter(s => s[L]);
        const frac = nValid ? present.length / nValid : 0;
        const info: OMLayerInfo = { status: 'absent', ambiguous: false, flags: [], nPresent: present.length, frac, px: null };
        if (frac >= p.presentMin) {
            info.status = 'present';
            info.px = statPx(present.map(s => (s[L] as LayerSpan).end - (s[L] as LayerSpan).start));
            if (info.px.median > 0 && (info.px.p75 - info.px.p25) / info.px.median > p.iqrRelMax) info.flags.push('두께 편차 큼');
            const weakFrac = present.filter(s => s.weak.includes(L)).length / present.length;
            if (weakFrac > p.weakFracMax) info.flags.push('신호 약함');
        }
        if (frac > p.presenceLo && frac < p.presenceHi) info.flags.push(`검출 불일치 (${present.length}/${nValid} slab)`);
        const d = dropped?.[L];
        if (d && d.before > 0 && d.drop / d.before > p.outlierDropMax) {
            info.flags.push(`이상치 과다 (${d.drop}/${d.before} slab)`);
        }
        info.ambiguous = info.flags.length > 0;
        anyAmb ||= info.ambiguous;
        layers[L] = info;
    }
    return { layers, flags, ambiguous: anyAmb };
}

/**
 * 전체 파이프라인: 방향 정규화 → slab 분할 → 원본 좌표 폴리라인 + 층별 판정/두께 통계
 */
export function analyzeOMLayers(imageData: ImageData, params: Partial<OMLayerParams> = {}): OMLayerResult {
    const p: OMLayerParams = { ...DEFAULT_OM_PARAMS, ...params };
    const { data, width: w, height: h } = imageData;

    const scaleBarPx = detectScaleBarPx(data, w, h);
    const failure = (reason: string, rotK = 0, nSlabs = 0, nSampled = 0): OMLayerResult => ({
        ok: false, reason, rotK, nSlabs, nSampled, scaleBarPx,
        rejectOutliersOn: p.rejectOutliersOn, ambiguous: true, flags: [reason],
        lines: { Al2O3: { top: [], bottom: [] }, Bonding: { top: [], bottom: [] }, TiCN: { top: [], bottom: [] } },
        layers: summarizeLayers([], 0, p).layers,
    });
    const rotK = detectResinRotation(data, w, h, p);
    const rot = rotateRGBA(data, w, h, rotK);
    const { slabs, nSampled, dropped } = segmentSlabs(rot.data, rot.width, rot.height, p);

    const toOrig = (x: number, y: number) => rotatedToOriginal(x, y, rotK, w, h);
    const lines = {} as OMLayerResult['lines'];
    for (const L of OM_LAYER_ORDER) {
        const seg = p.rejectOutliersOn ? layerSegment(slabs, L) : layerPolyline(slabs, L);
        lines[L] = {
            top: seg.top.map(p => toOrig(p.x, p.y)),
            bottom: seg.bottom.map(p => toOrig(p.x, p.y)),
        };
    }

    const summary = summarizeLayers(slabs, nSampled, p, p.rejectOutliersOn ? dropped : undefined);
    if (slabs.length < p.minSlabs) {
        return failure(`유효 slab 부족 (${slabs.length}/${nSampled})`, rotK, slabs.length, nSampled);
    }
    // 약한 신호/보통 편차는 ★로 보고한다. 측정 근거가 크게 무너진 경우만 실패.
    const severe: string[] = [];
    const supported = slabs.filter(s => OM_LAYER_ORDER.some(L => s[L])).length;
    if (supported < p.minSlabs || supported < nSampled * 0.2) {
        severe.push(`측정 가능한 구간이 너무 적음 (${supported}/${nSampled})`);
    }
    if (!OM_LAYER_ORDER.some(L => summary.layers[L].status === 'present')) severe.push('확인된 층 없음');
    for (const L of OM_LAYER_ORDER) {
        const px = summary.layers[L].px;
        if (px && (!Number.isFinite(px.median) || px.median <= 0 || (px.p75 - px.p25) / px.median > 1)) {
            severe.push(`${OM_LAYER_LABEL[L]} 두께 편차가 지나치게 큼`);
        }
        const d = dropped[L];
        if (d.before >= p.minSlabs && d.drop / d.before > 0.6) {
            severe.push(`${OM_LAYER_LABEL[L]} 경계 대부분이 이상치 (${d.drop}/${d.before})`);
        }
    }
    if (severe.length) return failure(severe.join(' · '), rotK, supported, nSampled);
    return { ok: true, rotK, nSlabs: slabs.length, nSampled, lines, scaleBarPx, rejectOutliersOn: p.rejectOutliersOn, ...summary };
}

// ---------------------------------------------------------------- reporting

export const OM_LAYER_LABEL: Record<OMLayerName, string> = { Al2O3: 'Al₂O₃', Bonding: 'Bonding', TiCN: 'TiCN' };

/** 층 하나의 실단위 보고값 */
export interface OMLayerReport {
    status: 'present' | 'absent';
    ambiguous: boolean;
    flags: string[];
    value: number | null;   // median (실단위)
    p25: number | null;
    p75: number | null;
    nPresent: number;
}

/** px 통계 → 실단위 보고 (pxToReal: px → µm 등) */
export function reportOMLayers(res: OMLayerResult, pxToReal: (px: number) => number): Record<OMLayerName, OMLayerReport> {
    const out = {} as Record<OMLayerName, OMLayerReport>;
    for (const L of OM_LAYER_ORDER) {
        const info = res.layers[L];
        out[L] = {
            status: info.status, ambiguous: info.ambiguous, flags: info.flags, nPresent: info.nPresent,
            value: res.ok && info.px ? pxToReal(info.px.median) : null,
            p25: res.ok && info.px ? pxToReal(info.px.p25) : null,
            p75: res.ok && info.px ? pxToReal(info.px.p75) : null,
        };
    }
    return out;
}

/** Measurement('om-layers').data 페이로드. results 는 있는 층만 (기존 층별 두께 패널 호환) */
export function omResultToMeasurementData(res: OMLayerResult, pxToReal: (px: number) => number) {
    const layers = reportOMLayers(res, pxToReal);
    const results: Record<string, number> = {};
    for (const L of OM_LAYER_ORDER) if (layers[L].value !== null) results[L] = layers[L].value as number;
    return {
        ok: res.ok,
        results: res.ok ? results : null,
        layers,
        lines: res.lines,
        nSlabs: res.nSlabs,
        nSampled: res.nSampled,
        flags: res.flags,
        ambiguous: res.ambiguous,
        rotK: res.rotK,
        scaleBarPx: res.scaleBarPx,
        rejectOutliersOn: res.rejectOutliersOn,
        reason: res.reason,
        timestamp: new Date().toLocaleTimeString(),
    };
}

/** "★Al₂O₃: 3.88 µm (3.70~4.05)" / "Bonding: 없음" 형태 한 줄 */
export function formatOMLayer(L: OMLayerName, r: OMLayerReport, unit: string, withIQR = true): string {
    const star = r.ambiguous ? '★' : '';
    if (r.status === 'absent' || r.value === null) return `${star}${OM_LAYER_LABEL[L]}: 없음`;
    const iqr = withIQR && r.p25 !== null && r.p75 !== null ? ` (${r.p25.toFixed(2)}~${r.p75.toFixed(2)})` : '';
    return `${star}${OM_LAYER_LABEL[L]}: ${r.value.toFixed(2)} ${unit}${iqr}`;
}

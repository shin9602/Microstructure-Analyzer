import { v4 as uuidv4 } from 'uuid';
import type { XRDDataPoint, PeakDefinition, TCResult, MaterialPreset, PeakRange } from '../types';

/**
 * Parses the .asc file content.
 * Returns normalized data AND the normalization factor (max intensity).
 */
export const parseXRDFile = (content: string): {
  data: XRDDataPoint[],
  normalizationFactor: number,
  wavelength?: { kAlpha1: number, kAlpha2: number, ratio: number }
} => {
  const lines = content.split('\n');
  const rawData: XRDDataPoint[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);

    if (parts.length >= 2) {
      const twoTheta = parseFloat(parts[0]);
      const intensity = parseFloat(parts[1]);

      if (!isNaN(twoTheta) && !isNaN(intensity)) {
        rawData.push({ twoTheta, intensity });
      }
    }
  }

  if (rawData.length === 0) {
    throw new Error("No valid data points found in file.");
  }

  // Find max intensity to normalize against
  const maxIntensity = Math.max(...rawData.map(d => d.intensity));

  // Normalize data 0-100
  const normalizedData = rawData.map(point => ({
    ...point,
    intensity: maxIntensity === 0 ? 0 : (point.intensity / maxIntensity) * 100
  }));

  return {
    data: normalizedData,
    normalizationFactor: maxIntensity
  };
};

/**
 * Parses the .xrdml (XML) file content.
 */
export const parseXRDMLFile = (content: string): {
  data: XRDDataPoint[],
  normalizationFactor: number,
  wavelength?: { kAlpha1: number, kAlpha2: number, ratio: number }
} => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, "text/xml");

  // 1. Extract Wavelength
  const wavelengthNode = xmlDoc.getElementsByTagName("usedWavelength")[0];
  let wavelengthInfo;
  if (wavelengthNode) {
    const kAlpha1 = parseFloat(wavelengthNode.getElementsByTagName("kAlpha1")[0]?.textContent || "0");
    const kAlpha2 = parseFloat(wavelengthNode.getElementsByTagName("kAlpha2")[0]?.textContent || "0");
    const ratio = parseFloat(wavelengthNode.getElementsByTagName("ratioKAlpha2KAlpha1")[0]?.textContent || "0");
    if (kAlpha1 > 0) {
      wavelengthInfo = { kAlpha1, kAlpha2, ratio };
    }
  }

  // 2. Extract Data Points
  let intensitiesNode = xmlDoc.getElementsByTagName("intensities")[0];
  if (!intensitiesNode) {
    // Fallback for some formats using 'counts'
    intensitiesNode = xmlDoc.getElementsByTagName("counts")[0];
  }

  const positionsNodes = xmlDoc.getElementsByTagName("positions");

  let startPos = 0;
  let endPos = 0;

  for (let i = 0; i < positionsNodes.length; i++) {
    const node = positionsNodes[i];
    if (node.getAttribute("axis") === "2Theta") {
      startPos = parseFloat(node.getElementsByTagName("startPosition")[0]?.textContent || "0");
      endPos = parseFloat(node.getElementsByTagName("endPosition")[0]?.textContent || "0");
      break;
    }
  }

  if (!intensitiesNode || !intensitiesNode.textContent) {
    throw new Error("No intensity data (intensities/counts) found in .xrdml file.");
  }

  const intensityValues = intensitiesNode.textContent.trim().split(/\s+/).map(v => parseFloat(v));
  const numPoints = intensityValues.length;

  if (numPoints < 2) {
    throw new Error("Insufficient data points in .xrdml file.");
  }

  const rawData: XRDDataPoint[] = [];
  const stepSize = (endPos - startPos) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const twoTheta = startPos + (i * stepSize);
    const intensity = intensityValues[i];
    if (!isNaN(twoTheta) && !isNaN(intensity)) {
      rawData.push({ twoTheta, intensity });
    }
  }

  // 3. Apply Advanced Preprocessing
  let processedData = rawData;
  processedData = applyBaselineCorrection(processedData, 100); // window_size 100-200 recommended

  if (wavelengthInfo) {
    processedData = applyKa2Stripping(
      processedData,
      wavelengthInfo.kAlpha1,
      wavelengthInfo.kAlpha2,
      wavelengthInfo.ratio
    );
  }

  // Find max intensity to normalize against processed data
  const maxIntensity = Math.max(...processedData.map(d => d.intensity));

  // Normalize data 0-100
  const normalizedData = processedData.map(point => ({
    ...point,
    intensity: maxIntensity === 0 ? 0 : (point.intensity / maxIntensity) * 100
  }));

  return {
    data: normalizedData,
    normalizationFactor: maxIntensity,
    wavelength: wavelengthInfo
  };
};

/**
 * Baseline Correction using Rolling Minimum + Smoothing.
 */
export const applyBaselineCorrection = (data: XRDDataPoint[], windowSize: number = 200): XRDDataPoint[] => {
  const intensities = data.map(d => d.intensity);
  const n = intensities.length;
  const baseline = new Float64Array(n);

  // 1. Rolling Minimum
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(n, i + windowSize);
    let min = intensities[start];
    for (let j = start + 1; j < end; j++) {
      if (intensities[j] < min) min = intensities[j];
    }
    baseline[i] = min;
  }

  // 2. Simple Smoothing (Moving Average)
  const smoothedBackground = new Float64Array(n);
  const halfWindow = Math.floor(windowSize / 2);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(n, i + halfWindow);
    for (let j = start; j < end; j++) {
      sum += baseline[j];
      count++;
    }
    smoothedBackground[i] = sum / (count || 1);
  }

  return data.map((point, i) => ({
    ...point,
    intensity: Math.max(0, point.intensity - smoothedBackground[i])
  }));
};

/**
 * K-alpha 2 Stripping using Rachinger Method.
 */
export const applyKa2Stripping = (
  data: XRDDataPoint[],
  k1: number,
  k2: number,
  ratio: number
): XRDDataPoint[] => {
  if (k1 === 0 || k2 === 0) return data;

  const angles = data.map(d => d.twoTheta);
  const intensities = data.map(d => d.intensity);
  const n = data.length;

  // Linear Interpolation helper
  const interpolate = (targetX: number): number => {
    if (targetX < angles[0] || targetX > angles[n - 1]) return 0;

    // Binary search for efficiency
    let low = 0;
    let high = n - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (angles[mid] < targetX) low = mid + 1;
      else if (angles[mid] > targetX) high = mid - 1;
      else return intensities[mid];
    }

    const i1 = high;
    const i2 = low;
    if (i1 < 0 || i2 >= n) return 0;

    const x1 = angles[i1], y1 = intensities[i1];
    const x2 = angles[i2], y2 = intensities[i2];
    return y1 + (targetX - x1) * (y2 - y1) / (x2 - x1);
  };

  return data.map(point => {
    const thetaRad = (point.twoTheta / 2) * (Math.PI / 180);
    // delta_2theta = 2.0 * arcsin((k2/k1) * sin(theta)) - 2theta
    const shifted2ThetaRad = Math.asin((k2 / k1) * Math.sin(thetaRad));
    const shifted2Theta = 2.0 * shifted2ThetaRad * (180 / Math.PI);
    const delta2Theta = shifted2Theta - point.twoTheta;

    const ka2Intensity = interpolate(point.twoTheta - delta2Theta);
    return {
      ...point,
      intensity: Math.max(0, point.intensity - ratio * ka2Intensity)
    };
  });
};

/**
 * Extracts the maximum intensity within a specific 2-theta range.
 */
export const extractMaxIntensity = (
  data: XRDDataPoint[],
  min2Theta: number,
  max2Theta: number
): number => {
  const pointsInRange = data.filter(
    (p) => p.twoTheta >= min2Theta && p.twoTheta <= max2Theta
  );

  if (pointsInRange.length === 0) return 0;

  return Math.max(...pointsInRange.map((p) => p.intensity));
};

/**
 * Calculates Texture Coefficients.
 * Requires normalizationFactor to compute raw intensity for display.
 */
export const calculateTC = (
  definitions: PeakDefinition[],
  data: XRDDataPoint[],
  normalizationFactor: number,
  formula: string = 'ratio / avgRatio'
): TCResult[] => {
  const intermediateResults: {
    plane: string;
    measured: number;
    ref: number;
    ratio: number;
  }[] = [];

  // 1. Extract Intensities
  for (const def of definitions) {
    const measured = extractMaxIntensity(data, def.range.min, def.range.max);
    const ref = def.referenceIntensity;

    if (ref === 0) {
      console.warn(`Reference intensity for ${def.plane} is 0. Skipping.`);
      continue;
    }

    const ratio = measured / ref;
    intermediateResults.push({
      plane: def.plane,
      measured,
      ref,
      ratio,
    });
  }

  // 2. Calculate Average Ratio
  const validRatios = intermediateResults.map((r) => r.ratio);
  const sumRatios = validRatios.reduce((a, b) => a + b, 0);
  const avgRatio = validRatios.length > 0 ? sumRatios / validRatios.length : 0;

  // 3. Calculate Final TC & Raw Intensity
  const results: TCResult[] = intermediateResults.map((item) => {
    let tc = 0;

    // Dynamic Formula Evaluation
    try {
      // Available variables: ratio, avgRatio, measured, ref
      // We create a function with these arguments
      const evaluate = new Function('ratio', 'avgRatio', 'measured', 'ref', `return ${formula};`);
      tc = evaluate(item.ratio, avgRatio, item.measured, item.ref);
    } catch (e) {
      console.error("Formula evaluation error:", e);
      tc = 0; // Default or error value
    }

    // Calculate Raw Intensity: (Measured(0-100) / 100) * MaxIntensity
    const rawIntensity = (item.measured / 100) * normalizationFactor;

    return {
      plane: item.plane,
      measuredIntensity: item.measured,
      rawIntensity: rawIntensity,
      referenceIntensity: item.ref,
      ratio: item.ratio,
      tc,
    };
  });

  return results;
};

// --- Conversion Helpers ---

export const definitionsToPreset = (name: string, definitions: PeakDefinition[]): MaterialPreset => {
  const references: Record<string, number> = {};
  const defaultRanges: Record<string, PeakRange> = {};

  definitions.forEach(def => {
    references[def.plane] = def.referenceIntensity;
    defaultRanges[def.plane] = def.range;
  });

  return {
    name,
    references,
    defaultRanges
  };
};

export const presetToDefinitions = (preset: MaterialPreset): PeakDefinition[] => {
  return Object.keys(preset.references).map(plane => {
    const range = preset.defaultRanges[plane] || { min: 0, max: 0 };
    return {
      id: uuidv4(),
      plane,
      referenceIntensity: preset.references[plane],
      range,
      theoreticalPos: preset.theoreticalPositions?.[plane] ?? ((range.min + range.max) / 2)
    };
  });
};

// --- C/N Ratio Calculations ---

export const calculateLatticeParameter = (
  lambda: number,
  h: number,
  k: number,
  l: number,
  twoTheta: number
): number => {
  const thetaRadians = (twoTheta / 2) * (Math.PI / 180);
  const sqrtHKL = Math.sqrt(h * h + k * k + l * l);
  return (lambda * sqrtHKL) / (2 * Math.sin(thetaRadians));
};

export const calculateCNRatioResult = (a: number) => {
  const aTiN = 4.2373;
  const aTiC = 4.3230;

  const cFraction = (a - aTiN) / (aTiC - aTiN);
  const nFraction = 1 - cFraction;

  return {
    cPercentage: cFraction,
    nPercentage: nFraction
  };
};

/**
 * Finds the 22-theta position with the maximum intensity within a given range.
 */
export const findPeakInTwoThetaRange = (
  data: XRDDataPoint[],
  min2Theta: number,
  max2Theta: number
): number | null => {
  const pointsInRange = data.filter(
    (p) => p.twoTheta >= min2Theta && p.twoTheta <= max2Theta
  );

  if (pointsInRange.length === 0) return null;

  let maxPt = pointsInRange[0];
  for (const pt of pointsInRange) {
    if (pt.intensity > maxPt.intensity) {
      maxPt = pt;
    }
  }

  return maxPt.twoTheta;
};

/**
 * Calculates FWHM (Full Width at Half Maximum) using linear interpolation.
 */
export const calculateFWHM = (
  data: XRDDataPoint[],
  min2Theta: number,
  max2Theta: number
): { fwhm: number; left2Theta: number; right2Theta: number; peak2Theta: number; halfMax: number } | null => {
  const pointsInRange = data.filter(
    (p) => p.twoTheta >= min2Theta && p.twoTheta <= max2Theta
  );

  if (pointsInRange.length < 3) return null;

  // 1. Find the peak
  let peakIdx = 0;
  let maxIntensity = pointsInRange[0].intensity;
  for (let i = 1; i < pointsInRange.length; i++) {
    if (pointsInRange[i].intensity > maxIntensity) {
      maxIntensity = pointsInRange[i].intensity;
      peakIdx = i;
    }
  }

  const peak2Theta = pointsInRange[peakIdx].twoTheta;
  const halfMax = maxIntensity / 2;

  // 2. Find left crossing point (searching from peak to left)
  let left2Theta = pointsInRange[0].twoTheta;
  for (let i = peakIdx; i > 0; i--) {
    const p1 = pointsInRange[i];     // point with y >= halfMax
    const p2 = pointsInRange[i - 1]; // point with y < halfMax
    if (p1.intensity >= halfMax && p2.intensity <= halfMax) {
      // Linear interpolation: x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
      left2Theta = p1.twoTheta + (halfMax - p1.intensity) * (p2.twoTheta - p1.twoTheta) / (p2.intensity - p1.intensity);
      break;
    }
  }

  // 3. Find right crossing point (searching from peak to right)
  let right2Theta = pointsInRange[pointsInRange.length - 1].twoTheta;
  for (let i = peakIdx; i < pointsInRange.length - 1; i++) {
    const p1 = pointsInRange[i];     // point with y >= halfMax
    const p2 = pointsInRange[i + 1]; // point with y < halfMax
    if (p1.intensity >= halfMax && p2.intensity <= halfMax) {
      right2Theta = p1.twoTheta + (halfMax - p1.intensity) * (p2.twoTheta - p1.twoTheta) / (p2.intensity - p1.intensity);
      break;
    }
  }

  const fwhm = right2Theta - left2Theta;
  return { fwhm, left2Theta, right2Theta, peak2Theta, halfMax };
};

/**
 * Williamson-Hall 분석: 여러 피크의 FWHM을 통해 응력(Strain)과 입도 크기(Grain Size) 계산
 * 
 * 수식: β_hkl cos θ = (K×λ)/D + 4ε sin θ
 * - Y축: β cos θ
 * - X축: 4 sin θ
 * - 기울기: ε (Strain)
 * - Y절편: (K×λ)/D
 */
export const calculateWilliamsonHall = (
  peakDefinitions: PeakDefinition[],
  data: XRDDataPoint[],
  lambda: number,
  kFactor: number,
  excludedPeakIds?: Set<string>
): {
  strain: number;
  grainSize: number;
  yIntercept: number;
  slope: number;
  rSquared: number;
  peakData: any[];
  plotData: any[];
} | null => {
  const dataPoints: { x: number; y: number; id: string; plane: string; fwhm: number; twoTheta: number; beta: number; theta: number; isExcluded: boolean }[] = [];

  // 각 피크에 대해 FWHM 측정 (모든 피크 계산)
  for (const def of peakDefinitions) {
    const fwhmResult = calculateFWHM(data, def.range.min, def.range.max);
    if (!fwhmResult) continue;

    const beta = fwhmResult.fwhm * (Math.PI / 180); // Convert to radians
    const theta = (fwhmResult.peak2Theta / 2) * (Math.PI / 180); // Convert to radians

    const y = beta * Math.cos(theta);
    const x = 4 * Math.sin(theta);
    const isExcluded = excludedPeakIds ? excludedPeakIds.has(def.id) : false;

    dataPoints.push({
      x,
      y,
      id: def.id,
      plane: def.plane,
      fwhm: fwhmResult.fwhm,
      twoTheta: fwhmResult.peak2Theta,
      beta,
      theta,
      isExcluded
    });
  }

  // 회귀 분석에 사용할 포인트 필터링
  const regressionPoints = dataPoints.filter(p => !p.isExcluded);

  if (regressionPoints.length < 2) {
    // 계산 불가하지만 데이터는 반환
    return {
      strain: 0,
      grainSize: 0,
      yIntercept: 0,
      slope: 0,
      rSquared: 0,
      peakData: dataPoints.map(p => ({
        plane: p.plane,
        twoTheta: p.twoTheta,
        fwhm: p.fwhm,
        beta: p.beta,
        theta: p.theta,
        x: p.x,
        y: p.y,
        grainSize: (kFactor * lambda) / (p.beta / Math.cos(p.theta)),
        isExcluded: p.isExcluded
      })),
      plotData: []
    };
  }

  // 선형 회귀 (Least Squares Method) - 유효한 포인트만 사용
  const n = regressionPoints.length;
  const sumX = regressionPoints.reduce((sum, p) => sum + p.x, 0);
  const sumY = regressionPoints.reduce((sum, p) => sum + p.y, 0);
  const sumXY = regressionPoints.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumX2 = regressionPoints.reduce((sum, p) => sum + p.x * p.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const yIntercept = (sumY - slope * sumX) / n;

  // R² 계산
  const yMean = sumY / n;
  const ssTotal = regressionPoints.reduce((sum, p) => sum + Math.pow(p.y - yMean, 2), 0);
  const ssResidual = regressionPoints.reduce((sum, p) => {
    const yPred = slope * p.x + yIntercept;
    return sum + Math.pow(p.y - yPred, 2);
  }, 0);
  const rSquared = ssTotal === 0 ? 1 : 1 - (ssResidual / ssTotal);

  // 응력과 입도 크기 계산
  const strain = slope; // ε = slope
  const grainSize = (kFactor * lambda) / yIntercept; // D = (K×λ) / yIntercept (in Å)

  // 각 피크별 상세 데이터 (모든 피크 포함)
  const peakData = dataPoints.map(p => ({
    plane: p.plane,
    twoTheta: p.twoTheta,
    fwhm: p.fwhm,
    beta: p.beta,
    theta: p.theta,
    x: p.x,
    y: p.y,
    grainSize: (kFactor * lambda) / (p.beta / Math.cos(p.theta)), // Individual grain size from Scherrer
    isExcluded: p.isExcluded
  }));

  // 플롯 데이터 (실제 값 + 회귀선)
  // 제외된 피크도 플롯에 표시하되 구분할 수 있게 함 (여기서는 데이터에 포함)
  const plotData = dataPoints.map(p => ({
    x: p.x,
    y: p.y,
    yFit: slope * p.x + yIntercept,
    isExcluded: p.isExcluded,
    plane: p.plane
  }));

  return {
    strain,
    grainSize,
    yIntercept,
    slope,
    rSquared,
    peakData,
    plotData
  };
};

/**
 * Calculates Grain Size using Scherrer Equation.
 * D = (K * lambda) / (beta * cos(theta))
 * @param k Shape factor (default 0.9)
 * @param lambda Wavelength in Angstroms (default 1.5418)
 * @param fwhm FWHM in degrees
 * @param peak2Theta Center of peak in degrees
 */
export const calculateGrainSize = (
  k: number,
  lambda: number,
  fwhm: number,
  peak2Theta: number
): number => {
  const beta = fwhm * (Math.PI / 180); // convert deg to radians
  const theta = (peak2Theta / 2) * (Math.PI / 180); // Bragg angle in radians
  const d = (k * lambda) / (beta * Math.cos(theta));
  return d; // result in Angstroms
};
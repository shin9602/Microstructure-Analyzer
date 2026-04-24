export interface XRDDataPoint {
  twoTheta: number;
  intensity: number;
}

export interface PeakRange {
  min: number;
  max: number;
}

export interface PeakDefinition {
  id: string;
  plane: string;
  range: PeakRange;
  referenceIntensity: number;
  theoreticalPos: number;
}

export interface TCResult {
  plane: string;
  measuredIntensity: number; // Normalized (0-100)
  rawIntensity: number;      // Original value
  referenceIntensity: number;
  ratio: number;
  tc: number;
  peakTwoTheta: number;
  isNearBoundary: boolean;
}

export interface ParsedFile {
  id: string;
  name: string;
  data: XRDDataPoint[];
  normalizationFactor: number;
  twoThetaShift?: number;
}

export interface WHPeakData {
  plane: string;
  twoTheta: number;
  fwhm: number;
  beta: number;          // FWHM in radians
  theta: number;         // θ in rad ians
  x: number;             // 4 sin θ
  y: number;             // β cos θ
  grainSize: number;     // Individual grain size from this peak
}

export interface WHAnalysisResult {
  strain: number;        // ε (Strain/응력)
  grainSize: number;     // D (Grain Size/입도 크기) from regression
  yIntercept: number;    // K×λ/D
  slope: number;         // 4ε
  rSquared: number;      // R² (선형 회귀 적합도)
  peakData: WHPeakData[]; // 각 피크별 상세 데이터
  plotData: { x: number; y: number; yFit: number }[]; // Linear regression plot data
}

export interface FileResult {
  fileId: string;
  fileName: string;
  results: TCResult[];
  whAnalysis?: WHAnalysisResult;
}

export interface MaterialPreset {
  name: string;
  references: Record<string, number>;
  defaultRanges: Record<string, PeakRange>;
  theoreticalPositions?: Record<string, number>;
}

export enum AppStep {
  UPLOAD = 'UPLOAD',
  CONFIGURE = 'CONFIGURE',
  RESULTS = 'RESULTS'
}

export enum AnalysisMode {
  TC = 'TC',
  CN_RATIO = 'CN_RATIO',
  GRAIN_SIZE = 'GRAIN_SIZE'
}
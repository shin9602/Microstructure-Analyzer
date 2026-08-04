/** OM 선 측정 시 선택 가능한 층 종류 */
export const LINE_LAYER_TYPES = ['데코층', 'Al2O3', 'Bonding', 'TiCN'] as const;
export type LineLayerType = (typeof LINE_LAYER_TYPES)[number];
export const DEFAULT_LINE_LAYER: LineLayerType = 'Al2O3';

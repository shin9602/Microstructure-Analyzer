/** OM 선 측정 시 선택 가능한 층 종류 */
export const LINE_LAYER_TYPES = ['데코층', 'Al2O3', 'Bonding', 'TiCN'] as const;
export type LineLayerType = (typeof LINE_LAYER_TYPES)[number];
export const DEFAULT_LINE_LAYER: LineLayerType = 'Al2O3';

/** Tab 키로 순환하는 층 (코팅 스택 순서) */
export const TAB_CYCLE_LINE_LAYERS: readonly LineLayerType[] = ['Al2O3', 'Bonding', 'TiCN'];

export function nextLineLayerOnTab(current: LineLayerType, reverse = false): LineLayerType {
    const cycle = TAB_CYCLE_LINE_LAYERS;
    const idx = cycle.indexOf(current);
    if (idx < 0) return reverse ? cycle[cycle.length - 1] : cycle[0];
    const delta = reverse ? -1 : 1;
    return cycle[(idx + delta + cycle.length) % cycle.length];
}

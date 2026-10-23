"""User-selected eta masks on the exact square grid used by EBSD analysis."""
from pathlib import Path
import numpy as np
from ebsd_limits import square_axes, check_grid_shape


def square_grid(xmap, table, step):
    if xmap.size == xmap.shape[0] * xmap.shape[1]:
        shape = xmap.shape
        check_grid_shape(*shape)
        index = np.arange(len(table)).reshape(shape)
    else:
        from scipy.spatial import cKDTree
        x, y = square_axes(xmap, step)
        xx, yy = np.meshgrid(x, y)
        _, index = cKDTree(np.c_[xmap.x, xmap.y]).query(np.c_[xx.ravel(), yy.ravel()])
        index = index.reshape(xx.shape)
    return table[index, 5], table[index, 7], index


def load_eta_mask(shape, selection=None):
    if not selection:
        return np.zeros(shape, dtype=bool)
    if [int(selection['height']), int(selection['width'])] != list(shape):
        raise ValueError('에타 선택 격자가 현재 파일과 다릅니다. 영역을 다시 선택하세요.')
    values = np.fromfile(selection['path'], dtype=np.uint8)
    if values.size != int(np.prod(shape)) or np.any(values > 1):
        raise ValueError('에타 선택 데이터가 손상되었습니다. 영역을 다시 선택하세요.')
    return values.reshape(shape).astype(bool)


def smooth_iq_excluding(iq, excluded):
    from scipy.ndimage import median_filter
    if not np.any(excluded):
        return median_filter(iq, size=3)
    # Excluded pixels must not influence the Co threshold near their edges.
    data = np.where(excluded | (iq < 0), np.nan, iq)
    padded = np.pad(data, 1, mode='edge')
    output = np.empty(iq.shape, dtype=float)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        for start in range(0, len(iq), 64):
            end = min(start + 64, len(iq))
            windows = np.lib.stride_tricks.sliding_window_view(padded[start:end + 2], (3, 3))
            output[start:end] = np.nanmedian(windows, axis=(-2, -1))
    output[excluded] = iq[excluded]
    return output


def export_eta_regions(output_dir, base_name, selected, valid, iq, step, origin):
    from scipy.ndimage import label
    import pandas as pd
    import matplotlib.pyplot as plt
    from ebsd_exports import export_histogram
    selected = selected & valid
    regions, count = label(selected)  # Four-connected regions, not orientation grains.
    pixels = np.bincount(regions.ravel())[1:]
    areas = pixels * step ** 2
    diameters = 2 * np.sqrt(areas / np.pi)
    output = Path(output_dir)
    stem = output / f'ETA_MAP_{base_name}.png'
    row, col = np.indices(selected.shape)
    pd.DataFrame({'row': row.ravel(), 'column': col.ravel(),
                  'x_um': origin[0] + col.ravel() * step,
                  'y_um': origin[1] + row.ravel() * step,
                  'eta_selected': selected.ravel(), 'region_id': regions.ravel(),
                  'iq': iq.ravel(), 'valid': valid.ravel()}).to_csv(stem.with_suffix('.csv'), index=False, encoding='utf-8-sig')
    image = np.ones(selected.shape + (3,), dtype=np.uint8) * 245
    image[selected] = [183, 78, 220]
    image[~valid] = 255
    plt.imsave(stem, image)
    raw = {'region_id': np.arange(1, count + 1), 'pixel_count': pixels,
           'area_um2': areas, 'equivalent_diameter_um': diameters}
    # Preserve regions touching the field edge and identify them in the export.
    edge = np.unique(np.r_[regions[0], regions[-1], regions[:, 0], regions[:, -1]])
    raw['touches_scan_edge'] = np.isin(np.arange(1, count + 1), edge)
    distribution = output / f'ETA_SIZE_{base_name}.png'
    counts, bins = np.histogram(diameters, bins=min(40, max(1, count)), range=(0, float(diameters.max()) * 1.05 if count else 1))
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.stairs(counts, bins, fill=True, color='#b74edc')
    ax.set(xlabel='Eta region equivalent diameter (um)', ylabel='Region count', title='User-selected eta regions')
    fig.tight_layout(); fig.savefig(distribution, dpi=160); plt.close(fig)
    export_histogram(distribution, counts, bins, raw)
    if count:
        order = np.argsort(diameters)
        fraction = np.cumsum(areas[order]) / areas.sum()
        d10, d50, d90 = np.interp([.1, .5, .9], fraction, diameters[order])
    else:
        d10 = d50 = d90 = None
    return {'Eta_Area': float(selected.sum() / max(1, valid.sum()) * 100),
            'Eta_Regions': int(count), 'Eta_N': float(diameters.mean()) if count else None,
            'Eta_A': float(np.average(diameters, weights=areas)) if count else None,
            'Eta_D10': d10, 'Eta_D50': d50, 'Eta_D90': d90,
            'Eta_Max': float(diameters.max()) if count else None}

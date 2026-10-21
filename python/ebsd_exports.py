"""Export the exact bins and source samples used to draw a distribution."""
from pathlib import Path
import numpy as np
import pandas as pd


def export_iq_map(image_path, iq, step, origin, source_table):
    """Plot unsmoothed IQ and export both display-grid and native scan values."""
    import matplotlib.pyplot as plt
    image_path = Path(image_path)
    iq = np.asarray(iq, dtype=float)
    valid = np.isfinite(iq) & (iq >= 0)
    row, column = np.indices(iq.shape)
    values = np.where(valid, iq, np.nan)
    pd.DataFrame({'row': row.ravel(), 'column': column.ravel(),
                  'x_um': origin[0] + column.ravel() * step,
                  'y_um': origin[1] + row.ravel() * step,
                  'iq': values.ravel(), 'valid': valid.ravel()}).to_csv(
        image_path.with_suffix('.csv'), index=False, encoding='utf-8-sig')
    source_table = np.asarray(source_table)
    pd.DataFrame({'x_um': source_table[:, 3], 'y_um': source_table[:, 4],
                  'iq': source_table[:, 5], 'ci': source_table[:, 6],
                  'source_phase_id': source_table[:, 7].astype(int)}).to_csv(
        image_path.with_name(image_path.stem + '_raw.csv'), index=False, encoding='utf-8-sig')
    rows, cols = iq.shape
    fig, ax = plt.subplots(figsize=(7, max(3, 7 * rows / max(1, cols))))
    cmap = plt.get_cmap('gray').copy()
    cmap.set_bad('#7f9eb2')
    extent = [origin[0] - step / 2, origin[0] + (cols - .5) * step,
              origin[1] + (rows - .5) * step, origin[1] - step / 2]
    image = ax.imshow(np.ma.array(iq, mask=~valid), cmap=cmap, extent=extent,
                      interpolation='nearest')
    ax.set(title='IQ map (raw, no smoothing)', xlabel='X (um)', ylabel='Y (um)')
    fig.colorbar(image, ax=ax, label='Image Quality (IQ)', fraction=.045, pad=.03)
    fig.tight_layout()
    fig.savefig(image_path, dpi=160, bbox_inches='tight')
    plt.close(fig)


def export_histogram(image_path, counts, edges, raw_columns, extra_columns=None):
    image_path = Path(image_path)
    counts, edges = np.asarray(counts), np.asarray(edges)
    columns = {
        'bin_left': edges[:-1], 'bin_right': edges[1:],
        'bin_center': (edges[:-1] + edges[1:]) / 2,
        'count': counts,
        'frequency_percent': counts / max(1, counts.sum()) * 100,
    }
    columns.update(extra_columns or {})
    pd.DataFrame(columns).to_csv(image_path.with_suffix('.csv'), index=False, encoding='utf-8-sig')
    pd.DataFrame(raw_columns).to_csv(image_path.with_name(image_path.stem + '_raw.csv'), index=False, encoding='utf-8-sig')


def mesh_data_frame(artist, label):
    """Exact projected mesh cells and densities from a plotted pole figure."""
    coordinates = np.asarray(artist.get_coordinates())
    density = np.ma.asarray(artist.get_array())
    height, width = coordinates.shape[0] - 1, coordinates.shape[1] - 1
    values = density.reshape(height, width)
    row, col = np.indices((height, width))
    columns = {'figure': label, 'grid_row': row.ravel(), 'grid_column': col.ravel(),
               'density_mrd': values.filled(np.nan).ravel(),
               'masked': np.ma.getmaskarray(values).ravel()}
    corners = [coordinates[:-1, :-1], coordinates[:-1, 1:], coordinates[1:, 1:], coordinates[1:, :-1]]
    for index, corner in enumerate(corners):
        columns[f'corner_{index}_x'] = corner[..., 0].ravel()
        columns[f'corner_{index}_y'] = corner[..., 1].ravel()
    return pd.DataFrame(columns)

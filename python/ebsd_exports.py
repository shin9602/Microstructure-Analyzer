"""Export the exact bins and source samples used to draw a distribution."""
from pathlib import Path
import numpy as np
import pandas as pd


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

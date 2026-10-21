from pathlib import Path
import tempfile
import unittest
import numpy as np
import pandas as pd
from ebsd_exports import export_histogram, mesh_data_frame


class GraphExportTests(unittest.TestCase):
    def test_export_preserves_samples_and_exact_plot_bins(self):
        values = np.array([.1, .2, .4, .8, 1.0])
        counts, edges = np.histogram(values, bins=3)
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'distribution_sample.png'
            export_histogram(image, counts, edges, {'equivalent_diameter_um': values})
            bins = pd.read_csv(image.with_suffix('.csv'))
            raw = pd.read_csv(image.with_name(image.stem + '_raw.csv'))
            np.testing.assert_allclose(raw['equivalent_diameter_um'], values)
            np.testing.assert_allclose(bins['bin_left'], edges[:-1])
            np.testing.assert_allclose(bins['bin_right'], edges[1:])
            np.testing.assert_array_equal(bins['count'], counts)
            self.assertAlmostEqual(bins['frequency_percent'].sum(), 100)

    def test_density_export_preserves_mesh_and_mask(self):
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots()
        values = np.ma.array([[1., 2.], [3., 4.]], mask=[[False, False], [True, False]])
        artist = ax.pcolormesh([0, 1, 2], [0, 1, 2], values)
        frame = mesh_data_frame(artist, 'test pole')
        self.assertEqual(len(frame), 4)
        self.assertTrue(frame.loc[2, 'masked'])
        self.assertTrue(np.isnan(frame.loc[2, 'density_mrd']))
        self.assertEqual(frame.loc[3, 'density_mrd'], 4)
        self.assertEqual(frame.loc[0, 'corner_2_x'], 1)
        plt.close(fig)


if __name__ == '__main__':
    unittest.main()

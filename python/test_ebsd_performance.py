import unittest
import os
from pathlib import Path
os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(__file__).parent / '.temp_ebsd' / '.numba_cache'))
import numpy as np
from orix.quaternion import Orientation, symmetry
from ebsd_performance import neighbor_angles, remove_edge_grains


class PerformanceTests(unittest.TestCase):
    def test_selected_angles_equal_full_grid(self):
        angles = np.deg2rad(np.arange(60).reshape(4, 5, 3))
        orientations = Orientation.from_euler(angles, symmetry=symmetry.O)
        mask = np.array([[1, 1, 0, 1, 1], [1, 0, 1, 1, 1],
                         [0, 1, 1, 1, 0], [1, 1, 0, 1, 1]], dtype=bool)
        actual = neighbor_angles(orientations, mask)
        reference = (orientations[:, :-1].angle_with(orientations[:, 1:]),
                     orientations[:-1].angle_with(orientations[1:]))
        selected = (mask[:, :-1] & mask[:, 1:], mask[:-1] & mask[1:])
        for a, b, keep in zip(actual, reference, selected):
            np.testing.assert_allclose(a[keep], b[keep], atol=1e-12)
            self.assertTrue(np.isnan(a[~keep]).all())

    def test_empty_selection_skips_all_angles(self):
        orientation = Orientation.identity((2, 3))
        self.assertTrue(all(np.isnan(a).all() for a in neighbor_angles(orientation, np.zeros((2, 3), bool))))

    def test_bulk_edge_removal_preserves_ids_and_background(self):
        labels = np.array([[0, 2, 2, 8], [3, 3, 2, 8], [5, 5, 5, 0]])
        zone = np.zeros(labels.shape, bool)
        zone[0] = True
        reference = labels.copy()
        for label in np.unique(reference[zone & (reference > 0)]):
            reference[reference == label] = 0
        np.testing.assert_array_equal(remove_edge_grains(labels.copy(), zone), reference)


if __name__ == '__main__':
    unittest.main()

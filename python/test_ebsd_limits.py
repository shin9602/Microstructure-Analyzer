import unittest
from types import SimpleNamespace
import numpy as np
from ebsd_limits import check_grid_shape, square_axes


class LimitTests(unittest.TestCase):
    def test_rejects_invalid_or_oversized_geometry(self):
        for shape in [(0, 1), (-1, 10), (16385, 1), (5000, 5000)]:
            with self.subTest(shape=shape), self.assertRaises(ValueError):
                check_grid_shape(*shape)

    def test_rejects_nonfinite_and_tiny_spacing_before_allocation(self):
        scan = SimpleNamespace(x=np.array([0., 100.]), y=np.array([0., 100.]))
        for step in [0., -1., float('nan'), float('inf'), 1e-300]:
            with self.subTest(step=step), self.assertRaises(ValueError):
                square_axes(scan, step)

    def test_valid_grid_matches_existing_coordinates(self):
        scan = SimpleNamespace(x=np.array([0., 2.]), y=np.array([0., 1.]))
        x, y = square_axes(scan, .5)
        np.testing.assert_array_equal(x, np.arange(0., 2.25, .5))
        np.testing.assert_array_equal(y, np.arange(0., 1.25, .5))

    def test_damaged_ang_rejects_huge_grid_before_row_allocation(self):
        from ebsd_phases import recover_ang_table
        header = '# GRID: SquareGrid\n# XSTEP: 1\n# YSTEP: 1\n# NCOLS_ODD: 1\n# NCOLS_EVEN: 1\n# NROWS: 999999999\n'
        with self.assertRaises(ValueError):
            recover_ang_table(header + 'damaged data')


if __name__ == '__main__':
    unittest.main()

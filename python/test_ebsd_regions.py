from pathlib import Path
import tempfile
import unittest
import numpy as np
import pandas as pd
from scipy.ndimage import median_filter
from ebsd_regions import load_eta_mask, smooth_iq_excluding, export_eta_regions
from ebsd_phases import split_wc_co, resolve_phases, measured_boundaries


class EtaTests(unittest.TestCase):
    def test_eta_precedes_co_and_co_basis_is_explicit(self):
        iq = np.arange(10.).reshape(2, 5)
        raw = np.full(iq.shape, 7)
        selected = np.zeros(iq.shape, bool); selected.ravel()[:2] = True
        mapping = {'WC': [7], 'Co': [], 'Gamma': []}
        remaining, _, audit = split_wc_co(iq, raw, mapping, 20, eta_mask=selected)
        total, _, _ = split_wc_co(iq, raw, mapping, 20, eta_mask=selected, co_basis='total')
        self.assertTrue(np.all(remaining[selected] == 4))
        self.assertEqual(np.sum(remaining == 2), 2)
        self.assertEqual(np.sum(total == 2), 3)
        self.assertEqual(audit['eta_percent'], 20)
        self.assertEqual(audit['co_percent_before_cleanup'], 20)
        self.assertEqual(audit['co_percent_of_analyzed_area'], 25)

    def test_manual_roles_are_not_overwritten_by_iq(self):
        header = '# Phase 7\n# MaterialName Unnamed hard phase\n# Symmetry 62\n# Phase 2\n# MaterialName Source B\n# Phase 4\n# MaterialName Source C\n# Phase 9\n# MaterialName Source D\n# Phase 5\n# MaterialName Source E\n'
        raw = np.array([[7, 2, 4, 9, 5, 0]])
        roles = {'7': 'WC', '2': 'Co', '4': 'Gamma', '9': 'Eta', '5': 'Exclude'}
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'input.ang'; file.write_text(header)
            mapping = resolve_phases(file, raw, 'manual', roles)
            phases, cutoff, audit = split_wc_co(np.ones(raw.shape), raw, mapping, 100, gamma_mode='manual')
            np.testing.assert_array_equal(phases, [[1, 2, 3, 4, 0, 0]])
            self.assertIsNone(cutoff)
            self.assertIsNone(audit['co_wt_percent'])
            self.assertEqual(audit['analysis_points'], 3)
            self.assertEqual(audit['user_excluded_points'], 2)
            with self.assertRaisesRegex(ValueError, '누락'):
                resolve_phases(file, raw, 'manual', {'7': 'WC'})

    def test_mask_geometry_and_binary_values_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mask.bin'
            np.array([1, 0, 0, 1], np.uint8).tofile(path)
            selection = {'path': str(path), 'height': 2, 'width': 2}
            np.testing.assert_array_equal(load_eta_mask((2, 2), selection), [[True, False], [False, True]])
            with self.assertRaisesRegex(ValueError, '격자'):
                load_eta_mask((1, 4), selection)
            path.write_bytes(bytes([2, 0, 0, 0]))
            with self.assertRaisesRegex(ValueError, '손상'):
                load_eta_mask((2, 2), selection)

    def test_named_mode_honors_explicit_whole_sample_co_basis(self):
        raw = np.array([[1, 1, 1, 1, 1, 1, 3, 3, 3, 3]])
        selected = np.zeros(raw.shape, bool); selected[0, 0] = True
        phases, _, audit = split_wc_co(np.arange(10.).reshape(raw.shape), raw,
                                      {'WC': [1], 'Co': [], 'Gamma': [3]}, 20,
                                      gamma_mode='named', eta_mask=selected, co_basis='total')
        self.assertEqual(np.sum(phases == 2), 3)
        self.assertTrue(np.all(phases[raw == 3] == 3))
        self.assertIsNone(audit['co_target_percent_of_non_gamma'])
        self.assertIsNotNone(audit['co_target_percent_of_total'])

    def test_eta_does_not_influence_neighbor_iq_or_create_boundaries(self):
        iq = np.full((3, 3), 1000.); iq[1, 1] = 1
        selected = np.ones(iq.shape, bool); selected[1, 1] = False
        self.assertEqual(smooth_iq_excluding(iq, selected)[1, 1], 1)
        np.testing.assert_array_equal(smooth_iq_excluding(iq, np.zeros(iq.shape, bool)), median_filter(iq, size=3))
        phases = np.array([[1, 4, 1]]); grains = np.array([[10, -1, 11]])
        self.assertFalse(measured_boundaries(phases, grains, np.ones(phases.shape, bool))[0].any())

    def test_size_export_counts_selected_regions_not_orientation_grains(self):
        selected = np.zeros((3, 5), bool); selected[0, :2] = True; selected[2, 4] = True
        with tempfile.TemporaryDirectory() as directory:
            result = export_eta_regions(directory, 'sample', selected, np.ones(selected.shape, bool), np.ones(selected.shape), .5, (0, 0))
            self.assertEqual(result['Eta_Regions'], 2)
            self.assertEqual(result['Eta_Area'], 20)
            self.assertAlmostEqual(result['Eta_N'], np.mean(2 * np.sqrt(np.array([.5, .25]) / np.pi)))
            rows = pd.read_csv(Path(directory) / 'ETA_SIZE_sample_raw.csv')
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows['pixel_count'].sum(), 3)
            grid = pd.read_csv(Path(directory) / 'ETA_MAP_sample.csv')
            self.assertEqual(grid.eta_selected.sum(), 3)

    def test_invalid_sites_are_never_eta_and_total_target_can_be_rejected(self):
        iq = np.array([[1., 2., -1., 4.]])
        selected = np.array([[True, True, True, False]])
        phases, _, audit = split_wc_co(iq, np.ones(iq.shape), {'WC': [1], 'Co': [], 'Gamma': []}, 0, eta_mask=selected)
        np.testing.assert_array_equal(phases, [[4, 4, 0, 1]])
        self.assertAlmostEqual(audit['eta_percent'], 200 / 3)
        with self.assertRaisesRegex(ValueError, '전체 시료'):
            split_wc_co(iq, np.ones(iq.shape), {'WC': [1], 'Co': [], 'Gamma': []}, 100, eta_mask=selected, co_basis='total')


if __name__ == '__main__':
    unittest.main()

import os
from pathlib import Path
import tempfile
import unittest

os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(__file__).parent / '.temp_ebsd' / '.numba_cache'))
import numpy as np
from ebsd_phases import load_ebsd, recover_ang_table, resolve_phases, split_wc_co, phase_role, clean_phase_map, measured_boundaries, source_ipf_map, analysis_symmetry, grain_neighbor_connections
from osc_to_ang import write_ang


class PhaseTests(unittest.TestCase):
    def test_default_gamma_includes_unknown_material_but_not_cobalt_or_unindexed(self):
        header = '# Phase 1\n# MaterialName WC\n# Symmetry 62\n# Phase 2\n# MaterialName Co (Cobalt, beta - cubic)\n# Phase 4\n# MaterialName Ti C\n# Phase 5\n# MaterialName Mixed carbide\n'
        default = self.mapping(header, [0, 1, 2, 4, 5])
        legacy = self.mapping(header, [0, 1, 2, 4, 5], 'named')
        self.assertEqual(default['Gamma'], [4, 5])
        self.assertEqual(default['Co'], [2])
        self.assertEqual(default['Other'], [])
        self.assertEqual(legacy['Gamma'], [4])
        self.assertEqual(legacy['Other'], [5])

    def test_unified_gamma_merges_source_labels_but_keeps_real_misorientation(self):
        from orix.quaternion import Orientation, symmetry
        angles = np.deg2rad([[0, 0, 0], [1, 0, 0], [1, 0, 0], [10, 0, 0]])
        orientations = Orientation(np.tile(Orientation.from_euler(angles).data, (2, 1, 1)), symmetry=symmetry.O)
        source = np.tile([4, 4, 5, 5], (2, 1))
        valid = np.ones(source.shape, dtype=bool)
        merged, _ = grain_neighbor_connections(orientations, valid, source, separate_sources=False)
        legacy, _ = grain_neighbor_connections(orientations, valid, source, separate_sources=True)
        np.testing.assert_array_equal(merged, [[True, True, False], [True, True, False]])
        np.testing.assert_array_equal(legacy, [[True, False, False], [True, False, False]])

    def test_fcc_symmetry_equivalent_orientations_do_not_create_gamma_boundary(self):
        from types import SimpleNamespace
        from orix.quaternion import Orientation, symmetry
        mapping = {'WC': [1], 'Co': [], 'Gamma': [4, 5]}
        xmap = SimpleNamespace(phases={4: SimpleNamespace(point_group=symmetry.D6), 5: SimpleNamespace(point_group=symmetry.O)})
        group = analysis_symmetry(xmap, mapping, 3)
        self.assertEqual(group.name, symmetry.O.name)
        with self.assertRaisesRegex(ValueError, 'incompatible'):
            analysis_symmetry(xmap, mapping, 3, 'named')
        orientation = Orientation.from_euler(np.deg2rad([[0, 0, 0], [90, 0, 0]]), symmetry=group).reshape(1, 2)
        right, _ = grain_neighbor_connections(orientation, np.ones((1, 2), dtype=bool), np.array([[4, 5]]), False)
        self.assertTrue(right[0, 0])

    def test_all_phase_ipf_uses_unified_gamma_model_when_selected(self):
        from types import SimpleNamespace
        from orix.quaternion import Orientation, symmetry
        phases = {4: SimpleNamespace(name='Mixed carbide', point_group=symmetry.D6)}
        rotations = Orientation.from_euler([[.3, .7, .9]]).data.reshape(1, 1, 4)
        args = (SimpleNamespace(phases=phases), rotations, np.array([[4]]), np.ones((1, 1), dtype=bool), {'Gamma': [4]})
        merged, merged_meta = source_ipf_map(*args)
        legacy, legacy_meta = source_ipf_map(*args, gamma_mode='named')
        self.assertEqual(merged_meta[0]['point_group'], symmetry.O.name)
        self.assertEqual(legacy_meta[0]['point_group'], symmetry.D6.name)
        self.assertFalse(np.allclose(merged, legacy))

    def test_invalid_gamma_mode_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'gamma analysis mode'):
            resolve_phases('not-read.ang', np.array([1]), 'unsupported')

    def test_all_phase_ipf_uses_each_source_symmetry_and_keeps_invalid_white(self):
        from types import SimpleNamespace
        from orix.quaternion import Orientation, symmetry
        from orix.plot import IPFColorKeyTSL
        from orix.vector import Vector3d
        phases = {1: SimpleNamespace(name='WC', point_group=symmetry.D6),
                  4: SimpleNamespace(name='TiC', point_group=symmetry.O)}
        source = np.array([[1, 4, 0]])
        rotations = Orientation.from_euler([[.3, .7, .9]]).data
        rotations = np.tile(rotations, (1, 3, 1))
        image, metadata = source_ipf_map(SimpleNamespace(phases=phases), rotations, source, np.array([[True, True, False]]))
        for column, phase_id in enumerate((1, 4)):
            group = phases[phase_id].point_group
            expected = IPFColorKeyTSL(group, direction=Vector3d.zvector()).orientation2color(Orientation(rotations[0, column:column+1], symmetry=group))
            np.testing.assert_allclose(image[0, column], expected[0])
        np.testing.assert_array_equal(image[0, 2], [1, 1, 1])
        self.assertEqual([row['source_phase_id'] for row in metadata], [1, 4])

    def test_mineral_name_suffix_does_not_hide_tic(self):
        self.assertEqual(phase_role({'MaterialName': 'Ti C (khamrabaevite, hongquiite)'}), 'Gamma')
        self.assertEqual(phase_role({'MaterialName': 'Nb C'}), 'Gamma')
        self.assertEqual(phase_role({'MaterialName': 'Co (Cobalt, beta - cubic)'}), 'Co')
        self.assertEqual(phase_role({'MaterialName': 'W C (hexagonal)'}), 'WC')

    def test_low_ci_gamma_area_is_preserved(self):
        phases = np.array([[1, 1, 3, 3, 2], [1, 1, 3, 3, 2]])
        ids = np.array([[10, 10, -1, -1, -1], [10, 10, -1, -1, -1]])
        cleaned, grains = clean_phase_map(phases, ids, np.ones(phases.shape, dtype=bool))
        np.testing.assert_array_equal(cleaned == 3, phases == 3)
        self.assertTrue(np.all(grains[phases == 3] == -1))

    def test_missing_gamma_orientations_are_not_filled_even_in_same_region(self):
        phases = np.array([[3, 3, 1, 3, 3], [3, 3, 1, 3, 3]])
        ids = np.array([[7, -1, 8, -1, -1], [7, -1, 8, -1, -1]])
        cleaned, grains = clean_phase_map(phases, ids, np.ones(phases.shape, dtype=bool))
        np.testing.assert_array_equal(cleaned, phases)
        self.assertTrue(np.all(grains[:, 0] == 7))
        self.assertTrue(np.all(grains[:, 1] == -1))
        self.assertTrue(np.all(grains[:, 3:] == -1))

    def test_wc_gap_does_not_create_a_voronoi_boundary(self):
        phases = np.ones((2, 5), dtype=int)
        ids = np.array([[10, 10, -1, 20, 20], [10, 10, -1, 20, 20]])
        valid = np.ones(phases.shape, dtype=bool)
        cleaned, grains = clean_phase_map(phases, ids, valid)
        np.testing.assert_array_equal(grains, ids)
        right, bottom = measured_boundaries(cleaned, grains, valid)
        self.assertFalse(right.any())
        self.assertFalse(bottom.any())

    def test_measured_interfaces_survive_but_unknown_and_binder_edges_do_not(self):
        phases = np.array([[1, 1, 3, 3, 2, 2, 1]])
        ids = np.array([[10, 11, 12, -1, 13, 14, -1]])
        right, bottom = measured_boundaries(phases, ids, np.ones(phases.shape, dtype=bool))
        np.testing.assert_array_equal(right, [[True, True, False, False, False, False]])
        self.assertEqual(bottom.size, 0)

    def test_single_pixel_noise_is_not_a_grain_boundary(self):
        phases = np.ones((2, 3), dtype=int)
        ids = np.array([[10, 10, 11], [10, 10, -1]])
        valid = np.ones(phases.shape, dtype=bool)
        cleaned, grains = clean_phase_map(phases, ids, valid)
        self.assertEqual(grains[0, 2], -1)
        self.assertFalse(any(edge.any() for edge in measured_boundaries(cleaned, grains, valid)))

    def test_osc_padding_and_irregular_rows_do_not_inflate_header(self):
        # Actual scan row lengths 3, 2, 2; trailing slots have no measurement.
        data = np.zeros((9, 10))
        data[:7, 3] = [0, 1, 2, .5, 1.5, 0, 1]
        data[:7, 4] = [0, 0, 0, .8660254, .8660254, 1.7320508, 1.7320508]
        data[:7, 5:7] = [100, .5]
        data[:7, 7] = 3
        data[7:, 5:7] = -1
        data[7:, :3] = 4 * np.pi
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'converted.ang'
            write_ang(file, data, 1, .8660254, phases=[{'id': 3, 'name': 'WC', 'symmetry': 62, 'lattice': (2.906, 2.906, 2.838, 90, 90, 120)}])
            header = file.read_text()
            self.assertIn('# GRID_ROW_COUNTS: 3 2 2', header)
            self.assertIn('# PADDING_RECORD_COUNT: 2', header)
            xmap, table, _ = load_ebsd(file)
            self.assertEqual(len(table), 7)
            self.assertFalse(xmap._file_integrity['has_errors'])

    def test_incomplete_file_has_explicit_integrity_flag(self):
        header = '# Phase 3\n# MaterialName WC\n# Symmetry 62\n# LatticeConstants 2.906 2.906 2.838 90 90 120\n# GRID: SquareGrid\n# XSTEP: 1\n# YSTEP: 1\n# NCOLS_ODD: 2\n# NCOLS_EVEN: 2\n# NROWS: 2\n'
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'sample.ang'
            rows = '0 0 0 0 0 100 .5 3 1 1\n0 0 0 1 0 100 .5 3 1 1\n0 0 0 0 1 100 .5 3 1 1\n'
            file.write_text(header + rows, encoding='utf-8')
            xmap, table, _ = load_ebsd(file)
            self.assertTrue(xmap._file_integrity['has_errors'])
            self.assertEqual(table.shape[0], 4)
            file.write_text(header + rows + '0 0 0 1 1 100 .5 3 1 1\n', encoding='utf-8')
            xmap, _, _ = load_ebsd(file)
            self.assertFalse(xmap._file_integrity['has_errors'])

    def mapping(self, text, phases, mode='all_other'):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'sample.ang'
            file.write_text(text, encoding='utf-8')
            return resolve_phases(file, np.asarray(phases), mode)

    def test_source_ids_and_cobalt_beta_are_not_gamma(self):
        mapping = self.mapping('# Phase 1\n# MaterialName Co (Cobalt, alpha - hex)\n# Phase 2\n# MaterialName Co (Cobalt, beta - cubic)\n# Phase 3\n# MaterialName W C\n# Symmetry 62\n', [1, 2, 3])
        self.assertEqual(mapping['WC'], [3])
        self.assertEqual(mapping['Co'], [1, 2])
        self.assertEqual(mapping['Gamma'], [])

    def test_number_permutation_does_not_change_iq_result(self):
        iq = np.arange(100, dtype=float).reshape(10, 10)
        for source_id in (1, 3, 7):
            mapping = {'WC': [source_id], 'Co': [], 'Gamma': [9]}
            raw = np.full(iq.shape, source_id)
            raw[0] = 9
            phases, _, audit = split_wc_co(iq, raw, mapping, 9)
            self.assertTrue(np.all(phases[0] == 3))
            self.assertEqual(np.sum(phases == 2), int(90 * 0.14798489327456158))
            self.assertAlmostEqual(audit['gamma_percent'], 10)

    def test_ties_and_zero_hundred_co(self):
        iq = np.ones((10, 10))
        mapping = {'WC': [3], 'Co': [], 'Gamma': []}
        for weight, expected in ((0, 0), (100, 100), (9, 14)):
            phases, _, _ = split_wc_co(iq, iq * 3, mapping, weight)
            self.assertEqual(int(np.sum(phases == 2)), expected)

    def test_excluded_sites_are_not_co(self):
        iq = np.arange(12.).reshape(3, 4)
        valid = np.ones(iq.shape, dtype=bool)
        valid[0] = False
        phases, _, audit = split_wc_co(iq, iq * 0 + 3, {'WC': [3], 'Co': [], 'Gamma': []}, 100, valid)
        self.assertTrue(np.all(phases[0] == 0))
        self.assertEqual(audit['co_percent_before_cleanup'], 100)

    def test_corrupt_record_is_masked_without_guessing(self):
        header = '# GRID: SquareGrid\n# XSTEP: 1\n# YSTEP: 1\n# NCOLS_ODD: 2\n# NCOLS_EVEN: 2\n# NROWS: 2\n# Phase 3\n# MaterialName WC\n'
        text = header + '0 0 0 0 0 100 .5 3 1 1\ncorrupt row\n0 0 0 0 1 100 .5 3 1 1\n0 0 0 1 1 100 .5 3 1 1\n'
        table = recover_ang_table(text)
        self.assertEqual(table.shape, (4, 10))
        self.assertEqual(table[1, 6], -1)
        self.assertEqual(table[1, 7], 0)
        self.assertEqual(table[1, 3], 1)

    def test_missing_wc_definition_fails_instead_of_assuming_one(self):
        with self.assertRaisesRegex(ValueError, 'No WC'):
            self.mapping('# Phase 1\n# MaterialName Co\n', [1])


if __name__ == '__main__':
    unittest.main()

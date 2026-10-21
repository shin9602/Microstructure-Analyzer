import os
from pathlib import Path
import tempfile
import unittest

os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(__file__).parent / '.temp_ebsd' / '.numba_cache'))
import numpy as np
from ebsd_phases import load_ebsd, recover_ang_table, resolve_phases, split_wc_co
from osc_to_ang import write_ang


class PhaseTests(unittest.TestCase):
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

    def mapping(self, text, phases):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'sample.ang'
            file.write_text(text, encoding='utf-8')
            return resolve_phases(file, np.asarray(phases))

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

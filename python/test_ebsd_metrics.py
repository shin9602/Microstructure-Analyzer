import unittest
import numpy as np
from ebsd_metrics import contiguity, grain_exclusion_audit, mfp_estimate


class MetricTests(unittest.TestCase):
    def test_wc_gamma_interface_is_external_for_wc_internal_for_hard(self):
        metrics = contiguity(10, 5, 20, 7, 3)
        self.assertAlmostEqual(metrics['C_WC_L'], 20/45)
        self.assertAlmostEqual(metrics['C_H_L'], 66/78)
        self.assertAlmostEqual(metrics['C_WC_A'], 10/35)
        self.assertAlmostEqual(metrics['C_H_A'], 33/45)

    def test_without_gamma_wc_and_hard_are_equal(self):
        metrics = contiguity(10, 5, 0, 0, 0)
        self.assertEqual(metrics['C_WC_L'], metrics['C_H_L'])

    def test_mfp_uses_selected_phase_fraction_and_reports_undefined(self):
        self.assertAlmostEqual(mfp_estimate(2, 10, 80, 0.5), 0.5)
        self.assertAlmostEqual(mfp_estimate(3, 10, 90, 0.5), 2/3)
        self.assertIsNone(mfp_estimate(2, 10, 80, 1))
        self.assertIsNone(mfp_estimate(0, 10, 80, 0.5))

    def test_exclusion_reasons_partition_unassigned_points(self):
        phases = np.array([[1, 1, 1, 1, 3, 3]])
        ci = np.array([[0.05, np.nan, 0.8, 0.8, 0.01, 0.8]])
        seeds = np.array([[-1, -1, 2, 3, -1, 4]])
        final = np.array([[-1, -1, -1, 3, -1, -1]])
        audit = grain_exclusion_audit(phases, ci, seeds, final)
        self.assertEqual(audit['wc_low_ci_points'], 1)
        self.assertEqual(audit['wc_invalid_ci_points'], 1)
        self.assertEqual(audit['wc_singleton_points'], 1)
        self.assertEqual(audit['wc_unassigned_grain_points'], 3)
        self.assertEqual(audit['gamma_unassigned_grain_points'], 2)


if __name__ == '__main__':
    unittest.main()

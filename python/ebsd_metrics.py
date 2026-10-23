"""Phase-specific interface statistics and grain-size-based MFP estimates."""
import numpy as np


def contiguity(n11, n12, n13, n23, n33):
    def ratio(a, b):
        return float(a / b) if b > 0 else 0.0
    result = {}
    for suffix, weight in (('L', 2), ('A', 1)):
        wc, gamma, hard = weight*n11, weight*n33, weight*(n11+n13+n33)
        result.update({f'C_WC_{suffix}': ratio(wc, wc+n12+n13),
                       f'C_G_{suffix}': ratio(gamma, gamma+n23+n13),
                       f'C_H_{suffix}': ratio(hard, hard+n12+n23)})
    return result


def mfp_estimate(diameter, co_points, hard_points, connectivity):
    """d * Vco / [Vphase * (1-C)]; ECD proxy, not a measured chord length."""
    denominator = hard_points * (1-connectivity)
    return float(diameter * co_points / denominator) if diameter > 0 and denominator > 0 else None


def grain_exclusion_audit(phases, ci, seed_ids, final_ids):
    result = {}
    for label, name in ((1, 'wc'), (3, 'gamma')):
        mask = phases == label
        result[f'{name}_low_ci_points'] = int(np.sum(mask & np.isfinite(ci) & (ci < 0.1)))
        result[f'{name}_invalid_ci_points'] = int(np.sum(mask & ~np.isfinite(ci)))
        result[f'{name}_singleton_points'] = int(np.sum(mask & (seed_ids >= 0) & (final_ids < 0)))
        result[f'{name}_unassigned_grain_points'] = int(np.sum(mask & (final_ids < 0)))
    return result

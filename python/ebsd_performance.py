"""Exact operations on the measured subset of a scan."""
import numpy as np


def neighbor_angles(orientations, mask):
    """Skip angle calculations whose endpoints cannot enter any statistic."""
    output = []
    for a, b in ((np.s_[:, :-1], np.s_[:, 1:]),
                 (np.s_[:-1, :], np.s_[1:, :])):
        selected = mask[a] & mask[b]
        angles = np.full(selected.shape, np.nan)
        if selected.any():
            angles[selected] = orientations[a][selected].angle_with(orientations[b][selected])
        output.append(angles)
    return tuple(output)


def remove_edge_grains(labels, kill_zone):
    """Remove all edge grain IDs in one image pass, preserving label values."""
    excluded = np.unique(labels[kill_zone & (labels > 0)])
    if excluded.size:
        labels[np.isin(labels, excluded)] = 0
    return labels

"""Resolve vendor phase IDs before applying the WC/Co IQ model.

Output labels (1=WC, 2=Co, 3=gamma) are internal analysis labels only.
They must never be used to interpret the phase IDs in an input file.
"""
from pathlib import Path
import re
import tempfile
from io import StringIO

import numpy as np
from skimage.filters import threshold_otsu

GAMMA_MODES = ('all_other', 'named')


def validate_gamma_mode(mode):
    if mode not in GAMMA_MODES:
        raise ValueError(f'Unknown gamma analysis mode: {mode}')
    return mode


def load_ebsd(path):
    """Vendor ANG headers may contain legacy single-byte symbols (e.g. µm²).

    Header names/metadata are ASCII for these exports. Normalize only the
    import copy, leaving the original intact and independent of Windows locale.
    """
    from orix import io
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    # Analysis uses the standard first ten ANG columns. Some vendor exports
    # have damaged optional columns; never let these invalidate valid EBSD data.
    file_errors = []
    try:
        data = np.loadtxt(StringIO(text), comments="#", usecols=range(10), ndmin=2)
    except ValueError:
        file_errors.append("숫자로 읽을 수 없는 손상된 데이터 행이 있습니다.")
        data = recover_ang_table(text)
    grid = {key.upper(): value for key, value in re.findall(r"^#\s*(GRID|NCOLS_ODD|NCOLS_EVEN|NROWS)\s*:\s*(\S+)", text, re.M | re.I)}
    if all(key in grid for key in ("GRID", "NCOLS_ODD", "NCOLS_EVEN", "NROWS")):
        ny = int(grid["NROWS"])
        expected = int(grid["NCOLS_ODD"]) * ny
        if grid["GRID"].lower() == "hexgrid":
            expected = int(grid["NCOLS_ODD"]) * ((ny + 1) // 2) + int(grid["NCOLS_EVEN"]) * (ny // 2)
        # Converted OSC scans preserve the exact row lengths. Do not extrapolate
        # the first row or assume every staggered row has identical length.
        row_counts_match = re.search(r"^#\s*GRID_ROW_COUNTS\s*:\s*([^\r\n]+)", text, re.M | re.I)
        if row_counts_match and text.startswith("# Converted from EDAX/TSL .osc"):
            counts = [int(count) for count in row_counts_match[1].split()]
            if len(counts) != ny or any(count <= 0 for count in counts):
                raise ValueError("Invalid converted OSC row-count metadata")
            expected = sum(counts)
        if len(data) != expected:
            file_errors.append(f"헤더의 예상 측정점 {expected:,}개와 실제 데이터 {len(data):,}개가 다릅니다.")
            data = recover_ang_table(text)
    if not file_errors and any(re.search(r"[^0-9eE+\-.\s]", line) for line in text.split("\n") if line.strip() and not line.lstrip().startswith("#")):
        file_errors.append("데이터 열에 손상되거나 해석할 수 없는 문자가 있습니다.")
    header = "\n".join(line.rstrip("\r") for line in text.split("\n") if line.lstrip().startswith("#"))
    with tempfile.TemporaryDirectory(prefix="ebsd_import_") as folder:
        normalized = Path(folder) / "input.ang"
        np.savetxt(normalized, data, header=header.encode("ascii", errors="replace").decode("ascii"), comments="", fmt="%.10g")
        xmap = io.load(normalized)
    xmap._file_integrity = {"has_errors": bool(file_errors), "details": file_errors}
    if data.shape[1] < 8 or data.shape[0] != xmap.size:
        raise ValueError("ANG table size/columns do not match the orientation map")
    match = re.search(r"^#\s*XSTEP\s*:\s*(\S+)", text, re.M | re.I)
    if not match or float(match[1]) <= 0:
        raise ValueError("ANG XSTEP is missing or invalid")
    return xmap, data, float(match[1])


def recover_ang_table(text):
    """Place valid records by scan coordinates; keep damaged/missing sites masked.

    Never repair a damaged Euler angle or phase by guessing its numeric value.
    Recovery is restricted to exports with a complete regular-grid header.
    """
    def field(key):
        match = re.search(r"^#\s*" + key + r"\s*:\s*(\S+)", text, re.M | re.I)
        if not match:
            raise ValueError(f"Damaged ANG table: missing grid field {key}")
        return match[1]
    nx1, nx2, ny = int(field("NCOLS_ODD")), int(field("NCOLS_EVEN")), int(field("NROWS"))
    dx, dy = float(field("XSTEP")), float(field("YSTEP"))
    hexagonal = field("GRID").lower() == "hexgrid"
    lengths = np.array([nx1 if not hexagonal or row % 2 == 0 else nx2 for row in range(ny)])
    if dx <= 0 or dy <= 0 or ny <= 0 or np.any(lengths <= 0) or lengths.sum() > 20_000_000:
        raise ValueError("Invalid grid in damaged ANG file")
    parsed = []
    skipped = 0
    for line in text.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        tokens = line.split()
        try:
            values = [float(token) for token in tokens[:10]]
            if len(values) != 10:
                raise ValueError()
            parsed.append(values)
        except ValueError:
            skipped += 1
    if not parsed:
        raise ValueError("No valid numeric records in ANG")
    source = np.asarray(parsed)
    # Determine the unrounded Y spacing from the intact start of the scan.
    first_y = np.unique(source[:min(10000, len(source)), 4])
    differences = np.diff(first_y)
    nearby = differences[np.abs(differences - dy) < dy * 0.01]
    if nearby.size:
        dy = float(np.median(nearby))
        if hexagonal and abs(dy - dx * np.sqrt(3) / 2) < dx * 0.001:
            dy = dx * np.sqrt(3) / 2
    offsets = np.concatenate(([0], np.cumsum(lengths)))
    data = np.zeros((int(offsets[-1]), 10))
    rows = np.repeat(np.arange(ny), lengths)
    columns = np.arange(len(data)) - np.repeat(offsets[:-1], lengths)
    data[:, 3] = (columns + (rows % 2) * 0.5 * hexagonal) * dx
    data[:, 4] = rows * dy
    data[:, 5:7] = -1
    data[:, 9] = 180
    finite = np.all(np.isfinite(source), axis=1)
    source = source[finite]
    row = np.rint(source[:, 4] / dy).astype(int)
    col = np.rint(source[:, 3] / dx - (row % 2) * 0.5 * hexagonal).astype(int)
    valid = (row >= 0) & (row < ny) & (col >= 0)
    safe_row = np.clip(row, 0, ny - 1)
    valid &= col < lengths[safe_row]
    valid &= np.abs(source[:, 4] - row * dy) < dy * 0.05
    valid &= np.abs(source[:, 3] - (col + (row % 2) * 0.5 * hexagonal) * dx) < dx * 0.05
    valid &= np.all((source[:, :3] >= 0) & (source[:, :3] <= 2 * np.pi + 1e-4), axis=1)
    valid &= source[:, 1] <= np.pi + 1e-4
    valid &= (source[:, 6] >= -1) & (source[:, 6] <= 1)
    valid &= (source[:, 5] >= -1) & (source[:, 9] >= 0) & (source[:, 9] <= 180)
    valid &= (source[:, 7] >= 0) & (source[:, 7] <= 100) & (source[:, 7] == np.rint(source[:, 7]))
    declared_ids = [int(value) for value in re.findall(r"^#\s*Phase\s+(\d+)", text, re.M | re.I)]
    valid &= np.isin(source[:, 7], [0, *declared_ids])
    indices = offsets[safe_row[valid]] + col[valid]
    unique, first, counts = np.unique(indices, return_index=True, return_counts=True)
    # Conflicting duplicates are excluded, rather than selecting an arbitrary solution.
    keep = counts == 1
    data[unique[keep]] = source[valid][first[keep]]
    missing = int(np.sum((data[:, 5] == -1) & (data[:, 6] == -1)))
    print(f"Warning: ANG recovery: {skipped} malformed lines; {missing}/{len(data)} missing or invalid grid sites excluded. Original file unchanged.", flush=True)
    return data


def read_phase_definitions(path):
    definitions = {}
    current = None
    with Path(path).open(encoding="utf-8-sig", errors="replace") as stream:
        for line in stream:
            if not line.strip():
                continue
            if not line.lstrip().startswith("#"):
                break
            text = line.lstrip()[1:].strip()
            match = re.fullmatch(r"Phase\s+(\d+)", text, re.I)
            if match:
                current = definitions.setdefault(int(match[1]), {})
            elif current is not None:
                for key in ("MaterialName", "Formula", "Symmetry", "LatticeConstants"):
                    if re.match(re.escape(key) + r"\s", text, re.I):
                        current[key] = text[len(key):].strip()
    return definitions


def phase_role(definition):
    name = definition.get("MaterialName", "").lower()
    formula = re.sub(r"[\s_()\-,]", "", definition.get("Formula", "").lower())
    # Vendor material names may append mineral names or descriptive text.
    base_name = re.split(r"[\(\[]", name, maxsplit=1)[0]
    compact = re.sub(r"[\s_()\-,]", "", base_name)
    if compact in ("wc", "tungstencarbide", "tungstenmonocarbide") or formula == "wc":
        return "WC"
    if re.match(r"^(co\b|cobalt\b)", name) or formula == "co":
        return "Co"
    # Only explicit gamma labels / named cubic hard carbides are accepted.
    # A cubic structure alone is not evidence for gamma (e.g. beta-Co).
    if re.search(r"gamma|γ|감마", name) or compact in ("tic", "tac", "nbc", "vc", "titaniumcarbide", "tantalumcarbide", "niobiumcarbide", "vanadiumcarbide") or formula in ("tic", "tac", "nbc", "vc"):
        return "Gamma"
    return None


def clean_phase_map(phases, grain_ids, valid_scan_mask):
    """Remove isolated grain seeds without inventing orientations in CI gaps.

    Phase assignment and orientation confidence are separate. A phase may be
    recorded even when no reliable grain can be reconstructed there. Never
    extend grain IDs by Euclidean distance: that creates Voronoi boundaries
    unrelated to measured misorientation, including across phase interfaces.
    """
    labels, counts = np.unique(grain_ids, return_counts=True)
    retained = labels[(labels >= 0) & (counts >= 2)]
    reliable = np.isin(grain_ids, retained)
    output_phases, output_ids = phases.copy(), grain_ids.copy()
    output_ids[~reliable] = -1
    output_phases[~valid_scan_mask] = 0
    output_ids[~valid_scan_mask] = -1
    return output_phases, output_ids


def measured_boundaries(phases, grain_ids, valid_scan_mask):
    """Count interfaces only where both endpoints have a resolved grain.

    Binder does not need crystallographic orientation. Missing hard-phase
    orientations are unknown, not grains or boundaries around holes.
    """
    known = valid_scan_mask & ((grain_ids >= 0) | (phases == 2))
    result = []
    for a, b in ((np.s_[:, :-1], np.s_[:, 1:]),
                 (np.s_[:-1, :], np.s_[1:, :])):
        boundary = (grain_ids[a] != grain_ids[b]) | (phases[a] != phases[b])
        boundary &= known[a] & known[b]
        boundary &= ~((phases[a] == 2) & (phases[b] == 2))
        result.append(boundary)
    return tuple(result)


def source_ipf_map(xmap, rotations, source_phases, valid_scan_mask, mapping=None, gamma_mode='all_other'):
    """Color source orientations with the selected phase/symmetry model.

    Includes low-CI indexed points for inspection; never used to reconstruct
    grains. Default gamma uses one cubic model; legacy mode uses source
    symmetries. IQ-derived WC/Co labels never choose crystal symmetry.
    """
    from orix.quaternion import Orientation
    from orix.vector import Vector3d
    from orix.plot import IPFColorKeyTSL
    from orix.quaternion import symmetry
    validate_gamma_mode(gamma_mode)
    image = np.ones(source_phases.shape + (3,), dtype=float)
    metadata = []
    for phase_id in np.unique(source_phases[valid_scan_mask]):
        if phase_id <= 0:
            continue
        mask = valid_scan_mask & (source_phases == phase_id)
        phase = xmap.phases[int(phase_id)]
        group = phase.point_group
        if mapping is not None and gamma_mode == 'all_other' and phase_id in mapping['Gamma']:
            group = symmetry.O
        if group is None:
            image[mask] = .82
        else:
            key = IPFColorKeyTSL(group, direction=Vector3d.zvector())
            image[mask] = key.orientation2color(Orientation(rotations[mask], symmetry=group))
        metadata.append({'source_phase_id': int(phase_id), 'material': phase.name,
                         'point_group': group.name if group is not None else 'unavailable',
                         'points': int(mask.sum()), 'colored': group is not None})
    return image, metadata


def resolve_phases(path, raw_phases, gamma_mode='all_other'):
    validate_gamma_mode(gamma_mode)
    definitions = read_phase_definitions(path)
    roles = {pid: phase_role(value) for pid, value in definitions.items()}
    active = {int(pid) for pid in np.unique(raw_phases) if pid > 0}
    if gamma_mode == 'all_other':
        # All non-WC definitions are provisional gamma, including FCC/HCP Co.
        # Valid unindexed sites also enter the non-WC IQ pool in split_wc_co.
        for pid in active | set(definitions):
            if pid > 0 and roles.get(pid) != 'WC':
                roles[pid] = 'Gamma'
    unknown = [pid for pid in sorted(active) if roles.get(pid) is None]
    if unknown:
        details = ", ".join(f"{pid}: {definitions.get(pid, {}).get('MaterialName', 'missing phase definition')}" for pid in unknown)
        print(f"Warning: Other source phases ({details}) participate in the WC/Co IQ model; they are not assumed to be gamma.", flush=True)
    wc_ids = [pid for pid, role in roles.items() if role == "WC"]
    if not wc_ids:
        raise ValueError("No WC material definition found. Phase 1 is not assumed to be WC.")
    for pid in wc_ids:
        definition = definitions[pid]
        if "Symmetry" in definition and definition["Symmetry"] not in ("62", "6", "6/mmm", "622", "-6m2"):
            raise ValueError(f"WC phase {pid} has incompatible symmetry: {definition['Symmetry']}")
    mapping = {role: [pid for pid, value in roles.items() if value == role] for role in ("WC", "Co", "Gamma")}
    mapping["Other"] = unknown
    for pid in sorted(definitions):
        print(f"- Phase {pid}: {definitions[pid].get('MaterialName', '?')} -> {roles[pid] or ('Other / IQ model' if pid in active else 'not present')}", flush=True)
    return mapping


def split_wc_co(iq, raw_phases, mapping, co_wt=None, valid_mask=None, gamma_mode='all_other'):
    """Default: preserve source WC, split non-WC into Co/gamma by IQ.

    Named mode retains the historical gamma-first WC/Co split.
    """
    validate_gamma_mode(gamma_mode)
    iq = np.asarray(iq)
    valid = np.ones(iq.shape, dtype=bool) if valid_mask is None else np.asarray(valid_mask, dtype=bool)
    valid = valid & (iq >= 0)
    wc_first = gamma_mode == 'all_other'
    gamma = np.isin(raw_phases, mapping["Gamma"]) & valid
    wc = np.isin(raw_phases, mapping['WC']) & valid
    candidate = (~wc if wc_first else ~gamma) & valid
    values = iq[candidate]
    if not np.all(np.isfinite(values)):
        raise ValueError("Non-finite IQ values in WC/Co region")
    composition = co_wt is not None and co_wt != -1
    ratio = None
    if composition:
        if not np.isfinite(co_wt) or not 0 <= co_wt <= 100:
            raise ValueError("Co wt% must be between 0 and 100")
        co_volume = co_wt / 8.9
        wc_volume = (100.0 - co_wt) / 15.63
        ratio = co_volume / (co_volume + wc_volume)
    phases = np.zeros(iq.shape, dtype=np.int32)
    if wc_first:
        phases[wc] = 1
        phases[candidate] = 3
    else:
        phases[gamma] = 3
        phases[candidate] = 1
    requested_count = int(np.sum(valid) * ratio) if composition and wc_first else None
    if requested_count is not None and requested_count > values.size:
        raise ValueError('입력한 Co 함량을 배정하기에 WC 외 영역이 부족합니다. Co 함량과 원본 WC 인식을 확인하세요.')
    if not values.size:
        threshold = None
    elif composition:
        # Rank by IQ to meet the target even when many pixels share an IQ.
        # Stable ordering makes ties reproducible within the selected IQ pool.
        count = requested_count if wc_first else int(values.size * ratio)
        order = np.argsort(values, kind="stable")
        indices = np.flatnonzero(candidate)
        phases.ravel()[indices[order[:count]]] = 2
        threshold = float(values[order[count - 1]]) if count else float(np.nextafter(values.min(), -np.inf))
    else:
        threshold = float(threshold_otsu(values))
        phases[candidate & (iq <= threshold)] = 2
    audit = {
        'gamma_mode': gamma_mode,
        'classification_order': 'WC -> non-WC IQ Co -> remaining gamma' if wc_first else 'Named gamma -> remaining IQ WC/Co',
        'gamma_symmetry_model': 'Unified FCC (432), original orientations' if gamma_mode == 'all_other' else 'Original source phases and symmetries',
        "source_phase_ids": mapping,
        "method": "Co wt% + IQ ranking" if composition else "IQ Otsu",
        "co_wt_percent": co_wt if composition else None,
        "co_target_percent_of_non_gamma": ratio * 100 if ratio is not None and not wc_first else None,
        "co_target_percent_of_total": ratio * 100 if ratio is not None and wc_first else None,
        "iq_threshold": threshold,
        "wc_percent_before_cleanup": float(np.mean(phases == 1) * 100),
        "co_percent_before_cleanup": float(np.mean(phases == 2) * 100),
        "gamma_percent": float(np.mean(gamma) * 100),
        "excluded_points": int(np.sum(phases == 0)),
    }
    included = max(1, int(np.sum(phases != 0)))
    audit["wc_percent_before_cleanup"] = float(np.sum(phases == 1) / included * 100)
    audit["co_percent_before_cleanup"] = float(np.sum(phases == 2) / included * 100)
    audit["gamma_percent"] = float(np.sum(phases == 3) / included * 100)
    print(f"- IQ split: {audit}", flush=True)
    return phases, threshold, audit


def analysis_symmetry(xmap, mapping, internal_id, gamma_mode='all_other'):
    validate_gamma_mode(gamma_mode)
    if int(internal_id) == 3 and gamma_mode == 'all_other':
        from orix.quaternion import symmetry
        return symmetry.O
    # Co components ignore orientation. WC/gamma must use their source IDs.
    role = {1: "WC", 2: "Co", 3: "Gamma"}[int(internal_id)]
    ids = mapping[role] if role != "Co" else mapping["WC"]
    if not ids:
        ids = mapping["WC"]
    groups = [xmap.phases[pid].point_group for pid in ids]
    if any(group is None for group in groups):
        raise ValueError(f"Missing crystal symmetry for {role}")
    if any(group.name != groups[0].name for group in groups[1:]):
        raise ValueError(f"Multiple incompatible symmetries for {role}")
    return groups[0]


def grain_neighbor_connections(orientations, mask, source_phases, separate_sources):
    """Connect adjacent measured orientations within 5 degrees.

    A unified gamma grain may cross TiC/NbC source labels. Legacy mode keeps
    source phase interfaces even when orientations are otherwise continuous.
    """
    angle_right = orientations[:, :-1].angle_with(orientations[:, 1:])
    angle_bottom = orientations[:-1, :].angle_with(orientations[1:, :])
    right = mask[:, :-1] & mask[:, 1:] & (angle_right <= np.deg2rad(5.0))
    bottom = mask[:-1, :] & mask[1:, :] & (angle_bottom <= np.deg2rad(5.0))
    if separate_sources:
        right &= source_phases[:, :-1] == source_phases[:, 1:]
        bottom &= source_phases[:-1, :] == source_phases[1:, :]
    return right, bottom

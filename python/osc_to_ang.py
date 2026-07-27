"""
EDAX/TSL .osc → .ang converter.

Port of MTEX interfaces/loadEBSD_osc.m :: oscData (AnyStitch / Adam Shiveley & Florian Bachmann).
BSD heritage from AnyStitch (USAF Research Laboratory).
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

import numpy as np

# Marker after which scan floats begin (TSL OIM)
_START_BYTES = bytes([0xB9, 0x0B, 0xEF, 0xFF, 0x02, 0x00, 0x00, 0x00])
_HEADER_START = bytes([0xB9, 0x0B, 0xEF, 0xFF, 0x01, 0x00, 0x00, 0x00])


def _find_pattern(buf: bytes, pattern: bytes) -> int:
    idx = buf.find(pattern)
    if idx < 0:
        raise ValueError(f"OSC marker not found: {pattern.hex()}")
    return idx


def read_osc_table(path: str | Path) -> tuple[np.ndarray, float, float, dict]:
    """
    Returns
    -------
    data : (N, ncols) float64
        Columns like ANG: phi1, Phi, phi2, x, y, IQ, CI, Phase, SemSignal, Fit [, extras...]
        Euler angles in **radians**.
    xstep, ystep : float
    meta : dict with n_points, ncols, nx/ny guess
    """
    path = Path(path)
    raw = path.read_bytes()
    if len(raw) < 64:
        raise ValueError("File too small to be a valid .osc")

    header_u32 = struct.unpack_from("<8I", raw, 0)
    n = int(header_u32[6])  # number of points
    if n <= 0:
        raise ValueError(f"Invalid point count in OSC header: {n}")

    # Search first ~1 MiB for data marker (matches MTEX)
    probe = raw[: min(len(raw), 1 << 20)]
    start_pos = _find_pattern(probe, _START_BYTES)

    # After marker+8: optional count, then Xstep/Ystep
    pos = start_pos + 8
    dn = struct.unpack_from("<I", raw, pos)[0]
    # MTEX: if dn does not look like a float-count for ~10 cols, rewind
    if n == 0 or round(((dn / 4 - 2) / 10) / n) != 1:
        # proceed from start_pos+8 without consuming dn as count
        pass
    else:
        pos += 4

    xstep = struct.unpack_from("<f", raw, pos)[0]
    pos += 4
    if xstep == 0.0:
        xstep = struct.unpack_from("<f", raw, pos)[0]
        pos += 4
        ystep = struct.unpack_from("<f", raw, pos)[0]
        pos += 4
    else:
        ystep = struct.unpack_from("<f", raw, pos)[0]
        pos += 4

    # Guess column count 5..30 by spatial step consistency (MTEX heuristic)
    data_start = pos
    chosen = None
    for ncols in range(5, 31):
        nbytes = n * ncols * 4
        if data_start + nbytes > len(raw):
            continue
        floats = np.frombuffer(raw, dtype="<f4", count=n * ncols, offset=data_start).reshape(n, ncols)
        # row1 (0-based index 1): x ≈ xstep, y ≈ 0 for first raster step — MTEX checks row index 2 in MATLAB (1-based)
        if floats.shape[0] < 2:
            continue
        if round(float(floats[1, 3]), 4) == round(float(xstep), 4) and round(float(floats[1, 4]), 4) == 0.0:
            chosen = floats.astype(np.float64)
            break

    if chosen is None:
        # Fallback: classic 10-column layout
        ncols = 10
        nbytes = n * ncols * 4
        if data_start + nbytes > len(raw):
            raise ValueError("Could not determine OSC column layout (unsupported OIM version?)")
        chosen = np.frombuffer(raw, dtype="<f4", count=n * ncols, offset=data_start).reshape(n, ncols).astype(
            np.float64
        )

    meta = {
        "n_points": n,
        "ncols": chosen.shape[1],
        "header_u32": header_u32,
        "xstep": float(xstep),
        "ystep": float(ystep),
    }
    # rough grid estimate
    if xstep > 0:
        xs = chosen[:, 3]
        ys = chosen[:, 4]
        meta["x_range"] = (float(xs.min()), float(xs.max()))
        meta["y_range"] = (float(ys.min()), float(ys.max()))
        meta["ncols_est"] = int(round((xs.max() - xs.min()) / xstep)) + 1 if xstep else 0
        meta["nrows_est"] = int(round((ys.max() - ys.min()) / ystep)) + 1 if ystep else 0

    return chosen, float(xstep), float(ystep), meta


def _guess_phases(data: np.ndarray) -> list[dict]:
    if data.shape[1] < 8:
        return [{"id": 1, "name": "Unknown", "symmetry": 43, "lattice": (1.0, 1.0, 1.0, 90.0, 90.0, 90.0)}]
    phases = sorted({int(round(p)) for p in data[:, 7] if int(round(p)) > 0})
    if not phases:
        return [{"id": 1, "name": "Unknown", "symmetry": 43, "lattice": (1.0, 1.0, 1.0, 90.0, 90.0, 90.0)}]
    return [
        {"id": p, "name": f"Phase{p}", "symmetry": 43, "lattice": (1.0, 1.0, 1.0, 90.0, 90.0, 90.0)}
        for p in phases
    ]


def read_osc_phases(path: str | Path) -> list[dict]:
    """
    Parse phase materials from OSC binary header (MTEX oscHeader layout).
    Returns list of {id, name, symmetry, lattice} with 1-based ids in header order.
    """
    path = Path(path)
    raw = path.read_bytes()
    hs = raw.find(_HEADER_START)
    he = raw.find(_START_BYTES)
    if hs < 0 or he < 0 or he <= hs:
        return []
    header = raw[hs + 8 : he]
    out: list[dict] = []
    i = 0
    while i < len(header) - 288:
        if not (32 <= header[i] < 127):
            i += 1
            continue
        end = header.find(b"\x00", i)
        if end < 0 or not (3 <= end - i <= 80):
            i += 1
            continue
        name_b = header[i:end]
        if not all(32 <= b < 127 for b in name_b):
            i += 1
            continue
        if not any((65 <= b <= 90) or (97 <= b <= 122) for b in name_b):
            i += 1
            continue
        laue = struct.unpack_from("<i", header, i + 256)[0]
        if laue not in (1, 2, 3, 6, 20, 32, 43, 45, 62, 126, 131):
            i += 1
            continue
        ax = struct.unpack_from("<3f", header, i + 260)
        ang = struct.unpack_from("<3f", header, i + 272)
        nh = struct.unpack_from("<i", header, i + 284)[0]
        if not (0 <= nh < 200 and all(0.5 < a < 30 for a in ax) and all(50.0 < a < 150.0 for a in ang)):
            i += 1
            continue
        # skip formula-only stubs (e.g. Al2O3 after Alumina) with empty lattice parse
        name = name_b.decode("ascii")
        out.append(
            {
                "id": len(out) + 1,
                "name": name,
                "symmetry": int(laue),
                "lattice": (
                    float(ax[0]),
                    float(ax[1]),
                    float(ax[2]),
                    float(ang[0]),
                    float(ang[1]),
                    float(ang[2]),
                ),
            }
        )
        i = max(end + 1, i + 288)
    return out


def write_ang(
    out_path: str | Path,
    data: np.ndarray,
    xstep: float,
    ystep: float,
    *,
    phases: list[dict] | list[tuple[int, str]] | None = None,
    grid: str | None = None,
) -> None:
    """Write TSL-style .ang that mtex_hex / OIM can read."""
    out_path = Path(out_path)
    if phases is None:
        phases = _guess_phases(data)
    # normalize legacy (id, name) tuples
    norm: list[dict] = []
    for p in phases:
        if isinstance(p, dict):
            norm.append(p)
        else:
            pid, name = p
            norm.append({"id": int(pid), "name": str(name), "symmetry": 43, "lattice": (1.0, 1.0, 1.0, 90.0, 90.0, 90.0)})
    phases = norm

    if grid is None:
        grid = "HexGrid" if abs(xstep - ystep) > 1e-6 * max(xstep, ystep, 1e-12) else "SquareGrid"

    xs, ys = data[:, 3], data[:, 4]
    ncols_odd = int(round((xs.max() - xs.min()) / xstep)) + 1 if xstep else 0
    nrows = int(round((ys.max() - ys.min()) / ystep)) + 1 if ystep else 0

    lines: list[str] = [
        "# Converted from EDAX/TSL .osc (osc_to_ang.py / MTEX oscData port)",
        f"# TEM_PIXperUM            1.000000",
        f"# x-star                  0.000000",
        f"# y-star                  0.000000",
        f"# z-star                  0.000000",
        f"# WorkingDistance         0.000000",
        "#",
    ]
    for ph in phases:
        lat = ph.get("lattice", (1.0, 1.0, 1.0, 90.0, 90.0, 90.0))
        lines += [
            f"# Phase {int(ph['id'])}",
            f"# MaterialName      {ph['name']}",
            f"# Formula           ",
            f"# Info",
            f"# Symmetry          {int(ph.get('symmetry', 43))}",
            f"# LatticeConstants  {lat[0]:.3f} {lat[1]:.3f} {lat[2]:.3f} {lat[3]:.3f} {lat[4]:.3f} {lat[5]:.3f}",
            f"# NumberFamilies    0",
            "#",
        ]
    lines += [
        f"# GRID: {grid}",
        f"# XSTEP: {xstep:.6f}",
        f"# YSTEP: {ystep:.6f}",
        f"# NCOLS_ODD: {ncols_odd}",
        f"# NCOLS_EVEN: {max(ncols_odd - 1, 0)}",
        f"# NROWS: {nrows}",
        "#",
        "# OPERATOR:      ",
        "# SAMPLEID:      ",
        "# SCANID:        ",
        "#",
    ]

    ncols = data.shape[1]
    # Ensure at least 10 columns for classic ANG consumers
    if ncols < 10:
        pad = np.zeros((data.shape[0], 10 - ncols), dtype=np.float64)
        table = np.hstack([data, pad])
    else:
        table = data[:, :10]

    # Degrees for file (TSL .ang stores degrees)
    deg = np.rad2deg(table[:, 0:3])

    with out_path.open("w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
        for i in range(table.shape[0]):
            phi1, Phi, phi2 = deg[i]
            x, y = table[i, 3], table[i, 4]
            iq = table[i, 5] if table.shape[1] > 5 else 0.0
            ci = table[i, 6] if table.shape[1] > 6 else 0.0
            phase = int(round(table[i, 7])) if table.shape[1] > 7 else 1
            sem = int(round(table[i, 8])) if table.shape[1] > 8 else 0
            fit = table[i, 9] if table.shape[1] > 9 else 0.0
            f.write(
                f"{phi1:9.5f} {Phi:9.5f} {phi2:9.5f} {x:12.5f} {y:12.5f} "
                f"{iq:6.1f} {ci:6.3f} {phase:2d} {sem:2d} {fit:7.3f}\n"
            )


def convert_osc_to_ang(osc_path: str | Path, ang_path: str | Path | None = None) -> Path:
    osc_path = Path(osc_path)
    if ang_path is None:
        ang_path = osc_path.with_suffix(".ang")
    else:
        ang_path = Path(ang_path)

    data, xstep, ystep, meta = read_osc_table(osc_path)
    header_phases = read_osc_phases(osc_path)
    # Prefer OSC header materials; fall back to phase ids present in the table
    phases = header_phases if header_phases else _guess_phases(data)
    write_ang(ang_path, data, xstep, ystep, phases=phases)
    meta["phases"] = phases
    names = ", ".join(f"{p['id']}:{p['name']}" for p in phases) if phases else "n/a"
    print(
        f"OK {osc_path.name} -> {ang_path.name}  "
        f"n={meta['n_points']} cols={meta['ncols']} "
        f"step=({xstep:.4f},{ystep:.4f}) "
        f"grid~{meta.get('ncols_est')}x{meta.get('nrows_est')}  "
        f"phases=[{names}]"
    )
    return ang_path


def main():
    ap = argparse.ArgumentParser(description="Convert EDAX/TSL .osc → .ang")
    ap.add_argument("osc", help=".osc file")
    ap.add_argument("-o", "--output", default=None, help="output .ang path")
    args = ap.parse_args()
    try:
        convert_osc_to_ang(args.osc, args.output)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

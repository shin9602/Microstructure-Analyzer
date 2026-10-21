"""Prepare an exact-grid IQ reference for the local eta selection editor."""
from pathlib import Path
import argparse
import hashlib
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--results-root', required=True)
    args = parser.parse_args()
    import numpy as np
    from ebsd_phases import load_ebsd
    from ebsd_regions import square_grid
    from osc_to_ang import convert_osc_to_ang
    source, output = Path(args.input), Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with source.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(block)
    digest = hasher.hexdigest()
    analysis = convert_osc_to_ang(source, output / 'reference.ang') if source.suffix.lower() == '.osc' else source
    xmap, table, step = load_ebsd(analysis)
    iq, _, _ = square_grid(xmap, table, step)
    if iq.size > 20_000_000 or max(iq.shape) > 16384:
        raise ValueError('영역 편집은 최대 2,000만 격자점까지 지원합니다.')
    valid = np.isfinite(iq) & (iq >= 0)
    if not valid.any():
        raise ValueError('IQ가 유효한 측정점이 없습니다.')
    low, high = np.percentile(iq[valid], [1, 99])
    if high <= low:
        high = low + 1
    iq.astype('<f4').tofile(output / 'iq.f32')
    valid.astype(np.uint8).tofile(output / 'valid.bin')
    result_root = Path(args.results_root)
    descriptor = {'width': int(iq.shape[1]), 'height': int(iq.shape[0]),
                  'step_um': step, 'low': float(low), 'high': float(high),
                  'source_sha256': digest,
                  'iq': (output / 'iq.f32').relative_to(result_root).as_posix(),
                  'valid': (output / 'valid.bin').relative_to(result_root).as_posix()}
    # The large conversion copy is not needed after its grid reference is saved.
    if analysis != source:
        analysis.unlink()
    print('PREVIEW_DATA:' + json.dumps(descriptor), flush=True)


if __name__ == '__main__':
    main()

"""Run numerical smoke checks on every vendor file without generating bulk exports.

This is a validation utility, not a replacement for the application export path.
"""
import argparse
import json
import os
from pathlib import Path
import sys
from time import perf_counter
import traceback

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
os.environ.setdefault('MPLBACKEND', 'Agg')
os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(__file__).parent / '.temp_ebsd' / '.numba_cache'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--co-wt', type=float, default=7.5)
    args = parser.parse_args()
    import numpy as np
    import microstructure_analysis as basic
    from osc_to_ang import convert_osc_to_ang
    from ebsd_phases import load_ebsd
    from orix.quaternion import Orientation

    root, output = Path(args.source), Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    # Avoid hundreds of MB of redundant QA exports per sample. Numerical code,
    # phase assignment, segmentation, boundaries and MFP are all unchanged.
    basic.export_iq_map = lambda *a, **k: None
    basic.export_histogram = lambda *a, **k: None
    basic.plt.savefig = lambda *a, **k: None
    original_connections = basic.grain_neighbor_connections
    checked_pairs = [0]

    def checked_connections(orientations, mask, sources, separate_sources):
        actual = original_connections(orientations, mask, sources, separate_sources)
        for a, b, connected in ((np.s_[:, :-1], np.s_[:, 1:], actual[0]),
                                (np.s_[:-1, :], np.s_[1:, :], actual[1])):
            candidates = np.flatnonzero((mask[a] & mask[b]).ravel())
            if candidates.size:
                # Independent direct reference over up to 2048 real neighbor
                # pairs per direction/phase, evenly spanning the whole map.
                selected = candidates[np.linspace(0, candidates.size-1, min(2048, candidates.size), dtype=int)]
                qa = orientations[a].data.reshape(-1, 4)[selected]
                qb = orientations[b].data.reshape(-1, 4)[selected]
                reference = Orientation(qa, symmetry=orientations.symmetry).angle_with(
                    Orientation(qb, symmetry=orientations.symmetry)) <= np.deg2rad(5)
                if separate_sources:
                    reference &= sources[a].ravel()[selected] == sources[b].ravel()[selected]
                np.testing.assert_array_equal(connected.ravel()[selected], reference)
                checked_pairs[0] += len(selected)
        return actual

    basic.grain_neighbor_connections = checked_connections
    records = []
    files = sorted(p for p in root.rglob('*') if p.suffix.lower() in ('.osc', '.ang'))
    native_ang = {p.with_suffix('').as_posix().lower() for p in files if p.suffix.lower() == '.ang'}
    files = [p for p in files if p.suffix.lower() != '.osc' or p.with_suffix('').as_posix().lower() not in native_ang]
    for index, source in enumerate(files, 1):
        started = perf_counter()
        record = {'source': str(source), 'co_wt': args.co_wt, 'status': 'error'}
        converted = output / 'current_scan.ang'
        try:
            print(f'VALIDATING {index}/{len(files)} {source}', flush=True)
            analysis = convert_osc_to_ang(source, converted) if source.suffix.lower() == '.osc' else source
            loaded = load_ebsd(str(analysis))
            previous_pairs = checked_pairs[0]
            result = basic.process_combined_microstructure(str(analysis), str(output), args.co_wt, loaded_data=loaded)
            if result is None:
                raise ValueError('Basic analysis returned no result')
            audit = result['PhaseAudit']
            for phase in ('wc', 'gamma'):
                assert audit[f'{phase}_unassigned_grain_points'] == sum(
                    audit[f'{phase}_{reason}_points'] for reason in ('low_ci', 'invalid_ci', 'singleton'))
            assert abs(sum(result[k] for k in ('WC_Vol', 'Co_Vol', 'G_Vol')) - 100) < 1e-7
            assert all(0 <= result[k] <= 1 for k in ('C_WC_L', 'C_H_L', 'C_WC_A', 'C_H_A'))
            assert all(result[k] is None or np.isfinite(result[k]) and result[k] >= 0
                       for k in ('MFP_WC_L', 'MFP_H_L', 'MFP_WC_A', 'MFP_H_A'))
            record.update(status='passed', result=result, reference_neighbor_pairs=checked_pairs[0]-previous_pairs)
            del loaded, result
        except Exception as error:
            record.update(error=str(error), traceback=traceback.format_exc())
            print(record['traceback'], flush=True)
        finally:
            basic.plt.close('all')
            # Only the known conversion copy created inside this output folder.
            if converted.exists():
                converted.unlink()
        record['seconds'] = perf_counter()-started
        records.append(record)
        report = {'mode': 'numerical validation without bulk exports', 'co_wt': args.co_wt,
                  'total': len(files), 'completed': len(records),
                  'passed': sum(r['status'] == 'passed' for r in records), 'records': records}
        (output / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, default=float), encoding='utf-8')
        print(f"VALIDATED {index}/{len(files)} {record['status']} {record['seconds']:.2f}s", flush=True)
    return int(any(r['status'] != 'passed' for r in records))


if __name__ == '__main__':
    sys.exit(main())

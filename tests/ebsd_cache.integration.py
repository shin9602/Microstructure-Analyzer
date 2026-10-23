"""Exercise cache reuse, renamed duplicates and force-recompute via the real CLI."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from time import perf_counter

workspace = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='ebsd_저장 검증_') as folder:
    root = Path(folder); inputs = root/'inputs'; inputs.mkdir()
    source = inputs/'original.ang'
    header = '# Phase 1\n# MaterialName WC\n# Symmetry 62\n# LatticeConstants 2.906 2.906 2.838 90 90 120\n'
    header += '# GRID: SquareGrid\n# XSTEP: 0.1\n# YSTEP: 0.1\n# NCOLS_ODD: 40\n# NCOLS_EVEN: 40\n# NROWS: 40\n'
    with source.open('w', encoding='utf-8') as stream:
        stream.write(header)
        for row in range(40):
            for col in range(40):
                stream.write(f'{0 if col < 20 else 0.3} 0 0 {col/10:.1f} {row/10:.1f} {100+col} .9 1 1 1\n')
    def run(*extra):
        started = perf_counter()
        proc = subprocess.run([sys.executable, '-X', 'utf8', str(workspace/'python/run_ebsd.py'),
                               '--uploaded', str(inputs), '--output', str(root/'results'),
                               '--cache-dir', str(root/'cache'), '--co-wt', '7.5', *extra],
                              capture_output=True, text=True, encoding='utf-8', cwd=workspace)
        assert proc.returncode == 0, (proc.stdout+proc.stderr)[-5000:]
        events = [json.loads(line[10:]) for line in proc.stdout.splitlines() if line.startswith('JSON_DATA:')]
        return next(e for e in events if e['type']=='result_pack'), proc.stdout, perf_counter()-started
    first, _, cold = run()
    second, log, warm = run()
    assert first['cache']['misses']==1 and second['cache']['hits']==1
    assert first['samples'][0]['basic']==second['samples'][0]['basic']
    assert first['zip']==second['zip']
    assert '[Microstructure Analysis]' not in log and '[Advanced Microstructure]' not in log
    source.rename(inputs/'renamed.ang')
    renamed, log, _ = run()
    assert renamed['cache']['hits']==1 and renamed['samples'][0]['name']=='renamed'
    assert '[Microstructure Analysis]' not in log
    forced, log, _ = run('--force-recompute')
    assert forced['cache']['misses']==1 and '[Microstructure Analysis]' in log
    print(f'PASS: initial {cold:.2f}s, saved batch {warm:.2f}s; identical values/ZIP; renamed content reused; force recompute respected')

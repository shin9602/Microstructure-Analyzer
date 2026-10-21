"""Exercise manual source assignments through the actual combined CLI."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

workspace = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='ebsd_manual_') as folder:
    root = Path(folder); inputs = root / 'inputs'; inputs.mkdir()
    source = inputs / 'manual.ang'
    header = ''
    for phase, symmetry in ((7, 62), (2, 43), (9, 43), (4, 43)):
        lattice = '2.906 2.906 2.838 90 90 120' if symmetry == 62 else '3.5 3.5 3.5 90 90 90'
        header += f'# Phase {phase}\n# MaterialName User source {phase}\n# Symmetry {symmetry}\n# LatticeConstants {lattice}\n'
    header += '# GRID: SquareGrid\n# XSTEP: 0.1\n# YSTEP: 0.1\n# NCOLS_ODD: 60\n# NCOLS_EVEN: 60\n# NROWS: 60\n'
    with source.open('w', encoding='utf-8') as stream:
        stream.write(header)
        for row in range(60):
            for col in range(60):
                phase = 7 if col < 20 else 2 if col < 30 else 9 if col < 40 else 4
                stream.write(f'0 0 0 {col / 10:.1f} {row / 10:.1f} {100 + col} .9 {phase} 1 1\n')
    options = {'phase_maps': {'manual.ang': {'7': 'WC', '2': 'Co', '9': 'Eta', '4': 'Gamma'}}}
    result = subprocess.run([sys.executable, '-X', 'utf8', str(workspace / 'python/run_ebsd.py'),
                             '--uploaded', str(inputs), '--output', str(root / 'results'),
                             '--gamma-mode', 'manual', '--co-wt', '80', '--analysis-options', json.dumps(options)],
                            cwd=root, capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, (result.stdout + result.stderr)[-5000:]
    events = [json.loads(line[10:]) for line in result.stdout.splitlines() if line.startswith('JSON_DATA:')]
    report = next(event for event in events if event['type'] == 'result_pack')
    assert not report['errors'], report['errors']
    sample = report['samples'][0]; basic = sample['basic']
    assert abs(basic['Co_Vol'] - 100 / 6) < 1e-8
    assert abs(basic['Eta_Area'] - 100 / 6) < 1e-8
    assert abs(basic['WC_Vol'] - 100 / 3) < 1e-8
    assert abs(basic['G_Vol'] - 100 / 3) < 1e-8
    assert basic['Eta_Regions'] == 1
    assert basic['PhaseAudit']['co_wt_percent'] is None
    assert sample['advanced'] is not None, sample['warnings']
    assert sample['advanced']['PhaseAudit']['eta_points'] == 600
    assert any('ETA_SIZE_' in image for image in sample['images'])
    assert (root / 'results' / report['zip']).is_file()
    print('PASS: manual Phase IDs respected despite Co 80 wt% argument; eta excluded in both analyses; maps/size/CSV/ZIP produced')

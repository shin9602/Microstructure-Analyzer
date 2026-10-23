"""Verify sibling imports with the isolated path used by embeddable Python."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class BootstrapTests(unittest.TestCase):
    def test_isolated_python_finds_modules_after_relocation(self):
        source = Path(__file__).resolve().parent
        modules = ('microstructure_analysis', 'advanced_microstructure',
                   'ebsd_phases', 'ebsd_exports', 'ebsd_regions', 'osc_to_ang',
                   'ebsd_metrics', 'ebsd_performance', 'ebsd_cache')
        with tempfile.TemporaryDirectory(prefix='ebsd_한글 relocation_') as folder:
            relocated = Path(folder) / 'different installation' / 'python'
            relocated.mkdir(parents=True)
            for name in ('run_ebsd', *modules):
                shutil.copy2(source / (name + '.py'), relocated)
            probe = Path(folder) / 'probe.py'
            probe.write_text(
                'import importlib.util, pathlib, runpy, sys\n'
                'runner = pathlib.Path(sys.argv[1])\n'
                'assert str(runner.parent) not in sys.path\n'
                'runpy.run_path(str(runner), run_name="bootstrap_probe")\n'
                'for name in sys.argv[2:]:\n'
                '    spec = importlib.util.find_spec(name)\n'
                '    assert spec is not None, name\n'
                '    assert pathlib.Path(spec.origin) == runner.parent / (name + ".py"), spec.origin\n',
                encoding='utf-8')
            result = subprocess.run(
                [sys.executable, '-I', '-X', 'utf8', str(probe),
                 str(relocated / 'run_ebsd.py'), *modules],
                cwd=folder, capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()

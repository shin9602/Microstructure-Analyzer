import json
from pathlib import Path
import tempfile
import unittest
from ebsd_cache import ResultCache, digest_json, file_hash, sample_key


class CacheTests(unittest.TestCase):
    def test_identity_uses_content_and_conditions_not_filename(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / '한글 원본.osc'
            renamed = root / 'renamed.osc'
            source.write_bytes(b'actual source bytes')
            renamed.write_bytes(source.read_bytes())
            def key(path=source, co=7.5, mode='all_other', phases=None, eta=None, basis='remaining', code='v1'):
                return sample_key(path, co, mode, phases, eta, basis, code)
            reference = key()
            self.assertEqual(reference, key(renamed))
            for changed in (key(co=8), key(mode='named'), key(phases={'1': 'WC'}),
                            key(basis='total'), key(code='v2')):
                self.assertNotEqual(reference, changed)
            source.write_bytes(b'changed contents, same name')
            self.assertNotEqual(reference, key())

    def test_eta_mask_contents_participate_and_wrong_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source, mask = Path(folder)/'x.ang', Path(folder)/'mask.bin'
            source.write_bytes(b'source'); mask.write_bytes(b'\x00\x01')
            eta = {'path': str(mask), 'source_sha256': file_hash(source), 'width': 2, 'height': 1}
            before = sample_key(source, 7.5, 'all_other', None, eta, 'remaining', 'v1')
            mask.write_bytes(b'\x01\x00')
            self.assertNotEqual(before, sample_key(source, 7.5, 'all_other', None, eta, 'remaining', 'v1'))
            eta['source_sha256'] = 'wrong'
            with self.assertRaises(ValueError):
                sample_key(source, 7.5, 'all_other', None, eta, 'remaining', 'v1')

    def test_missing_corrupt_or_old_artifacts_are_not_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); output = root/'results'; output.mkdir()
            image = output/'sample.png'; image.write_bytes(b'PNG data')
            record = {'name': 'sample', 'images': ['sample.png'], 'image_data': {}}
            cache = ResultCache(root/'cache', output, 'v1'); key = digest_json('sample')
            cache.save_sample(key, record)
            self.assertEqual(cache.load_sample(key)['payload'], record)
            self.assertIsNone(ResultCache(root/'cache', output, 'v2').load_sample(key))
            image.write_bytes(b'truncated')
            self.assertIsNone(cache.load_sample(key))
            image.unlink()
            self.assertIsNone(cache.load_sample(key))
            (root/'cache'/'samples'/(key+'.json')).write_text('{bad json')
            self.assertIsNone(cache.load_sample(key))

    def test_history_includes_only_complete_compatible_results(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); output = root/'results'; output.mkdir()
            result = {'samples': [{'name': '검증', 'images': ['image.png'], 'image_data': {}}]}
            for kind in ('txt', 'csv', 'json', 'zip'):
                result[kind] = 'report.'+kind
                (output/result[kind]).write_bytes(kind.encode())
            (output/'image.png').write_bytes(b'png')
            cache = ResultCache(root/'cache', output, 'v1'); key = digest_json('batch')
            cache.save_batch(key, result)
            self.assertEqual(cache.history()[0]['names'], ['검증'])
            (output/'image.png').unlink()
            self.assertEqual(cache.history(), [])

    def test_cached_paths_cannot_leave_results_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); output = root/'results'; output.mkdir()
            outside = root/'outside.txt'; outside.write_bytes(b'data')
            cache = ResultCache(root/'cache', output, 'v1')
            with self.assertRaises(ValueError):
                cache.save_sample(digest_json('bad'), {'images': ['../outside.txt']})


if __name__ == '__main__':
    unittest.main()

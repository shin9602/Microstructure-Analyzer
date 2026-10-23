"""Persistent content/condition keyed EBSD results; no scientific imports on hits."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import uuid


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True,
                                     allow_nan=False, separators=(',', ':')).encode()).hexdigest()


def algorithm_signature():
    folder = Path(__file__).resolve().parent
    names = ('run_ebsd.py', 'microstructure_analysis.py', 'advanced_microstructure.py',
             'ebsd_phases.py', 'ebsd_regions.py', 'ebsd_exports.py', 'osc_to_ang.py',
             'ebsd_metrics.py', 'ebsd_performance.py', 'ebsd_cache.py', 'ebsd_limits.py')
    versions = {}
    for package in ('numpy', 'scipy', 'orix', 'numba', 'matplotlib', 'pandas',
                    'scikit-image', 'Pillow', 'dask', 'diffpy-structure'):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = 'missing'
    return digest_json({'schema': 1, 'python': list(sys.version_info[:2]),
                        'code': {name: file_hash(folder / name) for name in names},
                        'versions': versions})


def sample_key(source, co_wt, gamma_mode, assignments, eta_selection, co_basis, signature):
    source_digest = file_hash(source)
    eta = None
    if eta_selection is not None:
        if eta_selection.get('source_sha256') != source_digest:
            raise ValueError('에타 영역을 선택한 파일과 현재 파일이 다릅니다. 다시 선택하세요.')
        eta = {'mask': file_hash(eta_selection['path']),
               'width': eta_selection['width'], 'height': eta_selection['height']}
    return digest_json({'source': source_digest, 'format': Path(source).suffix.lower(),
                        'co_wt': None if gamma_mode == 'manual' else co_wt,
                        'gamma_mode': gamma_mode, 'assignments': assignments,
                        'eta': eta, 'co_basis': co_basis, 'algorithm': signature})


class ResultCache:
    def __init__(self, directory, output_root, signature):
        self.directory = Path(directory)
        self.root = Path(output_root).resolve()
        self.signature = signature

    def _path(self, kind, key):
        if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
            raise ValueError('Invalid cache key')
        return self.directory / kind / (key + '.json')

    def _files(self, files):
        output = {}
        for relative in set(files):
            path = (self.root / relative).resolve()
            if self.root not in path.parents or not path.is_file():
                raise ValueError('Missing or invalid cached artifact')
            output[relative] = path.stat().st_size
        return output

    def _read(self, kind, key):
        try:
            item = json.loads(self._path(kind, key).read_text(encoding='utf-8'))
            if item['algorithm'] != self.signature or self._files(item['files']) != item['files']:
                return None
            return item
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _save(self, kind, key, payload, files):
        target = self._path(kind, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        data = {'algorithm': self.signature, 'created_at': datetime.now(timezone.utc).isoformat(),
                'files': self._files(files), 'payload': payload}
        temporary = target.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        try:
            temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding='utf-8')
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)

    def load_sample(self, key):
        return self._read('samples', key)

    def save_sample(self, key, record):
        self._save('samples', key, record, sample_files(record))

    def load_batch(self, key):
        return self._read('batches', key)

    def save_batch(self, key, result):
        files = [result[k] for k in ('txt', 'csv', 'json', 'zip')]
        for sample in result['samples']:
            files.extend(sample_files(sample))
        self._save('batches', key, result, files)

    def history(self):
        entries = []
        for path in (self.directory / 'batches').glob('*.json'):
            item = self.load_batch(path.stem)
            if item:
                entries.append({'key': path.stem, 'created_at': item['created_at'],
                                'names': [s['name'] for s in item['payload']['samples']]})
        return sorted(entries, key=lambda item: item['created_at'], reverse=True)[:20]


def sample_files(record):
    return [*record.get('images', []),
            *(path for files in record.get('image_data', {}).values() for path in files)]


def cached_result(item):
    result = item['payload']
    for sample in result['samples']:
        sample['cache'] = {'hit': True, 'stored_at': item['created_at'],
                           'original_name': sample['name']}
    result['cache'] = {'hits': len(result['samples']), 'misses': 0}
    return result


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--open')
    args = parser.parse_args()
    cache = ResultCache(args.cache_dir, args.output, algorithm_signature())
    if args.open:
        item = cache.load_batch(args.open)
        print(json.dumps(cached_result(item) if item else {'error': '저장 결과가 없거나 분석 코드·파일이 변경됐습니다.'}, ensure_ascii=True))
    else:
        print(json.dumps({'entries': cache.history()}, ensure_ascii=True))

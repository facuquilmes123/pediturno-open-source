"""Package the verified Next.js standalone build without server secrets."""

import argparse
import hashlib
import json
import shutil
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def copy_tree(source: Path, destination: Path) -> None:
    if not source.is_dir():
        raise RuntimeError(f'Missing build directory: {source.relative_to(ROOT)}')
    for current, directories, files in __import__('os').walk(source):
        current_path = Path(current)
        relative = current_path.relative_to(source)
        target_dir = destination / relative
        target_dir.mkdir(parents=True, exist_ok=True)
        for directory in directories:
            if (current_path / directory).is_symlink():
                raise RuntimeError(f'Refusing source symlink: {directory}')
        for name in files:
            path = current_path / name
            if path.is_symlink():
                raise RuntimeError(f'Refusing source symlink: {path}')
            if name in {'.env', '.envbackup'} or name.startswith('.env.') or name.endswith('.pem'):
                continue
            shutil.copy2(path, target_dir / name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        raise RuntimeError('Refusing to overwrite a release candidate')
    if destination.is_relative_to(ROOT.resolve()):
        raise RuntimeError('Release candidate must be outside the checkout')

    standalone = ROOT / '.next' / 'standalone'
    build_id = (ROOT / '.next' / 'BUILD_ID').read_text(encoding='ascii').strip()
    destination.mkdir(parents=True)
    runtime = destination / 'nodejs'
    copy_tree(standalone, runtime)
    copy_tree(ROOT / '.next' / 'static', runtime / '.next' / 'static')
    copy_tree(ROOT / 'public', runtime / 'public')
    (runtime / 'scripts').mkdir()
    shutil.copy2(ROOT / 'scripts' / 'hostinger-cron.mjs', runtime / 'scripts' / 'hostinger-cron.mjs')

    if (runtime / '.next' / 'BUILD_ID').read_text(encoding='ascii').strip() != build_id:
        raise RuntimeError('Build ID changed during packaging')
    required = ('server.js', '.next/BUILD_ID', 'public/logo.webp', 'scripts/hostinger-cron.mjs')
    if any(not (runtime / name).is_file() for name in required):
        raise RuntimeError('Incomplete standalone package')
    files = sorted(path for path in runtime.rglob('*') if path.is_file())
    if any(path.name.startswith('.env') for path in files):
        raise RuntimeError('An environment file entered the release package')

    archive = destination / 'pediturno-release.tar.gz'
    with tarfile.open(archive, 'w:gz') as output:
        output.add(runtime, arcname='nodejs', recursive=True)
    manifest = {
        'kind': 'Pediturno Hostinger standalone release candidate',
        'build_id': build_id,
        'archive': archive.name,
        'sha256': sha256(archive),
        'file_count': len(files),
        'server_js_sha256': sha256(runtime / 'server.js'),
        'environment_included': False,
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()

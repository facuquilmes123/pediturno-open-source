"""Verify the saved active runtime on loopback, with no inherited app credentials."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BACKUP = ROOT / 'output/android-implementation-20261026/hostinger-active-runtime-20261010'
OUT = ROOT / 'output/backend-pasada2-20261028'


def main():
    OUT.mkdir(exist_ok=True)
    manifest = json.loads((BACKUP / 'runtime-backup-manifest.json').read_text())
    archive = BACKUP / manifest['archive']
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['sha256'], 'Backup hash mismatch'
    runtime = OUT / ('restore-runtime-' + str(time.time_ns()))
    runtime.mkdir(exist_ok=False)
    with zipfile.ZipFile(archive) as source:
        assert source.testzip() is None, 'Backup CRC failure'
        for entry in source.infolist():
            target = (runtime / entry.filename).resolve()
            assert target.is_relative_to(runtime.resolve()), 'Unsafe archive path'
            assert not stat.S_ISLNK(entry.external_attr >> 16), 'Archive contains a link'
            assert not Path(entry.filename).name.startswith('.env'), 'Environment file in archive'
        source.extractall(runtime)
    for name, expected in manifest['criticalMembers'].items():
        assert hashlib.sha256((runtime / name).read_bytes()).hexdigest() == expected, 'Critical member mismatch'
    # The runtime's health handler is independent of Firebase. Never pass real credentials here.
    env = {name: value for name, value in os.environ.items()
           if name.upper() in {'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'}}
    env.update(NODE_ENV='production', PORT='3137', HOSTNAME='127.0.0.1', NEXT_TELEMETRY_DISABLED='1')
    with (OUT / 'restore-runtime.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen(['node', 'server.js'], cwd=runtime, env=env, stdout=log, stderr=log)
        try:
            health = None
            for _ in range(60):
                if process.poll() is not None:
                    raise RuntimeError('Restored runtime exited before health; inspect local diagnostic log')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:3137/api/health', timeout=2) as response:
                        health = json.load(response)
                    break
                except OSError:
                    time.sleep(0.5)
            assert health and health.get('ok') and health.get('release') == '20261010-mobile-1', 'Unexpected restored health'
            with urllib.request.urlopen('http://127.0.0.1:3137/logo.webp', timeout=30) as response:
                assert response.status == 200 and len(response.read()) > 0, 'Restored static asset unavailable'
            result = {'runtimeArchiveSha256': manifest['sha256'], 'crcVerified': True,
                      'criticalMembersVerified': True, 'health': health, 'staticAsset': True,
                      'credentialsInherited': False, 'productionChanged': False,
                      'scope': 'Runtime restoration on Windows loopback; no live database or configuration restoration'}
            (OUT / 'restore-smoke.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result))
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == '__main__':
    main()

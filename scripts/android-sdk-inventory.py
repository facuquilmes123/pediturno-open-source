"""Inventory a verified release AAB and AGP dependency metadata without executing SDKs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--java', default='C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot/bin/java.exe')
    parser.add_argument('--artifact-manifest', type=Path, help='Verified artifact manifest for a newer release; defaults to the historical manifest.')
    parser.add_argument('--output-directory', type=Path, help='Separate evidence directory; preserves historical release evidence by default.')
    args = parser.parse_args()
    root = args.root.resolve()
    tools_directory = root / 'output/android-implementation-20261026'
    manifest_path = args.artifact_manifest.resolve() if args.artifact_manifest else tools_directory / 'signed-artifact-manifest.json'
    output = args.output_directory.resolve() if args.output_directory else tools_directory
    signed_manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    aab_record = next(row for row in signed_manifest['files'] if row['kind'] == 'aab')
    expected = aab_record['sha256']
    bundle = manifest_path.parent / aab_record.get('artifactFile', 'PediTurno-1.0.0-1-release.aab')
    actual = sha256(bundle)
    if actual.lower() != expected.lower():
        raise ValueError('AAB differs from the verified signed release; inventory refused')
    dependency_file = root / signed_manifest.get('releaseDependencyMetadataFile', 'android/pediturno-servicios/app/build/outputs/sdk-dependencies/release/sdkDependencies.txt')
    expected_dependencies = signed_manifest.get('releaseDependencyMetadataSha256')
    if not expected_dependencies or sha256(dependency_file) != expected_dependencies:
        raise ValueError('Release dependency metadata is not bound to this signed manifest; inventory refused')
    coordinates = []
    for block in re.findall(r'maven_library\s*\{([^{}]*)\}', dependency_file.read_text(encoding='utf-8')):
        fields = dict(re.findall(r'(groupId|artifactId|version):\s*"([^"]+)"', block))
        if len(fields) != 3:
            raise ValueError('Incomplete Maven metadata block')
        coordinates.append(':'.join(fields[key] for key in ('groupId', 'artifactId', 'version')))
    if not coordinates:
        raise ValueError('Release dependency inventory is empty')
    packaged_versions = []
    with zipfile.ZipFile(bundle) as archive:
        for name in sorted(archive.namelist()):
            if not name.startswith('base/root/') or not name.endswith('.properties'):
                continue
            # Properties metadata only: never read bundled public configuration,
            # credential material or arbitrary resources into the report.
            values = dict(re.findall(r'^([^#!\s=]+)\s*=\s*(.*?)\s*$', archive.read(name).decode('utf-8').replace('\r\n', '\n'), re.M))
            if values.get('version'):
                packaged_versions.append({'entry': name, 'version': values['version']})
    bundletool = tools_directory / 'tools/bundletool-all-1.18.3.jar'
    expected_tool_hash = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29'
    if sha256(bundletool) != expected_tool_hash:
        raise ValueError('Bundletool differs from the vendor-verified tool')
    java = args.java if Path(args.java).is_file() else shutil.which('java')
    if not java:
        raise ValueError('Select the installed Java runtime with --java')
    dumped = subprocess.run([java, '-jar', str(bundletool), 'dump', 'manifest',
                             '--bundle=' + str(bundle), '--module=base'],
                            capture_output=True, check=True, timeout=60, encoding='utf-8')
    manifest_text = dumped.stdout
    manifest = ET.fromstring(manifest_text[manifest_text.index('<manifest'):])
    android = '{http://schemas.android.com/apk/res/android}'
    permissions = sorted(item.attrib[android + 'name'] for item in manifest.findall('uses-permission'))
    application = manifest.find('application')
    metadata = {item.attrib.get(android + 'name'): item.attrib.get(android + 'value')
                for item in application.findall('meta-data')}
    privacy_groups = ('com.google.firebase:', 'com.android.billingclient:', 'androidx.credentials:',
                      'androidx.biometric:', 'com.google.android.libraries.identity.googleid:',
                      'com.google.android.play:', 'com.google.android.gms:', 'com.google.android.recaptcha:',
                      'org.chromium.net:')
    report = {
        'observedAt': datetime.now(timezone.utc).isoformat(),
        'package': manifest.attrib['package'], 'versionCode': manifest.attrib[android + 'versionCode'],
        'artifactSha256': actual, 'releaseDependencyMetadataSha256': sha256(dependency_file),
        'bundletoolSha256': expected_tool_hash,
        'currentManifestSha256': hashlib.sha256(manifest_text.encode('utf-8')).hexdigest(),
        'declaredReleaseDependencyCoordinates': sorted(set(coordinates)),
        'declaredReleaseDependencyCoordinateCount': len(set(coordinates)),
        'privacyRelevantCoordinates': sorted(set(item for item in coordinates if item.startswith(privacy_groups))),
        'packagedGoogleSdkVersions': packaged_versions,
        'permissions': permissions,
        'billingManifestVersion': metadata.get('com.google.android.play.billingclient.version'),
        'fcmAutoInitOverride': metadata.get('firebase_messaging_auto_init_enabled'),
        'fcmAnalyticsCollectionOverride': metadata.get('firebase_analytics_collection_enabled'),
        'firebaseDataCollectionDefaultOverride': metadata.get('firebase_data_collection_default_enabled'),
        'namedSdkIndicators': {
            name: sorted(item for item in set(coordinates) if re.search(pattern, item))
            for name, pattern in {
                'analytics': r'firebase-analytics|play-services-measurement',
                'crashlytics': r'firebase-crashlytics',
                'ads': r'play-services-ads(?:-|:)|ads-mobile',
                'firestoreAndroidClient': r'com\.google\.firebase:firebase-firestore',
                'debugAppCheckProvider': r'firebase-appcheck-debug',
                'appDistribution': r'firebase-appdistribution',
                'testLibraries': r'androidx\.test[.:]|org\.robolectric:|junit:junit|org\.junit:|org\.mockito:|io\.mockk:|ui-test-|ui-tooling:'
            }.items()
        },
        'scope': 'AGP release dependency graph (including platform/BOM entries), packaged Google properties and verified AAB manifest. These are not counts of active SDKs. Presence does not prove runtime collection; absence of a named indicator is not a comprehensive no-collection claim.',
        'runtimeDataFlowVerified': False, 'consoleSubmitted': False,
    }
    destination = output / 'release-sdk-inventory.json'
    destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'declaredReleaseDependencyCoordinates'}, indent=2))


if __name__ == '__main__':
    main()

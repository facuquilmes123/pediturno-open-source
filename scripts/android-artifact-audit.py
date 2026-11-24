"""Read-only APK/AAB integrity and native ELF inspection; no third-party packages.

This does not replace installation, Play signing checks or a real 16 KB runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile


def inspect_elf(data):
    if data[:4] != b'\x7fELF' or len(data) < 64 or data[4] not in (1, 2) or data[5] not in (1, 2):
        raise ValueError('Invalid ELF header')
    is64 = data[4] == 2
    endian = '<' if data[5] == 1 else '>'
    phoff = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, 32 if is64 else 28)[0]
    entry_size, count = struct.unpack_from(endian + 'HH', data, 54 if is64 else 42)
    minimum_size = 56 if is64 else 32
    if entry_size < minimum_size or phoff + entry_size * count > len(data):
        raise ValueError('Invalid ELF program header bounds')
    segments = []
    relro = []
    for index in range(count):
        offset = phoff + index * entry_size
        segment_type = struct.unpack_from(endian + 'I', data, offset)[0]
        if segment_type == 0x6474e552:  # PT_GNU_RELRO
            virtual_address = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, offset + (16 if is64 else 8))[0]
            memory_size = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, offset + (40 if is64 else 20))[0]
            relro.append({'virtualAddress': virtual_address, 'memorySize': memory_size,
                          'compatible16k': memory_size == 0 or (virtual_address + memory_size) % 16384 == 0})
        if segment_type != 1:
            continue
        file_offset = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, offset + (8 if is64 else 4))[0]
        virtual_address = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, offset + (16 if is64 else 8))[0]
        alignment = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, offset + (48 if is64 else 28))[0]
        memory_size = struct.unpack_from(endian + ('Q' if is64 else 'I'), data, offset + (40 if is64 else 20))[0]
        flags = struct.unpack_from(endian + 'I', data, offset + (4 if is64 else 24))[0]
        segments.append({'alignment': alignment, 'virtualAddress': virtual_address,
                         'memorySize': memory_size, 'writable': bool(flags & 2),
                         'compatible16k': alignment >= 16384 and file_offset % 16384 == virtual_address % 16384})
    # Android's documented exception: an entire LOAD may contain only RELRO.
    # Its end need not be page aligned if protection cannot cover other writable
    # LOAD data. Preserve the raw modulo result separately from this exception.
    for section in relro:
        section['endAligned16k'] = section['compatible16k']
        own_load = next((segment for segment in segments
                         if segment['virtualAddress'] == section['virtualAddress']
                         and segment['memorySize'] <= section['memorySize']), None)
        protection_start = section['virtualAddress'] // 16384 * 16384
        protection_end = (section['virtualAddress'] + section['memorySize'] + 16383) // 16384 * 16384
        overlaps_other_writable = any(segment is not own_load and segment['writable']
            and segment['memorySize'] > 0
            and segment['virtualAddress'] < protection_end
            and segment['virtualAddress'] + segment['memorySize'] > protection_start
            for segment in segments)
        section['isolatedLoadException'] = own_load is not None and not overlaps_other_writable
        section['compatible16k'] = section['endAligned16k'] or section['isolatedLoadException']
    return {'bits': 64 if is64 else 32, 'loadSegments': segments, 'relroSegments': relro}


def inspect_artifact(path):
    is_apk = path.suffix.lower() == '.apk'
    result = {'artifact': str(path.resolve()), 'bytes': path.stat().st_size,
              'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'format': 'apk' if is_apk else 'aab', 'nativeLibraries': []}
    with zipfile.ZipFile(path) as archive, path.open('rb') as raw:
        broken_entry = archive.testzip()
        if broken_entry:
            raise ValueError('Corrupt ZIP entry: ' + broken_entry)
        for item in archive.infolist():
            if not item.filename.endswith('.so'):
                continue
            elf = inspect_elf(archive.read(item))
            segments = elf['loadSegments']
            raw.seek(item.header_offset)
            header = raw.read(30)
            if header[:4] != b'PK\x03\x04':
                raise ValueError('Invalid ZIP local header')
            name_size, extra_size = struct.unpack_from('<HH', header, 26)
            data_offset = item.header_offset + 30 + name_size + extra_size
            row = {'path': item.filename, 'bytes': item.file_size, 'elfBits': elf['bits'],
                   'pageSize16kApplies': elf['bits'] == 64, 'loadSegments': segments,
                   'relroSegments': elf['relroSegments'],
                   'elf16k': bool(segments) and all(segment['compatible16k'] for segment in segments)
                       and all(segment['compatible16k'] for segment in elf['relroSegments']),
                   'compressed': item.compress_type != zipfile.ZIP_STORED}
            if is_apk:
                row['zip16k'] = item.compress_type != zipfile.ZIP_STORED or data_offset % 16384 == 0
            result['nativeLibraries'].append(row)
    # Android's 16 KB runtime requirement applies to 64-bit devices. Keep the
    # 32-bit measurements visible without treating a 32-bit ELF as a 64-bit failure.
    applicable = [item for item in result['nativeLibraries'] if item['pageSize16kApplies']]
    result['native64BitSupportMissing'] = bool(result['nativeLibraries']) and not applicable
    result['elf16k'] = all(item['elf16k'] for item in applicable) and not result['native64BitSupportMissing']
    if is_apk:
        result['zip16k'] = all(item['zip16k'] for item in result['nativeLibraries'])
    result['runtime16kVerified'] = False
    result['scope'] = 'ZIP integrity, 64-bit ELF LOAD and GNU_RELRO alignment only; signatures, generated bundle APKs and device execution require separate checks.'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.artifact.suffix.lower() not in ('.apk', '.aab'):
        parser.error('Expected APK or AAB')
    result = inspect_artifact(args.artifact)
    encoded = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + '\n', encoding='utf-8')
    print(encoded)
    if not result['elf16k'] or result.get('zip16k') is False:
        raise SystemExit(1)


if __name__ == '__main__':
    main()

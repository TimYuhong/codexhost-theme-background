from hashlib import sha256
import json
import os
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

NAMES = sorted((
    'LICENSE', 'manifest.json', 'page.mjs', 'page.css',
    'desktop.js', 'desktop.css', 'web.mjs', 'web.css',
    'icon.png', 'preview-dark.webp', 'preview-settings.webp', 'preview-light.webp',
))
MIB = 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as handle:
        return sha256(handle.read()).hexdigest()


def main():
    dist = Path('dist')
    release = Path('release')
    require(sorted(p.name for p in dist.iterdir()) == NAMES, 'dist must contain the exact 12 release files')
    source = {name: dist / name for name in NAMES}
    require(all(path.is_file() and not path.is_symlink() for path in source.values()), 'dist entries must be regular files')
    manifest = json.loads(source['manifest.json'].read_text(encoding='utf-8'))
    package = json.loads(Path('package.json').read_text(encoding='utf-8'))
    require(
        manifest['id'] == package['name'] == 'theme-background'
        and manifest['version'] == package['version']
        and bool(re.fullmatch(r'\d+\.\d+\.\d+', manifest['version'])),
        'Manifest and package must both identify theme-background with matching semver',
    )
    for name, path in source.items():
        limit = (
            256 * 1024 if name.endswith('.css') else
            512 * 1024 if name.endswith(('.js', '.mjs', '.webp')) else
            128 * 1024
        )
        require(0 < path.stat().st_size <= limit, f'{name} exceeds its package budget ({limit} bytes)')
    target = release / f"{manifest['id']}-{manifest['version']}.zip"
    sidecar = target.with_suffix('.zip.sha256')
    release.mkdir(exist_ok=True)
    temporary = []
    try:
        with NamedTemporaryFile(dir=release, prefix='.theme-background-', delete=False) as handle:
            archive = Path(handle.name)
            temporary.append(archive)
        with ZipFile(archive, 'w', compression=ZIP_DEFLATED, allowZip64=False) as package:
            for name, path in source.items():
                info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                package.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED)
        require(archive.stat().st_size <= MIB, 'ZIP exceeds the 1 MiB project limit')
        with ZipFile(archive) as installed:
            require(installed.namelist() == NAMES, 'ZIP paths or file count differ from dist')
            require(sum(info.file_size for info in installed.infolist()) <= 256 * MIB, 'ZIP exceeds the unpack limit')
            require(installed.testzip() is None, 'ZIP failed CRC check')
            for name, path in source.items():
                require(sha256(installed.read(name)).hexdigest() == digest(path), f'ZIP content SHA-256 mismatch: {name}')
        expected = digest(archive)
        with NamedTemporaryFile(dir=release, prefix='.theme-background-', delete=False) as handle:
            checksum = Path(handle.name)
            temporary.append(checksum)
            handle.write(f'{expected}  {target.name}\n'.encode('ascii'))
        os.replace(archive, target)
        os.replace(checksum, sidecar)
        require(digest(target) == expected and sidecar.read_text(encoding='ascii').split() == [expected, target.name], 'Final ZIP SHA-256 mismatch')
        print(f'{expected}  {target.as_posix()} ({target.stat().st_size} bytes)')
    finally:
        for path in temporary:
            path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()

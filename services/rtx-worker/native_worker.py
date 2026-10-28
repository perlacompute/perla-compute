#!/usr/bin/env python3
"""Container-native launcher for the unchanged, pinned Perla RTX 0.5.0 worker."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

KIT = Path(__file__).resolve().parent
UPSTREAM = '82e6eee7076aafe10123e08db78f100d270c0582'
PROTOCOL = 'perla-pearl-plain-v4'
RELEASE = 'worker-v0.5.0'
RUST = '1.99.1'
VERSION = '0.1.0'


class NativeError(Exception):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def clean_path(path):
    path = Path(os.path.abspath(os.path.expanduser(str(path))))
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise NativeError('Use paths without symlinks: ' + path.name)
    return path


def regular(path, limit=32 * 1024 * 1024):
    path = clean_path(path)
    if not path.is_file() or path.stat().st_size > limit:
        raise NativeError('Expected a regular bounded file: ' + path.name)
    return path.read_bytes()


def atomic_json(path, value):
    path = clean_path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def inventory():
    return json.loads(regular(KIT / 'worker-inventory.json', 65536))


def separate_roots(root, native_root):
    root, native_root = clean_path(root), clean_path(native_root)
    if root == native_root or root in native_root.parents or native_root in root.parents:
        raise NativeError('Use separate non-overlapping installed and native runtime directories.')


def installed_source(root):
    root = clean_path(root)
    state = json.loads(regular(root / 'current.json', 1024 * 1024))
    directory = root / 'versions' / (state.get('release','') + '-rtx')
    if (state.get('schema') != 1 or state.get('repository') != 'perlacompute/perla-compute'
            or state.get('release') not in (RELEASE,'worker-v0.6.0','worker-v0.7.0') or state.get('profile') != 'rtx'
            or state.get('directory') != str(directory) or state.get('upstreamCommit') != UPSTREAM):
        raise NativeError('Use the existing verified worker-v0.5.0 RTX installation.')
    for name, expected in inventory().items():
        if Path(name).name != name or state.get('inventory', {}).get(name) != expected:
            raise NativeError('Installed worker inventory differs: ' + name)
        if sha(regular(directory / name)) != expected:
            raise NativeError('Installed worker source changed: ' + name)
    return directory


def runtime_env():
    names = {'PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'CUDA_HOME',
             'CUDA_PATH', 'CUDA_VISIBLE_DEVICES', 'NVIDIA_VISIBLE_DEVICES',
             'NVIDIA_DRIVER_CAPABILITIES', 'SSL_CERT_FILE', 'SSL_CERT_DIR'}
    env = {k: v for k, v in os.environ.items() if k in names}
    env.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1',
               RAYON_NUM_THREADS='2', OMP_NUM_THREADS='2', OPENBLAS_NUM_THREADS='2')
    return env


def capture(args, timeout=30, env=None, cwd=None):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                                env=env or runtime_env(), cwd=cwd)
    except FileNotFoundError:
        raise NativeError('Missing executable: ' + str(args[0])) from None
    except subprocess.TimeoutExpired:
        raise NativeError('Timed out checking: ' + str(args[0])) from None
    if result.returncode:
        raise NativeError('Check failed: ' + str(args[0]) + ' ' + ' '.join(map(str, args[1:3])))
    return result.stdout.strip()


def selected_gpu(device):
    output = capture(['nvidia-smi', '--query-gpu=index,name,compute_cap,driver_version',
                      '--format=csv,noheader'])
    for line in output.splitlines():
        cells = [s.strip() for s in line.split(',')]
        if len(cells) == 4 and cells[0] == str(device):
            if cells[2] not in ('8.6', '8.9', '12.0'):
                raise NativeError('Selected GPU is not an RTX sm86/sm89/sm120 device.')
            return {'index': device, 'name': cells[1], 'computeCapability': cells[2],
                    'driver': cells[3], 'arch': cells[2].replace('.', '')}
    raise NativeError('Selected GPU is not visible.')


def toolchain(device, requested_python=None, requested_nvcc=None):
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise NativeError('Native validation currently requires Linux x86-64.')
    gpu = selected_gpu(device)
    python = requested_python or shutil.which('python3.12') or sys.executable
    version = capture([python, '-I', '-c', 'import sys;print(".".join(map(str,sys.version_info[:2])))'])
    if version != '3.12':
        raise NativeError('Use Python 3.12, matching the pinned worker build. Pass --python /path/to/python3.12.')
    missing = [tool for tool in ['git', 'curl', 'gcc', 'g++', 'ar'] if not shutil.which(tool)]
    if missing:
        raise NativeError('Missing build tools: ' + ', '.join(missing) +
                          '. On Ubuntu: apt-get update && apt-get install -y build-essential git curl ca-certificates')
    nvcc = requested_nvcc or shutil.which('nvcc')
    candidates = [Path('/usr/local/cuda/bin/nvcc'), *sorted(Path('/usr/local').glob('cuda-*/bin/nvcc'), reverse=True)]
    if not nvcc:
        nvcc = next((str(p) for p in candidates if p.is_file() and os.access(p, os.X_OK)), None)
    if not nvcc:
        raise NativeError('CUDA compiler nvcc is missing. This native build needs a CUDA devel environment; nvidia-smi alone does not include nvcc.')
    codes = capture([str(nvcc), '--list-gpu-code'])
    if not re.search(r'\bsm_' + gpu['arch'] + r'\b', codes):
        raise NativeError('This nvcc cannot compile sm_' + gpu['arch'] + '. Use a CUDA toolkit supporting the selected GPU.')
    return {'gpu': gpu, 'python': str(Path(python).absolute()), 'nvcc': str(Path(nvcc).absolute()),
            'nvccVersion': capture([str(nvcc), '--version']), 'pythonVersion': version}


def cuda_command(nvcc, arch, destination):
    if arch not in ('86', '89', '120'):
        raise NativeError('Unsupported CUDA architecture.')
    return [nvcc, '-std=c++17', '-O3', '-shared', '-Xcompiler=-fPIC', '--cudart=static',
            '-gencode', 'arch=compute_' + arch + ',code=sm_' + arch,
            'rtx.cu', '-o', str(destination)]


def build_step(args, label, logfile, env, cwd=None):
    print(label + ' — log: ' + str(logfile), flush=True)
    try:
        with logfile.open('a') as log:
            result = subprocess.run(args, stdout=log, stderr=subprocess.STDOUT, env=env, cwd=cwd)
    except FileNotFoundError:
        raise NativeError('Missing executable: ' + str(args[0])) from None
    if result.returncode:
        raise NativeError(label + ' failed. Inspect ' + str(logfile))


def read_build(native_root):
    root = clean_path(native_root)
    state = json.loads(regular(root / 'current.json', 1024 * 1024))
    folder = clean_path(Path(state.get('directory', '')))
    if (folder.parent != root / 'builds' or state.get('release') != RELEASE
            or state.get('upstreamCommit') != UPSTREAM or state.get('launcherVersion') != VERSION):
        raise NativeError('Native build state does not match this launcher.')
    for name, expected in inventory().items():
        if sha(regular(folder / 'worker' / name)) != expected:
            raise NativeError('Native worker source changed: ' + name)
    if sha(regular(folder / 'worker/libperla_rtx.so')) != state.get('cudaSha256'):
        raise NativeError('Compiled CUDA backend changed; rebuild it.')
    python = folder / 'venv/bin/python'
    if not python.is_file():
        raise NativeError('Native Python environment is missing.')
    return state, folder, python


def build(args):
    separate_roots(args.root, args.native_root)
    source = installed_source(args.root)
    tools = toolchain(args.device, args.python, args.nvcc)
    marker = clean_path(args.native_root) / 'current.json'
    if marker.exists():
        previous = json.loads(regular(marker, 1024 * 1024))
        if previous.get('launcherVersion') != VERSION or previous.get('release') != RELEASE:
            raise NativeError('Existing native state belongs to another release/project and was preserved. Choose a separate --native-root.')
    try:
        state, folder, _python = read_build(args.native_root)
        if state['arch'] == tools['gpu']['arch'] and state['nvccVersion'] == tools['nvccVersion']:
            print('Reusing the verified native build: ' + str(folder), flush=True)
            return
    except (NativeError, OSError, ValueError, KeyError):
        pass
    parent = clean_path(args.native_root) / 'builds'
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder = Path(tempfile.mkdtemp(prefix='rtx-sm' + tools['gpu']['arch'] + '-', dir=parent))
    worker = folder / 'worker'
    worker.mkdir(mode=0o700)
    for name in inventory():
        (worker / name).write_bytes(regular(source / name))
    log = folder / 'build.log'
    env = runtime_env()
    env.update(CARGO_HOME=str(folder / 'cargo'), RUSTUP_HOME=str(folder / 'rustup'),
               CARGO_BUILD_JOBS='2', CARGO_TARGET_DIR=str(folder / 'target'),
               PIP_CACHE_DIR=str(folder / 'pip-cache'))
    build_step([tools['python'], '-m', 'venv', str(folder / 'venv')], 'Creating isolated Python environment', log, env)
    python = folder / 'venv/bin/python'
    build_step([str(python), '-m', 'pip', '--disable-pip-version-check', 'install', '--only-binary=:all:',
                'numpy==2.4.2', 'blake3==1.0.8', 'maturin==1.13.0'], 'Installing pinned Python dependencies', log, env)
    script = folder / 'rustup.sh'
    build_step(['curl', '--fail', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
                'https://sh.rustup.rs', '-o', str(script)], 'Downloading official Rust installer', log, env)
    build_step(['sh', str(script), '-y', '--no-modify-path', '--profile', 'minimal', '--default-toolchain', RUST],
               'Installing isolated Rust ' + RUST, log, env)
    env['PATH'] = str(folder / 'cargo/bin') + os.pathsep + env.get('PATH', '')
    env['RUSTUP_TOOLCHAIN'] = RUST
    upstream = folder / 'upstream'
    upstream.mkdir(mode=0o700)
    build_step(['git', 'init', '-q'], 'Preparing pinned proof source', log, env, upstream)
    build_step(['git', 'remote', 'add', 'origin', 'https://github.com/pearl-research-labs/pearl.git'],
               'Setting proof source origin', log, env, upstream)
    build_step(['git', 'fetch', '--depth', '1', 'origin', UPSTREAM], 'Fetching exact proof commit', log, env, upstream)
    build_step(['git', 'checkout', '--detach', 'FETCH_HEAD'], 'Checking out pinned proof commit', log, env, upstream)
    if capture(['git', 'rev-parse', 'HEAD'], env=env, cwd=upstream) != UPSTREAM:
        raise NativeError('Proof source commit mismatch.')
    wheels = folder / 'wheels'
    build_step([str(folder / 'venv/bin/maturin'), 'build', '--release', '--locked', '--interpreter', str(python),
                '--compatibility', 'linux', '--out', str(wheels)], 'Compiling unchanged native proof bindings',
               log, env, upstream / 'py-pearl-mining')
    wheel_files = list(wheels.glob('*.whl'))
    if len(wheel_files) != 1:
        raise NativeError('Expected one compiled proof wheel.')
    build_step([str(python), '-m', 'pip', '--disable-pip-version-check', 'install', str(wheel_files[0])],
               'Installing pinned proof bindings', log, env)
    output = worker / 'libperla_rtx.so'
    build_step(cuda_command(tools['nvcc'], tools['gpu']['arch'], output), 'Compiling the selected CUDA target', log, env, worker)
    build_step([str(python), '-I', '-c', 'import pearl_mining;assert pearl_mining.__version__=="0.3.1"'],
               'Checking native binding version', log, env)
    licenses = folder / 'licenses'
    licenses.mkdir()
    for name, relative in [('Pearl-ISC.txt', 'LICENSE'), ('Plonky2-MIT.txt', 'plonky2/LICENSE-MIT'),
                           ('Plonky2-APACHE.txt', 'plonky2/LICENSE-APACHE')]:
        (licenses / name).write_bytes(regular(upstream / relative))
    record = {'launcherVersion': VERSION, 'release': RELEASE, 'protocol': PROTOCOL, 'upstreamCommit': UPSTREAM,
              'directory': str(folder), 'arch': tools['gpu']['arch'], 'nvccVersion': tools['nvccVersion'],
              'cudaSha256': sha(regular(output)), 'proofWheelSha256': sha(regular(wheel_files[0])),
              'gpuValidatedByBuild': False, 'miningStarted': False,
              'builtAt': datetime.now(timezone.utc).isoformat()}
    atomic_json(clean_path(args.native_root) / 'current.json', record)
    print('Native build ready. GPU correctness still requires the real self-test.', flush=True)


def validate_report(report, arch):
    if (not isinstance(report, dict) or report.get('version') != '0.5.0' or report.get('protocol') != PROTOCOL
            or report.get('upstreamCommit') != UPSTREAM or report.get('gpuSelfTestPassed') is not True
            or report.get('coordinatorContacted') is not False or type(report.get('ledgerCredit')) is not int
            or report.get('ledgerCredit') != 0 or not isinstance(report.get('device'), dict)
            or report['device'].get('computeCapability') != int(arch)
            or not isinstance(report['device'].get('name'), str) or not report['device']['name']):
        raise NativeError('GPU report is incomplete or does not match this device/protocol.')
    cases = report.get('cases')
    flags = ['fullGemmMatchesReference', 'allTranscriptsMatchReference', 'signedExtremesMatchReference',
             'nativeV3ProofAccepted', 'nonWinningPowRejected', 'changedChallengeRejected']
    if not isinstance(cases, list) or len(cases) != 2 or {c.get('k') for c in cases} != {2048, 4096}:
        raise NativeError('Both K2048 and K4096 GPU cases are required.')
    if any(c.get(flag) is not True for c in cases for flag in flags):
        raise NativeError('One or more GPU correctness or proof checks failed.')
    return report


def selftest(args):
    installed_source(args.root)
    state, folder, python = read_build(args.native_root)
    gpu = selected_gpu(args.device)
    if gpu['arch'] != state['arch']:
        raise NativeError('Native build architecture differs from the selected GPU; rebuild first.')
    output = clean_path(args.output) if args.output else clean_path(args.native_root) / 'reports' / (
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + str(os.getpid()) + '.json')
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    pending = {'gpuSelfTestPassed': None, 'complete': False, 'coordinatorContacted': False, 'ledgerCredit': 0}
    with output.open('x') as stream:
        json.dump(pending, stream)
    log = folder / ('selftest-' + str(os.getpid()) + '.log')
    env = runtime_env()
    fd, temp_name = tempfile.mkstemp(prefix='gpu-result-', dir=folder)
    try:
        with os.fdopen(fd, 'w') as raw, log.open('w') as errors:
            result = subprocess.run([str(python), '-E', '-s', str(folder / 'worker/miner.py'), 'selftest',
                                     '--device', str(args.device)], stdout=raw, stderr=errors, env=env,
                                    cwd=folder / 'worker')
        if result.returncode:
            raise NativeError('Actual GPU self-test failed. Inspect ' + str(log))
        report = validate_report(json.loads(Path(temp_name).read_text()), state['arch'])
        report['selectedDevice'] = args.device
        report['executionRuntime'] = 'container-native'
        report['nativeLauncherVersion'] = VERSION
        report['cudaSha256'] = state['cudaSha256']
        atomic_json(output, report)
        print(json.dumps(report, indent=2), flush=True)
        print('GPU validation report: ' + str(output), file=sys.stderr)
    except BaseException:
        atomic_json(output, {**pending, 'gpuSelfTestPassed': False, 'complete': True, 'log': str(log)})
        raise
    finally:
        Path(temp_name).unlink(missing_ok=True)


def configuration(path):
    path = clean_path(path)
    if path.stat().st_mode & 0o077:
        raise NativeError('Worker configuration must be private: chmod 600 worker.env')
    values = {}
    for line in regular(path, 16384).decode().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if not sep or key not in ('PERLA_ENDPOINT', 'PERLA_WORKER_TOKEN') or key in values:
            raise NativeError('Use only the private worker.env downloaded from Perla.')
        values[key] = value.strip().strip('\"\'')
    url = urllib.parse.urlsplit(values.get('PERLA_ENDPOINT', ''))
    if (url.scheme != 'https' or not url.hostname or url.username or url.password or url.query
            or url.fragment or url.path.rstrip('/') or not re.fullmatch('[a-f0-9]{64}', values.get('PERLA_WORKER_TOKEN', ''))):
        raise NativeError('Invalid HTTPS origin or worker token; register a worker in Perla.')
    values['PERLA_ENDPOINT'] = values['PERLA_ENDPOINT'].rstrip('/')
    return values


def run_worker(args):
    installed_source(args.root)
    state, folder, python = read_build(args.native_root)
    gpu = selected_gpu(args.device)
    if state['arch'] != gpu['arch']:
        raise NativeError('Rebuild for the selected GPU architecture.')
    env = runtime_env()
    env.update(configuration(args.root / 'config/worker.env'))
    print('Foreground testnet worker: actual GPU checks run again before coordinator contact. Ctrl+C stops it.', flush=True)
    result = subprocess.run([str(python), '-E', '-s', str(folder / 'worker/miner.py'), 'run', '--device',
                             str(args.device), '--shares', str(args.shares), '--interval', str(args.interval)],
                            env=env, cwd=folder / 'worker')
    if result.returncode:
        raise NativeError('Worker stopped. Review its result; no automatic submission retry was performed.')


@contextmanager
def locked(root):
    root = clean_path(root)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = clean_path(root / 'native.lock')
    with lock.open('a') as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise NativeError('Another native Perla operation is running.') from None
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'perla')
    parser.add_argument('--native-root', type=Path, default=Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local/share'))) / 'perla-native')
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ['doctor', 'build', 'selftest', 'run']:
        p = sub.add_parser(command)
        p.add_argument('--device', type=int, default=0)
        if command in ('doctor', 'build'):
            p.add_argument('--python')
            p.add_argument('--nvcc')
        if command == 'selftest':
            p.add_argument('--output', type=Path)
        if command == 'run':
            p.add_argument('--shares', type=int, default=1)
            p.add_argument('--interval', type=float, default=10)
    args = parser.parse_args()
    separate_roots(args.root, args.native_root)
    if not 0 <= args.device < 64 or not 1 <= getattr(args, 'shares', 1) <= 100000 or not 5 <= getattr(args, 'interval', 10) <= 3600:
        parser.error('Use device 0..63, shares 1..100000 and interval 5..3600 seconds.')
    if args.command == 'doctor':
        installed_source(args.root)
        tools = toolchain(args.device, args.python, args.nvcc)
        print(json.dumps({**tools, 'dockerRequired': False, 'gpuSelfTestPassed': None,
                          'coordinatorContacted': False, 'miningStarted': False}, indent=2))
        return
    with locked(args.native_root):
        {'build': build, 'selftest': selftest, 'run': run_worker}[args.command](args)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except KeyboardInterrupt:
        print('Native Perla operation interrupted; no passing result has been inferred.', file=sys.stderr)
        raise SystemExit(130)
    except (NativeError, OSError, ValueError, KeyError, TypeError) as error:
        print('Perla native stopped: ' + str(error), file=sys.stderr)
        raise SystemExit(1)

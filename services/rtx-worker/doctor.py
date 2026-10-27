#!/usr/bin/env python3
"""Redacted host diagnostics. Never issues jobs or submits proofs."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
if not Path(__file__).with_name('perla_bridge.py').exists():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'pearl-adapter'))
from perla_bridge import PerlaClient, PROTOCOL


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return {'ok': result.returncode == 0, 'output': result.stdout.strip()[:1200] if result.returncode == 0 else None}
    except (OSError, subprocess.TimeoutExpired):
        return {'ok': False, 'output': None}


def diagnose(config):
    report = {'version': '0.5.0', 'protocol': PROTOCOL, 'platform': sys.platform,
              'checks': {}, 'coordinatorContacted': False, 'ledgerCredit': 0,
              'gpuSelfTestPassed': None, 'scope': 'Host diagnostics do not validate CUDA results. Run perla selftest separately.'}
    checks = report['checks']
    checks['nvidia'] = command(['nvidia-smi', '--query-gpu=index,name,memory.total,compute_cap,driver_version', '--format=csv,noheader'])
    checks['docker'] = command(['docker', 'version', '--format', '{{.Server.Version}}'])
    checks['buildx'] = command(['docker', 'buildx', 'version'])
    checks['workerImage'] = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'perla-rtx-worker:0.5.0'])
    values = {}
    path = Path(config)
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 16384:
            raise ValueError()
        for line in path.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#'): continue
            key, sep, value = line.partition('=')
            if key in ('PERLA_ENDPOINT','PERLA_WORKER_TOKEN') and sep:
                values[key] = value.strip().strip('\"\'')
        client = PerlaClient(values.get('PERLA_ENDPOINT',''), values.get('PERLA_WORKER_TOKEN',''))
        checks['config'] = {'ok': True, 'privatePermissions': path.stat().st_mode & 0o077 == 0}
        data = client.call('worker/status')
        report['coordinatorContacted'] = True
        checks['credential'] = {'ok': data.get('credentialValid') is True, 'workerId': data.get('id')}
        report['admission'] = data.get('policy',{}).get('status','unknown')
        report['workerCounts'] = data.get('counts', [])
    except (ValueError, KeyError, TypeError, OSError):
        checks['credential'] = {'ok': False, 'message': 'Configuration or authenticated coordinator check failed. No credentials are included in this report.'}
    report['readyForSelfTest'] = all(checks[k]['ok'] for k in ('nvidia','docker','buildx','workerImage'))
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='worker.env')
    args = parser.parse_args()
    report = diagnose(args.config)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report['readyForSelfTest'] and report['checks'].get('credential',{}).get('ok') and report['checks'].get('config',{}).get('privatePermissions') else 1)

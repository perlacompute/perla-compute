#!/usr/bin/env python3
"""Loopback JSON-RPC bridge for the pinned, unmodified Pearl vLLM miner.

Only a worker-scoped Perla token is used. No seed phrase or wallet key is needed.
The miner's getMiningInfo / submitPlainProof messages retain their wire format.
"""
import argparse
import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

PROTOCOL = 'perla-pearl-plain-v4'
UPSTREAM_COMMIT = '82e6eee7076aafe10123e08db78f100d270c0582'
MAX_LINE = (5 * 1024 * 1024 * 4 // 3) + 4096


class PerlaClient:
    def __init__(self, endpoint, token):
        u = urllib.parse.urlparse(endpoint)
        if (u.scheme != 'https' and not (u.scheme == 'http' and u.hostname in ('127.0.0.1', 'localhost'))) or u.username or u.password or u.query or u.fragment or u.path.rstrip('/'):
            raise ValueError('Use an HTTPS coordinator origin, without a path or embedded credentials')
        if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
            raise ValueError('Invalid worker token. Create a worker in the dashboard')
        self.endpoint = endpoint.rstrip('/')
        self.token = token
        self.architecture = None

    def call(self, path, payload=None):
        raw = json.dumps(payload).encode() if payload is not None else None
        headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json','X-Perla-Protocol':PROTOCOL,'X-Perla-Version':'0.5.0'}
        if str(self.architecture) in ('86','89','90','120'):headers['X-Perla-Architecture']=str(self.architecture)
        req = urllib.request.Request(self.endpoint + '/api/mining/' + path, data=raw, headers=headers)
        # Redirects must never forward a worker credential to another origin.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args, **_kwargs):
                return None
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=35) as response:
                data = response.read(MAX_LINE + 1)
                if len(data) > MAX_LINE:
                    raise ValueError('Coordinator response is too large')
                return json.loads(data)
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read(4096)).get('error', 'Coordinator rejected the request')
            except (ValueError, TypeError):
                message = 'Coordinator unavailable or private. Check the endpoint and worker access.'
            raise ValueError(message) from None


class Bridge:
    def __init__(self, client):
        self.client = client
        self.jobs = {}
        self.current = None
        self.fetched = 0
        self.lock = asyncio.Lock()

    async def get_job(self):
        async with self.lock:
            if self.current and time.time() - self.fetched < 2 and self.current['expires'] > time.time() + 3:
                return self.current
            job = await asyncio.to_thread(self.client.call, 'work')
            if job.get('protocol') != PROTOCOL or job.get('chainId') != 46630:
                raise ValueError('Coordinator protocol or chain does not match this release')
            self.jobs = {k: v for k, v in self.jobs.items() if v['expires'] > time.time()}
            self.jobs[job['mining_job']['incomplete_header_bytes']] = job
            self.current = job
            self.fetched = time.time()
            return job

    async def dispatch(self, request):
        if not isinstance(request, dict) or request.get('jsonrpc') != '2.0' or not isinstance(request.get('id'), (int, str)):
            raise ValueError('Invalid JSON-RPC envelope')
        method = request.get('method')
        if method == 'getMiningInfo':
            job = await self.get_job()
            result = dict(job['mining_job'])
            result['target'] = int(result['target'])
            return result
        if method == 'submitPlainProof':
            params = request.get('params')
            if not isinstance(params, dict) or not isinstance(params.get('plain_proof'), str) or not isinstance(params.get('mining_job'), dict):
                raise ValueError('Invalid proof submission')
            submitted = params['mining_job']
            job = self.jobs.get(submitted.get('incomplete_header_bytes'))
            if not job or job['expires'] <= time.time():
                raise ValueError('Unknown or expired mining job')
            if submitted.get('cert_version') != 3 or int(submitted.get('target', 0)) != int(job['mining_job']['target']):
                raise ValueError('Mining job parameters were changed')
            receipt = await asyncio.to_thread(self.client.call, 'shares', {'jobId': job['id'], 'plainProof': params['plain_proof']})
            print(json.dumps({'event': 'accepted_share', 'id': receipt['id'], 'points': receipt['points'], 'epoch': receipt['epoch']}), flush=True)
            self.current = None
            return {'accepted': True, 'receipt': receipt['id']}
        raise ValueError('Unsupported mining method')

    async def connection(self, reader, writer):
        try:
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=90)
                if not line:
                    return
                request_id = None
                try:
                    if len(line) > MAX_LINE:
                        raise ValueError('Proof message too large')
                    request = json.loads(line)
                    if isinstance(request, dict):
                        request_id = request.get('id')
                    result = await self.dispatch(request)
                    response = {'jsonrpc': '2.0', 'id': request_id, 'result': result}
                except (ValueError, KeyError, TypeError, OSError) as error:
                    response = {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32001, 'message': str(error)[:240]}}
                writer.write((json.dumps(response) + '\n').encode())
                await writer.drain()
        except (asyncio.TimeoutError, ValueError, OSError):
            pass
        finally:
            writer.close()
            await writer.wait_closed()


async def run(endpoint, token, port):
    bridge = Bridge(PerlaClient(endpoint, token))
    server = await asyncio.start_server(bridge.connection, '127.0.0.1', port, limit=MAX_LINE)
    actual_port = server.sockets[0].getsockname()[1]
    print(f'Perla bridge ready on 127.0.0.1:{actual_port}. Waiting for the GPU miner.', flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8337)
    parser.add_argument('--check', action='store_true', help='Check the coordinator without running a miner')
    args = parser.parse_args()
    endpoint = os.environ.get('PERLA_ENDPOINT', '')
    token = os.environ.get('PERLA_WORKER_TOKEN', '')
    if args.check:
        data = PerlaClient(endpoint, token).call('work')
        print(json.dumps({'ready': True, 'protocol': data.get('protocol'), 'expires': data.get('expires')}))
    else:
        asyncio.run(run(endpoint, token, args.port))

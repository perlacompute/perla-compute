import json,os,urllib.request
request=urllib.request.Request('http://127.0.0.1:8766/health',headers={'Authorization':'Bearer '+os.environ['PERLA_VERIFIER_TOKEN']})
with urllib.request.urlopen(request,timeout=3) as response:data=json.load(response)
assert data.get('ready') is True and data.get('protocol')=='perla-pearl-plain-v3'
assert data.get('upstream_commit')=='82e6eee7076aafe10123e08db78f100d270c0582'

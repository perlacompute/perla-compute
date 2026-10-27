#!/usr/bin/env python3
"""Install an authenticated CPU native verifier without enabling work admission."""
import argparse,base64,hashlib,json,os,re,secrets,shutil,socket,struct,subprocess,sys,tempfile,time,urllib.error,urllib.parse,urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parent
COMMIT='82e6eee7076aafe10123e08db78f100d270c0582'
PROTOCOL='perla-pearl-plain-v3'
CONTAINER='perla-native-verifier'
IMAGE='perla-native-verifier:0.5.0'
CURRENT_PROTOCOL='perla-pearl-plain-v4'
LABEL='ai.perla.verifier-setup'
ROUTE='/__perla_verifier'
SNIPPET=Path('/etc/nginx/snippets/perla-verifier.conf')
MARKER='# Managed by Perla verifier setup v1'

def run(args,*,capture=False,data=None,cwd=None,timeout=None):
    result=subprocess.run(args,input=data,cwd=cwd,capture_output=capture,text=True,timeout=timeout)
    if result.returncode:raise RuntimeError('Command failed: '+' '.join(args[:3]))
    return result.stdout if capture else ''

def atomic(path,content,mode=0o600):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix='.perla-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as stream:stream.write(content)
        os.chmod(name,mode)
        if path.exists():os.chown(name,path.stat().st_uid,path.stat().st_gid)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def read_env(path):
    text=path.read_text();values={}
    for line in text.splitlines():
        match=re.match(r'^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$',line)
        if not match:continue
        key,value=match.groups()
        if key in values:raise ValueError('Duplicate environment key: '+key)
        if len(value)>=2 and value[0]==value[-1] and value[0] in ['"',"'"]:value=value[1:-1]
        values[key]=value
    return text,values

def update_env(text,updates):
    lines=text.splitlines();remaining=dict(updates)
    for index,line in enumerate(lines):
        match=re.match(r'^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=',line)
        if match and match[1] in remaining:lines[index]=match[1]+'='+remaining.pop(match[1])
    lines.extend(key+'='+value for key,value in remaining.items())
    return '\n'.join(lines)+'\n'

def tokens(text):
    """Small Nginx lexer retaining positions; ignores quoted/commented braces."""
    result=[];i=0
    while i<len(text):
        if text[i].isspace():i+=1;continue
        if text[i]=='#':
            newline=text.find('\n',i);i=len(text) if newline<0 else newline+1;continue
        start=i
        if text[i] in '{};':result.append((text[i],i,i+1));i+=1;continue
        value='';quote=None;literal=False
        while i<len(text):
            ch=text[i]
            if quote:
                if ch=='\\' and i+1<len(text):value+=text[i+1];i+=2;continue
                if ch==quote:quote=None;i+=1;continue
                value+=ch;i+=1;continue
            if ch in ['"',"'"]:quote=ch;literal=True;i+=1;continue
            if ch=='\\' and i+1<len(text):value+=text[i+1];literal=True;i+=2;continue
            if ch=='$' and text[i:i+2]=='${':
                end=text.find('}',i+2)
                if end<0:raise ValueError('Unclosed Nginx variable.')
                value+=text[i:end+1];i=end+1;continue
            if ch.isspace() or ch in '{};#':break
            value+=ch;i+=1
        if quote:raise ValueError('Unclosed Nginx string.')
        if i==start:raise ValueError('Could not parse Nginx configuration.')
        result.append(('\0'+value if literal and value in ['{','}',';'] else value,start,i))
    return result

def nginx_update(text,domain,snippet=None):
    snippet=snippet or SNIPPET
    words=tokens(text);stack=[];pairs={}
    for index,(word,_,_) in enumerate(words):
        if word=='{':stack.append(index)
        elif word=='}':
            if not stack:raise ValueError('Unbalanced Nginx braces.')
            pairs[stack.pop()]=index
    if stack:raise ValueError('Unbalanced Nginx braces.')
    selected=[];eligible=0
    for index in range(len(words)-1):
        if words[index][0]!='server' or words[index+1][0]!='{':continue
        opening=index+1;closing=pairs[opening];directives=[];current=[];cursor=opening+1
        while cursor<closing:
            word=words[cursor][0]
            if word=='{':current=[];cursor=pairs[cursor]+1;continue
            if word==';':directives.append(current);current=[]
            else:current.append(word)
            cursor+=1
        names=[word for directive in directives if directive and directive[0]=='server_name' for word in directive[1:]]
        tls=any(directive and directive[0]=='listen' and 'ssl' in directive and any(re.search(r'(?:^|:)443$',word) for word in directive[1:]) for directive in directives)
        if domain.lower() not in [name.lower() for name in names] or not tls:continue
        eligible+=1
        includes=[directive for directive in directives if directive==['include',str(snippet)]]
        if len(includes)>1:raise ValueError('Verifier snippet is included more than once.')
        if not includes:selected.append(words[closing][1])
    matched=any(words[index][0]=='server' and words[index+1][0]=='{' for index in range(len(words)-1))
    if not matched:raise ValueError('Nginx file contains no server block.')
    # Independently count matches, including an existing managed include.
    if not eligible:raise ValueError('No HTTPS server block found for '+domain+'. Pass the correct Nginx site file.')
    for position in sorted(selected,reverse=True):text=text[:position]+'    '+MARKER+'\n    include '+str(snippet)+';\n'+text[position:]
    return text

def snippet_text():
    content=MARKER+'\n'
    for suffix in ['/health','/verify']:
        content+='''location = %s%s {
    client_max_body_size 8m;
    proxy_pass http://127.0.0.1:8766%s;
    proxy_http_version 1.1;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Connection "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_send_timeout 15s;
    proxy_buffering off;
}
'''%(ROUTE,suffix,suffix)
    return content

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def request(base,path,token=None,payload=None,timeout=30):
    headers={'content-type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(base.rstrip('/')+path,headers=headers,data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=timeout) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:
        try:body=json.loads(error.read())
        except ValueError:body={}
        return error.code,body

def valid_health(data):
    return data.get('ready') is True and data.get('protocol')==PROTOCOL and data.get('upstream_commit')==COMMIT and data.get('mode')=='native-plain-proof' and CURRENT_PROTOCOL in data.get('supported_protocols',[])

def inspect_container():
    result=subprocess.run(['docker','inspect',CONTAINER],capture_output=True,text=True)
    if result.returncode:return None
    info=json.loads(result.stdout)[0]
    if info.get('Config',{}).get('Labels',{}).get(LABEL)!='v1':raise ValueError('Container name belongs to another setup; it was not replaced.')
    return info

def available_memory():
    return next((int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')),0)

def install(project,nginx_file):
    state=project/'data/verifier-setup';state.mkdir(parents=True,exist_ok=True);state.chmod(0o700)
    package=json.loads((project/'package.json').read_text())
    if package.get('name')!='perla-compute-vps':raise ValueError('Not the Perla VPS project.')
    env_path=project/'.env';env_original,env=read_env(env_path)
    if env.get('PERLA_MINING_ENABLED')=='true':raise ValueError('Pause work admission before installing or replacing the verifier.')
    origin=urllib.parse.urlsplit(env.get('PERLA_PUBLIC_ORIGIN',''))
    if origin.scheme!='https' or not origin.hostname or origin.port not in [None,443] or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ['', '/']:raise ValueError('PERLA_PUBLIC_ORIGIN must be the public HTTPS domain.')
    base=origin.scheme+'://'+origin.netloc+ROUTE
    if not re.fullmatch(r'[a-zA-Z0-9.-]+',origin.hostname):raise ValueError('Unsupported site hostname.')
    nginx_file=nginx_file.resolve();nginx_original=nginx_file.read_text();nginx_new=nginx_update(nginx_original,origin.hostname)
    if SNIPPET.exists() and SNIPPET.read_text()!=snippet_text():raise ValueError('Existing Nginx verifier snippet differs; it was not overwritten.')
    secret_file=state/'verifier.env'
    if secret_file.exists():
        _,secret_env=read_env(secret_file);token=secret_env.get('PERLA_VERIFIER_TOKEN','')
    else:token=secrets.token_hex(32)
    if not re.fullmatch(r'[a-f0-9]{64}',token):raise ValueError('Verifier secret file is invalid.')
    if env.get('PERLA_VERIFIER_URL') and env['PERLA_VERIFIER_URL'].rstrip('/')!=base:raise ValueError('Another verifier URL is already configured.')
    if env.get('PERLA_VERIFIER_TOKEN') and env['PERLA_VERIFIER_TOKEN']!=token:raise ValueError('Existing verifier secret does not match this installer state.')
    old=inspect_container()
    if not old:
        probe=socket.socket()
        try:probe.bind(('127.0.0.1',8766))
        except OSError:raise ValueError('Port 8766 is already in use; no container was replaced.')
        finally:probe.close()
    if shutil.disk_usage(project).free<15*1024**3:raise ValueError('At least 15 GiB free disk is required for the native build.')
    available=available_memory()
    if available<7*1024**3:raise ValueError('At least 7 GiB available RAM is required for this build/runtime profile.')
    dump=run(['nginx','-T'],capture=True)
    active=[Path(match[1]).resolve() for line in dump.splitlines() if (match:=re.match(r'^# configuration file (.+):$',line))]
    if nginx_file not in active:raise ValueError('The selected Nginx file is not loaded by the active configuration.')
    run(['nginx','-t']);run(['docker','compose','version'],capture=True)
    atomic(secret_file,'PERLA_VERIFIER_TOKEN='+token+'\n')
    print('Building native Pearl verifier. Cargo build jobs: 2. Runtime limit: 4 CPU / 5 GiB.',flush=True)
    run(['docker','build','--build-arg','CARGO_BUILD_JOBS=2','-t',IMAGE,str(ROOT/'native')])
    backup=state/('backup-'+time.strftime('%Y%m%d-%H%M%S')+'-'+str(os.getpid()));backup.mkdir(mode=0o700)
    originals={env_path:env_original,nginx_file:nginx_original,SNIPPET:SNIPPET.read_text() if SNIPPET.exists() else None}
    modes={path:path.stat().st_mode&0o777 if path.exists() else 0o644 for path in originals}
    for index,(path,content) in enumerate(originals.items()):
        if content is not None:atomic(backup/str(index),content)
    atomic(backup/'paths.json',json.dumps([str(path) for path in originals]))
    prior_name=None;candidate_requested=False;proxy_changed=False;env_changed=False
    try:
        if old:
            prior_name=CONTAINER+'-previous-'+str(os.getpid())
            run(['docker','stop',CONTAINER],capture=True);run(['docker','rename',CONTAINER,prior_name])
        candidate_requested=True
        run(['docker','run','-d','--name',CONTAINER,'--restart','unless-stopped','--memory','5g','--cpus','4','--pids-limit','128','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--security-opt','no-new-privileges','--cap-drop','ALL','--label',LABEL+'=v1','--env-file',str(secret_file),'-p','127.0.0.1:8766:8766',IMAGE],capture=True)
        for attempt in range(30):
            try:
                code,health=request('http://127.0.0.1:8766','/health',token,timeout=3)
                if code==200 and valid_health(health):break
            except (OSError,ValueError):pass
            time.sleep(1)
        else:raise RuntimeError('Native verifier did not become healthy. Inspect its Docker logs.')
        if request('http://127.0.0.1:8766','/health')[0]!=401:raise RuntimeError('Unauthenticated verifier request was not rejected.')
        # Source may have been edited while the lengthy build ran.
        if env_path.read_text()!=env_original or nginx_file.read_text()!=nginx_original:raise RuntimeError('Configuration changed during the build; review before retrying.')
        proxy_changed=True
        atomic(SNIPPET,snippet_text(),0o644);atomic(nginx_file,nginx_new,modes[nginx_file])
        run(['nginx','-t']);run(['systemctl','reload','nginx'])
        if request(base,'/health')[0]!=401:raise RuntimeError('Public verifier endpoint must reject missing authentication.')
        code,health=request(base,'/health',token)
        if code!=200 or not valid_health(health):raise RuntimeError('Authenticated HTTPS native health check failed.')
        header=struct.pack('<I',1)+hashlib.sha256(b'perla-verifier-installation-v1'+secrets.token_bytes(32)).digest()+hashlib.sha256(b'cpu-fixture-no-ledger-credit'+secrets.token_bytes(32)).digest()+struct.pack('<II',int(time.time()),0x1d00ffff)
        raw=run(['docker','exec','-i',CONTAINER,'python','/app/native-fixture.py'],capture=True,data=json.dumps({'header':base64.b64encode(header).decode()}),timeout=240)
        fixture=json.loads(raw);fixture['protocol']=CURRENT_PROTOCOL
        code,accepted=request(base,'/verify',token,fixture)
        if code!=200 or accepted.get('valid') is not True or accepted.get('protocol')!=CURRENT_PROTOCOL or accepted.get('upstream_commit')!=COMMIT:raise RuntimeError('A real native CPU fixture was not accepted.')
        altered=bytearray(header);altered[36]^=1
        negative={**fixture,'header':base64.b64encode(altered).decode()}
        rejected_code,rejected=request(base,'/verify',token,negative)
        if rejected_code not in [200,503] or rejected.get('valid') is True:raise RuntimeError('Changed-challenge fixture did not fail closed.')
        if env_path.read_text()!=env_original:raise RuntimeError('Environment changed during verification; it was not overwritten.')
        updated=update_env(env_original,{'PERLA_VERIFIER_URL':base,'PERLA_VERIFIER_TOKEN':token,'PERLA_MINING_ENABLED':'false'})
        atomic(env_path,updated);env_changed=True
        run(['docker','compose','up','-d','--no-build','--force-recreate','web'],cwd=project)
        web_script=(ROOT/'web-check.mjs').read_text()
        web=None;deadline=time.monotonic()+60
        print('Checking authenticated access from the web container.',flush=True)
        while time.monotonic()<deadline:
            try:
                raw=run(['docker','compose','exec','-T','web','node','--input-type=module','-e',web_script],cwd=project,capture=True,timeout=25)
                web=json.loads(raw);break
            except (RuntimeError,ValueError,subprocess.TimeoutExpired):time.sleep(1)
        if not web or web.get('ready') is not True or web.get('miningEnabled') is not False:raise RuntimeError('Web-to-verifier health did not pass with admission paused.')
        report={'verifierReady':True,'protocol':CURRENT_PROTOCOL,'supportedProtocols':[PROTOCOL,CURRENT_PROTOCOL],'upstreamCommit':COMMIT,'endpoint':base,'authenticatedHealthFromWeb':True,'missingAuthenticationRejected':True,'cpuNativeFixtureAccepted':True,'changedChallengeRejected':True,'gpuValidatedBySetup':False,'ledgerCreditBySetup':0,'miningEnabled':False,'rewardEpochFundedBySetup':False,'runtimeCpuLimit':4,'runtimeMemoryGiB':5,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        atomic(state/'public-report.json',json.dumps(report,indent=2)+'\n')
        if prior_name:
            subprocess.run(['docker','rm',prior_name],capture_output=True);prior_name=None
        print('Public verifier report (safe to share):',flush=True);print(json.dumps(report,indent=2))
    except Exception:
        if env_changed:
            atomic(env_path,env_original,modes[env_path]);subprocess.run(['docker','compose','up','-d','--no-build','--force-recreate','web'],cwd=project,capture_output=True)
        if proxy_changed:
            for path in [nginx_file,SNIPPET]:
                if originals[path] is None:path.unlink(missing_ok=True)
                else:atomic(path,originals[path],modes[path])
            if subprocess.run(['nginx','-t'],capture_output=True).returncode==0:subprocess.run(['systemctl','reload','nginx'],capture_output=True)
        if candidate_requested:subprocess.run(['docker','rm','-f',CONTAINER],capture_output=True)
        if prior_name:
            subprocess.run(['docker','rename',prior_name,CONTAINER],capture_output=True)
            if old.get('State',{}).get('Running'):subprocess.run(['docker','start',CONTAINER],capture_output=True)
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('project',type=Path);parser.add_argument('nginx_file',type=Path);args=parser.parse_args()
    try:install(args.project.resolve(),args.nginx_file)
    except Exception as error:
        print('Verifier setup stopped: '+str(error),file=sys.stderr)
        print('Mining admission was not enabled. Keep the installer state and send the error output for review.',file=sys.stderr)
        raise SystemExit(1)

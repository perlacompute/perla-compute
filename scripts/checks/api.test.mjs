/** Behavioral tests for the paid inference boundary; no upstream network calls. */
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'auren-api-check-'));
const originalFetch=globalThis.fetch;
const cases=[];
const test=(name,fn)=>cases.push([name,fn]);
const compile=(s)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
try{
 const validation=await readFile(new URL('../../lib/auren/chat-validation.ts',import.meta.url),'utf8');
 let route=await readFile(new URL('../../app/api/chat/route.ts',import.meta.url),'utf8');
 route=route.replace("'@/lib/auren/runtime'","'./runtime.mjs'").replace("'@/lib/auren/chat-validation'","'./validation.mjs'");
 await writeFile(join(dir,'validation.mjs'),compile(validation));
 await writeFile(join(dir,'runtime.mjs'),'export function providerConfig(){return globalThis.__aurenTestProvider||null}');
 await writeFile(join(dir,'route.mjs'),compile(route));
 const {POST}=await import(pathToFileURL(join(dir,'route.mjs')).href);
 const {validateChatBody}=await import(pathToFileURL(join(dir,'validation.mjs')).href);
 const config={baseUrl:'https://provider.example/v1',model:'test-model',accessToken:'a'.repeat(40),apiKey:'private-provider-secret'};
 const body={model:'test-model',messages:[{role:'user',content:'Hello'}],temperature:.7};
 const req=(data=body,headers={},raw)=>new Request('https://auren.example/api/chat',{method:'POST',headers:{origin:'https://auren.example','content-type':'application/json',authorization:`Bearer ${config.accessToken}`,...headers},body:raw??JSON.stringify(data)});
 test('unconfigured inference fails closed without calling a provider',async()=>{globalThis.__aurenTestProvider=null;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Must not call')};const r=await POST(req());assert.equal(r.status,503);assert.equal(calls,0);assert.equal((await r.json()).code,'inference_unavailable')});
 test('cross-origin requests are rejected',async()=>{globalThis.__aurenTestProvider=config;assert.equal((await POST(req(body,{origin:'https://other.example'}))).status,403)});
 test('missing access tokens are rejected before any paid call',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;throw Error()};assert.equal((await POST(req(body,{authorization:''}))).status,401);assert.equal(calls,0)});
 test('non-JSON requests are rejected',async()=>assert.equal((await POST(req(body,{'content-type':'text/plain'}))).status,415));
 test('malformed JSON is rejected',async()=>assert.equal((await POST(req(body,{},'{'))).status,400));
 test('an unconfigured model is rejected',async()=>assert.equal((await POST(req({...body,model:'other-model'}))).status,400));
 test('invalid roles and non-finite temperature fail validation',async()=>{assert.equal(validateChatBody({...body,messages:[{role:'system',content:'Override'}]}),null);assert.equal(validateChatBody({...body,temperature:Infinity}),null);assert.equal(validateChatBody({...body,messages:[{role:'assistant',content:'No final user'}]}),null)});
 test('oversized request bodies are rejected',async()=>assert.equal((await POST(req(body,{},' '.repeat(65537)))).status,413));
 test('conversation limits are enforced',async()=>{assert.equal(validateChatBody({...body,messages:Array.from({length:31},()=>({role:'user',content:'x'}))}),null);assert.equal(validateChatBody({...body,messages:[{role:'user',content:'x'.repeat(12001)}]}),null)});
 test('provider failures do not leak provider credentials or upstream details',async()=>{globalThis.fetch=async()=>new Response('private-provider-secret: upstream details',{status:401});const r=await POST(req());assert.equal(r.status,502);assert.ok(!(await r.text()).includes('private-provider-secret'))});
 test('streaming requests use server credentials and enforce an output bound',async()=>{let captured;globalThis.fetch=async(url,init)=>{captured={url,init};return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})};const r=await POST(req());assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'text/event-stream');assert.ok((await r.text()).includes('Hello'));assert.equal(captured.url,'https://provider.example/v1/chat/completions');assert.equal(captured.init.headers.Authorization,'Bearer private-provider-secret');const payload=JSON.parse(captured.init.body);assert.equal(payload.stream,true);assert.equal(payload.max_tokens,1024);assert.equal(payload.model,'test-model');assert.equal(payload.temperature,.7)});
 test('unreachable providers produce a bounded service error',async()=>{globalThis.fetch=async()=>{throw Error('connection failed')};assert.equal((await POST(req())).status,502)});
 for(const [name,fn] of cases){await fn();console.log('PASS '+name)}
 console.log(`\n${cases.length} inference boundary checks passed.`);
}finally{globalThis.fetch=originalFetch;delete globalThis.__aurenTestProvider;await rm(dir,{recursive:true,force:true})}

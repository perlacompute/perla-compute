#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { auditManifest } from './reward-manifest.mjs';
export { auditManifest } from './reward-manifest.mjs';

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const bytes=await readFile(process.argv[2]||'');if(bytes.length>8*1024*1024)throw Error('Manifest too large');console.log(JSON.stringify(auditManifest(JSON.parse(bytes)),null,2));}catch(e){console.error(e.message||'Audit failed');process.exitCode=1;}}

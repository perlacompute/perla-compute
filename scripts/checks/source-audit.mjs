/** Publication guard for common credentials and private runtime artifacts.
 * Reports paths/rule names only. It is not a comprehensive secret scanner. */
import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ignored = new Set(['.git', 'node_modules', '.next', '.sites-runtime', '__pycache__']);
const problems = [];
const report = (path, rule) => problems.push(`${path}: ${rule}`);

async function walk(folder) {
  const files = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue;
    const path = resolve(folder, item.name);
    if (item.isDirectory()) files.push(...await walk(path));
    else files.push(relative(root, path));
  }
  return files;
}

function privatePath(path) {
  const parts = path.split('/');
  const name = basename(path);
  if (name === '.env.example') return false;
  return parts.some(p => ignored.has(p) || ['data', 'verification', 'hf-cache', 'pearl-upstream', '.perla-backups'].includes(p))
    || /(^|\.)env(?:\.|$)/.test(name)
    || /\.(?:pem|key|p12|pfx|seed|mnemonic|sqlite(?:-wal|-shm)?|sqlite3|db(?:-wal|-shm)?|log|pyc|tsbuildinfo)$/.test(name);
}

const patterns = [
  ['private-key PEM material', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['provider credential', /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/],
  ['AWS access credential', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const paths = tracked.status === 0 && tracked.stdout.length
  ? tracked.stdout.split('\0').filter(Boolean)
  : await walk(root);

for (const path of paths) {
  if (privatePath(path)) report(path, 'private runtime path');
  const info = await lstat(resolve(root, path));
  if (info.isSymbolicLink()) { report(path, 'source symlink requires review'); continue; }
  if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
  const bytes = await readFile(resolve(root, path));
  if (bytes.includes(0)) continue;
  const value = bytes.toString('utf8');
  for (const [name, pattern] of patterns) if (pattern.test(value)) report(path, name);
  if (basename(path) === '.env.example') {
    for (const line of value.split('\n')) {
      const match = line.match(/^\s*([A-Z_]*(?:TOKEN|SECRET|PRIVATE_KEY|API_KEY))\s*=\s*(.*?)\s*$/);
      if (match && !['', '""', "''"].includes(match[2])) report(path, 'credential example must be blank');
    }
  }
}

for (const path of paths.filter(p => p.startsWith('public/downloads/') && p.endsWith('.tar.gz'))) {
  const archive = spawnSync('tar', ['-tzf', resolve(root, path)], { encoding: 'utf8' });
  if (archive.status !== 0) { report(path, 'unreadable download archive'); continue; }
  for (const entry of archive.stdout.split('\n').filter(Boolean)) {
    if (entry.startsWith('/') || entry.split('/').includes('..') || privatePath(entry)) {
      report(path, 'unsafe/private member in download archive');
      break;
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Source audit passed for ${paths.length} files; no disallowed runtime paths or recognized credential patterns found.`);
}

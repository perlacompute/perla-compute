import { cp, mkdir } from 'node:fs/promises';
// Next standalone output does not automatically copy static/public assets.
await mkdir('.next/standalone/.next', { recursive: true });
await cp('public', '.next/standalone/public', { recursive: true });
await cp('.next/static', '.next/standalone/.next/static', { recursive: true });

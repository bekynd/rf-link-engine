// Regenerates test/golden/native.txt: runs the verification cases through the native NTIA build
// (build/harness, from native/build.sh) inside the pinned Docker image, or directly with --direct
// (CI on Linux). Usage: node scripts/native-golden.ts [--direct]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseLine, generateCases } from '../test/cases.ts';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = generateCases().map(caseLine).join('\n') + '\n';
const direct = process.argv.includes('--direct');

const output = direct
  ? execFileSync(path.join(pkg, 'build', 'harness'), { input, maxBuffer: 1 << 28 })
  : execFileSync('docker', ['run', '--rm', '-i', '-v', `${pkg}:/src`, '-w', '/src', 'emscripten/emsdk:4.0.10', 'build/harness'],
      { input, maxBuffer: 1 << 28, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });

fs.mkdirSync(path.join(pkg, 'test', 'golden'), { recursive: true });
fs.writeFileSync(path.join(pkg, 'test', 'golden', 'native.txt'), output);
console.log(`wrote ${output.toString().trim().split('\n').length} native results`);

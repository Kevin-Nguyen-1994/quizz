import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const projectRoot = path.resolve(serverDir, '..');
const outDir = path.join(projectRoot, 'artifacts', 'server-dist');
const tsc = path.join(serverDir, 'node_modules', 'typescript', 'bin', 'tsc');

if (!outDir.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error(`Refusing to clean output outside project: ${outDir}`);
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
const result = spawnSync(
  process.execPath,
  [tsc, '--project', path.join(serverDir, 'tsconfig.json'), '--outDir', outDir],
  { cwd: serverDir, stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await fs.access(path.join(outDir, 'index.js'));
process.stdout.write(`Backend artifact built at ${outDir}\n`);

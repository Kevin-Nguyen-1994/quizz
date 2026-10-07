import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = { file: '', dataDir: '', dryRun: false, applyUpdates: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--dry-run') options.dryRun = true;
    else if (key === '--apply-updates') options.applyUpdates = true;
    else if ((key === '--file' || key === '--data-dir') && argv[index + 1]) {
      options[key === '--file' ? 'file' : 'dataDir'] = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown or incomplete argument: ${key}`);
  }
  if (!options.file) throw new Error('--file is required');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dataDir) process.env.DATA_DIR = path.resolve(options.dataDir);
  const database = require('../../artifacts/server-dist/db.js');
  const importer = require('../../artifacts/server-dist/questionBankImport.js');
  await database.initDb();
  try {
    const result = await importer.importSourceQuestionBank(path.resolve(options.file), {
      dryRun: options.dryRun,
      applyUpdates: options.applyUpdates,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await database.db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

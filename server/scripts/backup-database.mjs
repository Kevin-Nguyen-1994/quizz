import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_DATABASE = path.join(PROJECT_ROOT, 'data', 'quizz.db');
const DEFAULT_BACKUP_DIR = path.join(PROJECT_ROOT, 'data', 'backups', 'daily');
const DEFAULT_LOG = path.join(PROJECT_ROOT, 'logs', 'backup.log');
const COUNT_TABLES = [
  'quizzes',
  'questions',
  'users',
  'assignments',
  'assignment_attempts',
  'attempt_answers',
];

function parseArgs(argv) {
  const options = {
    database: DEFAULT_DATABASE,
    backupDir: DEFAULT_BACKUP_DIR,
    log: DEFAULT_LOG,
    retention: 30,
    verifyOnly: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--database' && value) options.database = path.resolve(value);
    else if (key === '--backup-dir' && value) options.backupDir = path.resolve(value);
    else if (key === '--log' && value) options.log = path.resolve(value);
    else if (key === '--retention' && value) options.retention = Number.parseInt(value, 10);
    else if (key === '--verify-only' && value) options.verifyOnly = path.resolve(value);
    else throw new Error(`Unknown or incomplete argument: ${key}`);
    index += 1;
  }
  if (!Number.isInteger(options.retention) || options.retention < 1) {
    throw new Error('Retention must be a positive integer.');
  }
  return options;
}

function localTimestamp(date = new Date()) {
  const part = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

function quoteSqliteString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function appendLog(logPath, level, message) {
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line, 'utf8');
  process.stdout.write(line);
}

async function verifyDatabase(filename) {
  const database = await open({
    filename,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });
  try {
    const integrityRows = await database.all('PRAGMA integrity_check');
    const integrity = integrityRows.map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity.join('; ')}`);
    }
    const counts = {};
    for (const table of COUNT_TABLES) {
      const row = await database.get(`SELECT COUNT(*) AS count FROM "${table}"`);
      counts[table] = row.count;
    }
    return { integrity: 'ok', counts };
  } finally {
    await database.close();
  }
}

async function pruneBackups(backupDir, retention, logPath) {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = entries
    .filter((entry) => entry.isFile() && /^quizz-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const filename of backups.slice(retention)) {
    await fs.unlink(path.join(backupDir, filename));
    await appendLog(logPath, 'INFO', `Retention removed ${filename}`);
  }
}

async function createBackup(options) {
  let source;
  let temporaryPath;
  try {
    await fs.access(options.database);
    await fs.mkdir(options.backupDir, { recursive: true });
    const filename = `quizz-${localTimestamp()}.db`;
    const finalPath = path.join(options.backupDir, filename);
    temporaryPath = `${finalPath}.tmp`;
    await fs.rm(temporaryPath, { force: true });
    source = await open({ filename: options.database, driver: sqlite3.Database });
    await source.exec('PRAGMA busy_timeout = 30000');
    await source.exec(`VACUUM INTO ${quoteSqliteString(temporaryPath)}`);
    await source.close();
    source = null;

    const verification = await verifyDatabase(temporaryPath);
    await fs.rename(temporaryPath, finalPath);
    await appendLog(
      options.log,
      'INFO',
      `Backup completed ${finalPath}; integrity=ok; counts=${JSON.stringify(verification.counts)}`,
    );
    await pruneBackups(options.backupDir, options.retention, options.log);
    return { backup: finalPath, ...verification };
  } catch (error) {
    if (source) await source.close().catch(() => {});
    if (temporaryPath) await fs.rm(temporaryPath, { force: true }).catch(() => {});
    await appendLog(options.log, 'ERROR', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.verifyOnly) {
    const result = await verifyDatabase(options.verifyOnly);
    process.stdout.write(`${JSON.stringify({ backup: options.verifyOnly, ...result })}\n`);
    return;
  }
  const result = await createBackup(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

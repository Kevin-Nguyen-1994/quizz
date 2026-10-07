import path from 'node:path';
import process from 'node:process';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

function databaseArgument(argv) {
  const index = argv.indexOf('--database');
  if (index < 0 || !argv[index + 1]) throw new Error('--database is required');
  return path.resolve(argv[index + 1]);
}

async function main() {
  const filename = databaseArgument(process.argv.slice(2));
  const database = await open({
    filename,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });
  try {
    const attempts = await database.all(
      `SELECT id, assignment_id, user_id, current_question_index,
              current_question_started_at_ms, last_activity_at_ms, started_at_ms
       FROM assignment_attempts
       WHERE status = 'in_progress'
       ORDER BY COALESCE(last_activity_at_ms, current_question_started_at_ms, started_at_ms) DESC`,
    );
    process.stdout.write(
      `${JSON.stringify({ database: filename, activeCount: attempts.length, attempts })}\n`,
    );
    if (attempts.length > 0) process.exitCode = 3;
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

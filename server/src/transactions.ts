import type { Database } from 'sqlite';
import { db } from './db';

// The sqlite wrapper exposes one shared connection. Serialize every transaction
// using this helper so concurrent requests cannot overlap BEGIN/COMMIT calls.
let transactionTail: Promise<void> = Promise.resolve();

export async function withImmediateTransaction<T>(
  work: (database: Database) => Promise<T>,
): Promise<T> {
  let release = () => {};
  const previous = transactionTail;
  transactionTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    await db.run('BEGIN IMMEDIATE');
    try {
      const result = await work(db);
      await db.run('COMMIT');
      return result;
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  } finally {
    release();
  }
}

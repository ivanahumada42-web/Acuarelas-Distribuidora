import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { AsyncLocalStorage } from 'node:async_hooks';

export function openDatabase(filename) {
  const remote = Boolean(process.env.TURSO_DATABASE_URL);
  if (process.env.VERCEL && !remote) throw new Error('Configure TURSO_DATABASE_URL antes de desplegar.');
  const client = remote ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }) : new DatabaseSync(filename);
  const context = new AsyncLocalStorage();
  let tail = Promise.resolve();
  const exclusive = async fn => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); } finally { release(); }
  };
  const execute = async (sql, args, mode) => {
    const action = async () => {
      if (!remote) return client.prepare(sql)[mode](...args);
      const result = await (context.getStore() || client).execute({ sql, args });
      if (mode === 'run') return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
      const rows = result.rows.map(row => Object.fromEntries(result.columns.map(column => [column, row[column]])));
      return mode === 'get' ? rows[0] : rows;
    };
    return !remote && !context.getStore() ? exclusive(action) : action();
  };
  const db = {
    prepare(sql) { return { sql, get: (...args) => execute(sql, args, 'get'), all: (...args) => execute(sql, args, 'all'), run: (...args) => execute(sql, args, 'run') }; },
    async exec(sql) { return remote ? client.executeMultiple(sql) : exclusive(() => client.exec(sql)); },
    async transaction(fn) {
      const action = async () => {
        const tx = remote ? await client.transaction('write') : client;
        if (!remote) client.exec('BEGIN IMMEDIATE');
        try {
          const result = await context.run(tx, fn);
          if (remote) await tx.commit(); else client.exec('COMMIT');
          return result;
        } catch (error) {
          if (remote) await tx.rollback(); else client.exec('ROLLBACK');
          throw error;
        } finally { if (remote) tx.close(); }
      };
      return remote ? action() : exclusive(action);
    },
    async batch(statements) {
      if (remote) return client.batch(statements, 'write');
      return db.transaction(async () => { for (const statement of statements) client.prepare(statement.sql).run(...statement.args); });
    },
    close() { client.close(); },
  };
  return db;
}

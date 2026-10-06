import assert from 'node:assert/strict';
import { openDatabase } from '../database.mjs';
import { put, del } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

const name = 'deployment_check_' + randomBytes(6).toString('hex');
const db = openDatabase('unused.sqlite');
try {
  await db.exec(`CREATE TABLE ${name}(id INTEGER PRIMARY KEY, value INTEGER)`);
  await db.prepare(`INSERT INTO ${name} VALUES (?,?)`).run(1, 10);
  await assert.rejects(db.transaction(async () => {
    await db.prepare(`UPDATE ${name} SET value=20 WHERE id=1`).run();
    throw new Error('rollback test');
  }));
  assert.equal((await db.prepare(`SELECT value FROM ${name}`).get()).value,10);
  await db.transaction(async()=>await db.prepare(`UPDATE ${name} SET value=30 WHERE id=1`).run());
  assert.equal((await db.prepare(`SELECT value FROM ${name}`).get()).value,30);
  await db.exec(`CREATE VIRTUAL TABLE ${name}_fts USING fts5(text)`);
  await db.prepare(`INSERT INTO ${name}_fts VALUES(?)`).run('lápices');
  assert.equal((await db.prepare(`SELECT count(*) n FROM ${name}_fts WHERE ${name}_fts MATCH ?`).get('lapices')).n,1);
  const blob = await put(`deployment-check/${name}.txt`, 'Verificación temporal de almacenamiento', {access:'public'});
  assert.ok(blob.url.startsWith('https://'));
  await del(blob.url);
  console.log('Turso: lectura, escritura, transacciones y búsqueda verificadas. Blob: carga y eliminación verificadas.');
} finally {
  await db.exec(`DROP TABLE IF EXISTS ${name}_fts; DROP TABLE IF EXISTS ${name};`);
  db.close();
}

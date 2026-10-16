import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

try {
  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('SaidHere database schema is up to date.');
} finally {
  await pool.end();
}

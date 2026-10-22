import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const customerSourcePath = path.join(serverRoot, 'src', 'customer_portal.js');
const customerRuntimePath = path.join(serverRoot, 'src', 'customer_portal.runtime.js');

// The production server now runs the reviewed source directly. This one temporary
// compatibility patch remains because the older customer portal query orders an
// aggregate by o.started_at without including it in PostgreSQL GROUP BY.
let customerSource = fs.readFileSync(customerSourcePath, 'utf8');
const marker = '      group by w.id\n      order by o.started_at desc`';
if (!customerSource.includes(marker)) {
  throw new Error('Could not find the customer Walls GROUP BY marker.');
}
customerSource = customerSource.replace(
  marker,
  '      group by w.id, o.started_at\n      order by o.started_at desc`',
);
fs.writeFileSync(customerRuntimePath, customerSource, 'utf8');
console.log('Prepared SaidHere customer portal runtime compatibility file.');

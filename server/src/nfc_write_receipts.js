import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_MINUTES = 10;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function parseCookies(req) {
  const result = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(part.slice(at + 1).trim()); }
    catch (_) { result[key] = part.slice(at + 1).trim(); }
  }
  return result;
}

async function requireOwner(req, res, next) {
  try {
    const raw = parseCookies(req)[ADMIN_COOKIE] || '';
    if (!raw) return res.status(401).json({ error: 'Admin sign-in required.' });
    const result = await pool.query(
      `select u.id, u.username, u.display_name, u.role
         from admin_sessions s
         join admin_users u on u.id = s.admin_user_id
        where s.token_hash = $1
          and s.expires_at > now()
          and u.active = true
        limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0 || result.rows[0].role !== 'owner') {
      return res.status(403).json({ error: 'Main Admin access required.' });
    }
    req.nfcAdmin = {
      ...result.rows[0],
      csrf: hashToken(`admin-csrf:${raw}`),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!req.nfcAdmin?.csrf || clean(req.body?._csrf) !== req.nfcAdmin.csrf) {
    return res.status(403).json({ error: 'Request expired. Refresh Orders and try again.' });
  }
  return next();
}

function fullNfcUrl(value) {
  const raw = clean(value);
  return /^https:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function nfcValueHash(value) {
  return hashToken(`nfc-write-value:${clean(value)}`);
}

async function issueReceipt(orderId, itemId) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const found = await client.query(
      `select i.id, i.order_id, i.wall_id, i.ordinal, i.status, i.nfc_write_value,
              i.tagged_at, o.status as order_status
         from commerce_order_items i
         join commerce_orders o on o.id = i.order_id
        where i.id = $1 and i.order_id = $2
        for update of i`,
      [itemId, orderId],
    );
    if (found.rowCount === 0) throw new Error('Wall item not found.');
    const item = found.rows[0];
    if (item.order_status !== 'paid' || item.status !== 'awaiting_fulfillment') {
      throw new Error('This Wall is no longer waiting for fulfilment.');
    }
    if (!item.wall_id || !clean(item.nfc_write_value)) {
      throw new Error('This Wall does not have an NFC value ready to write.');
    }

    // Retire any older write attempt for this item. Only the most recent button
    // press can confirm a physical write.
    await client.query(
      `update nfc_write_receipts
          set used_at = coalesce(used_at, now())
        where order_item_id = $1 and used_at is null`,
      [item.id],
    );

    const raw = makeToken(32);
    await client.query(
      `insert into nfc_write_receipts
         (order_item_id, token_hash, nfc_value_hash, expires_at)
       values ($1, $2, $3, now() + interval '${RECEIPT_MINUTES} minutes')`,
      [item.id, hashToken(raw), nfcValueHash(item.nfc_write_value)],
    );
    await client.query('commit');

    const value = fullNfcUrl(item.nfc_write_value);
    const deepLink = `saidhere://write-nfc?value=${encodeURIComponent(value)}&receipt=${encodeURIComponent(raw)}`;
    return { deepLink, ordinal: item.ordinal };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function redeemReceipt(rawReceipt) {
  const receipt = clean(rawReceipt);
  if (receipt.length < 20 || receipt.length > 200) throw new Error('Invalid NFC write receipt.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const found = await client.query(
      `select r.id as receipt_id, r.nfc_value_hash,
              i.id as item_id, i.order_id, i.wall_id, i.ordinal, i.status,
              i.nfc_write_value, i.tagged_at, o.status as order_status
         from nfc_write_receipts r
         join commerce_order_items i on i.id = r.order_item_id
         join commerce_orders o on o.id = i.order_id
        where r.token_hash = $1
          and r.used_at is null
          and r.expires_at > now()
        limit 1
        for update of r, i`,
      [hashToken(receipt)],
    );
    if (found.rowCount === 0) throw new Error('This NFC write confirmation has expired or was already used.');
    const row = found.rows[0];
    if (row.order_status !== 'paid' || row.status !== 'awaiting_fulfillment') {
      throw new Error('This order item is no longer waiting for fulfilment.');
    }
    if (!row.wall_id || !clean(row.nfc_write_value)) throw new Error('The Wall NFC value is no longer available.');
    if (nfcValueHash(row.nfc_write_value) !== row.nfc_value_hash) {
      throw new Error('The NFC value changed after this write attempt started.');
    }

    await client.query(
      `update commerce_order_items
          set tagged_at = coalesce(tagged_at, now())
        where id = $1`,
      [row.item_id],
    );
    await client.query(`update nfc_write_receipts set used_at = now() where id = $1`, [row.receipt_id]);
    await client.query(
      `insert into admin_audit_log
         (admin_user_id, username_snapshot, action, wall_id, details)
       values (null, 'native-nfc-writer', 'order.wall_tagged_after_nfc_write', $1, $2::jsonb)`,
      [row.wall_id, JSON.stringify({ order_id: row.order_id, item_id: row.item_id, ordinal: row.ordinal })],
    );
    await client.query('commit');
    return { orderId: row.order_id, itemId: row.item_id, ordinal: row.ordinal };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

export function mountNfcWriteReceipts(app) {
  app.post(
    '/admin/orders/:orderId/items/:itemId/write-ticket',
    requireOwner,
    requireCsrf,
    async (req, res) => {
      try {
        const ticket = await issueReceipt(req.params.orderId, req.params.itemId);
        return res.json({
          ok: true,
          deep_link: ticket.deepLink,
          ordinal: ticket.ordinal,
          expires_in_seconds: RECEIPT_MINUTES * 60,
        });
      } catch (error) {
        return res.status(400).json({ error: error?.message || 'Could not start NFC writing.' });
      }
    },
  );

  app.post('/api/fulfilment/nfc-written', async (req, res) => {
    try {
      const tagged = await redeemReceipt(req.body?.receipt);
      return res.json({ ok: true, tagged: true, ...tagged });
    } catch (error) {
      return res.status(400).json({ error: error?.message || 'Could not confirm the NFC write.' });
    }
  });
}

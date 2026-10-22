import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

const COOKIE_NAME = 'the_wall_admin';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseCookies(req) {
  const cookies = {};
  for (const item of (req.get('cookie') || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(item.slice(index + 1).trim()); }
    catch (_) { cookies[key] = item.slice(index + 1).trim(); }
  }
  return cookies;
}

async function ownerSession(req) {
  const raw = parseCookies(req)[COOKIE_NAME] || '';
  if (!raw) return null;
  const result = await pool.query(
    `select u.id, u.username, u.role
       from admin_sessions s
       join admin_users u on u.id = s.admin_user_id
      where s.token_hash = $1
        and s.expires_at > now()
        and u.active = true
      limit 1`,
    [hashToken(raw)],
  );
  if (result.rowCount === 0 || result.rows[0].role !== 'owner') return null;
  return {
    ...result.rows[0],
    raw,
    csrf: hashToken(`admin-csrf:${raw}`),
  };
}

function messagePage(title, message, href = '/admin/walls', label = 'Back to Walls') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · The Wall Admin</title><style>*{box-sizing:border-box}body{margin:0;background:#eee8de;color:#181512;font-family:Inter,Arial,sans-serif;padding:20px}.card{max-width:600px;margin:8vh auto;padding:28px;background:#fffdf9;border:1px solid #d9cfbf;border-radius:14px}.card h1{margin-top:0}.card p{color:#625b52;line-height:1.55}.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;margin-top:12px;padding:10px 15px;border-radius:8px;background:#181512;color:#fff;text-decoration:none;font-weight:900}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button" href="${escapeHtml(href)}">${escapeHtml(label)}</a></main></body></html>`;
}

async function replaceNfc(wallId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const wallResult = await client.query(
      `select id, display_name from walls where id = $1 for update`,
      [wallId],
    );
    if (wallResult.rowCount === 0) throw new Error('Wall not found.');
    const raw = makeToken(36);
    await client.query(`update wall_tags set active = false where wall_id = $1 and active = true`, [wallId]);
    const tagResult = await client.query(
      `insert into wall_tags (wall_id, token_hash, active)
       values ($1, $2, true)
       returning id`,
      [wallId, hashToken(raw)],
    );
    // Keep physical-inventory linkage aligned with the currently active NFC tag.
    await client.query(
      `update plaques
          set wall_tag_id = $2, assigned_at = now()
        where wall_id = $1`,
      [wallId, tagResult.rows[0].id],
    );
    await client.query('commit');
    return {
      wall: wallResult.rows[0],
      url: `${(process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '')}/t/${raw}`,
    };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function writeAudit(user, action, wall, details = {}) {
  try {
    await pool.query(
      `insert into admin_audit_log
         (admin_user_id, username_snapshot, action, wall_id, wall_name, details)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [user.id, user.username, action, wall.id, wall.display_name, JSON.stringify(details)],
    );
  } catch (error) {
    console.error('[admin-wall-safety-audit]', error);
  }
}

export function mountAdminWallSafety(app) {
  app.post('/admin/walls/:wallId/replace-nfc', async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.wallId || '')) return res.status(400).type('html').send(messagePage('Invalid Wall', 'That Wall ID is not valid.'));
      const user = await ownerSession(req);
      if (!user) return next();
      if (clean(req.body?._csrf) !== user.csrf) return res.status(403).type('html').send(messagePage('Request expired', 'Refresh the Wall page and try again.'));
      if (clean(req.body?.confirmation) !== 'REPLACE') return res.status(400).type('html').send(messagePage('Confirmation required', 'Type REPLACE exactly to replace the NFC URL.'));

      const result = await replaceNfc(req.params.wallId);
      await writeAudit(user, 'wall.replace_nfc', result.wall);
      return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NFC replaced · The Wall Admin</title><style>*{box-sizing:border-box}body{margin:0;background:#eee8de;color:#181512;font-family:Inter,Arial,sans-serif;padding:20px}.card{max-width:680px;margin:6vh auto;padding:28px;background:#fffdf9;border:2px solid #181512;border-radius:14px}.card code{display:block;margin:16px 0;padding:13px;background:#f1ebe1;border-radius:8px;word-break:break-all}.button{display:inline-flex;min-height:44px;align-items:center;padding:10px 15px;border-radius:8px;background:#181512;color:#fff;text-decoration:none;font-weight:900}</style></head><body><main class="card"><h1>NFC replaced.</h1><p>The previous NFC URL is disabled. Program this exact replacement URL into the physical Wall now. The raw token is shown only on this page.</p><code>${escapeHtml(result.url)}</code><a class="button" href="/admin/walls/${encodeURIComponent(result.wall.id)}">Back to Wall</a></main></body></html>`);
    } catch (error) {
      return res.status(400).type('html').send(messagePage('Could not replace NFC', error?.message || 'The NFC URL could not be replaced.'));
    }
  });

  app.post('/admin/walls/:wallId/delete', async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.wallId || '')) return next();
      const user = await ownerSession(req);
      if (!user) return next();
      if (clean(req.body?._csrf) !== user.csrf) return res.status(403).type('html').send(messagePage('Request expired', 'Refresh the Wall page and try again.'));

      const protectedResult = await pool.query(
        `select exists(select 1 from wall_ownerships where wall_id = $1) as has_owner,
                exists(select 1 from plaques where wall_id = $1) as has_physical,
                exists(select 1 from commerce_order_items where wall_id = $1) as has_order`,
        [req.params.wallId],
      );
      const state = protectedResult.rows[0];
      if (!state?.has_owner && !state?.has_physical && !state?.has_order) return next();

      return res.status(409).type('html').send(messagePage(
        'Purchased Wall cannot be deleted',
        'This Wall is linked to a customer purchase or physical Wall. Deactivate it, transfer ownership, or replace its NFC instead. Deleting it would destroy purchase and ownership history.',
        `/admin/walls/${encodeURIComponent(req.params.wallId)}`,
        'Back to Wall',
      ));
    } catch (error) {
      return next(error);
    }
  });
}

import express from 'express';

import { hashToken } from './auth.js';
import { pool } from './db.js';

const CUSTOMER_COOKIE = 'the_wall_customer';

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

function csrf(raw) {
  return hashToken(`customer-csrf:${raw}`);
}

async function requireCustomer(req, res, next) {
  try {
    const raw = parseCookies(req)[CUSTOMER_COOKIE] || '';
    if (!raw) return res.redirect(303, `/my-walls/login?next=${encodeURIComponent(req.originalUrl)}`);
    const result = await pool.query(
      `update customer_sessions s
          set last_seen_at = now()
         from customer_accounts c
        where s.token_hash = $1
          and s.customer_id = c.id
          and s.expires_at > now()
          and c.active = true
      returning s.id as session_id, c.id, c.email, c.display_name`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) {
      return res.redirect(303, `/my-walls/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    req.plaqueCustomer = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      displayName: result.rows[0].display_name,
      raw,
      csrf: csrf(raw),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!req.plaqueCustomer?.csrf || clean(req.body?._csrf) !== req.plaqueCustomer.csrf) {
    return res.status(403).type('html').send('Request expired. Scan the plaque again and retry.');
  }
  return next();
}

async function setupWallForToken(customerId, rawToken) {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.setup_required,
            p.serial_code, o.id as ownership_id
       from wall_tags t
       join walls w on w.id = t.wall_id
       join wall_ownerships o on o.wall_id = w.id and o.ended_at is null
       left join plaques p on p.wall_tag_id = t.id
      where t.token_hash = $1
        and t.active = true
        and w.active = true
        and o.customer_id = $2
      limit 1`,
    [hashToken(rawToken), customerId],
  );
  return result.rows[0] || null;
}

function setupPage({ customer, token, wall, error = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Set up your Wall</title><style>
    *{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:540px;margin:5vh auto;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;padding:26px;box-shadow:0 18px 48px rgba(25,20,15,.18)}.logo{display:block;width:104px;margin:0 auto 18px}.eyebrow{text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:1.6px;color:#796f63;font-weight:950}.card h1{text-align:center;margin:7px 0 8px;font-size:31px;letter-spacing:-.8px}.intro{text-align:center;color:#625a50;line-height:1.5;margin:0 0 22px}.serial{width:max-content;max-width:100%;margin:0 auto 20px;padding:7px 10px;border-radius:999px;background:#eee7dc;color:#6b635a;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.7px}.field{display:flex;flex-direction:column;gap:6px;margin:0 0 13px}.field label{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.field input{min-height:50px;padding:11px 12px;border:1px solid #9d917f;border-radius:8px;background:#fffdf8;font:inherit}.button{display:flex;width:100%;min-height:50px;align-items:center;justify-content:center;margin-top:9px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900;cursor:pointer}.error{padding:11px 13px;margin-bottom:14px;background:#f0d8d3;border-left:4px solid #963c33;border-radius:8px}.help{font-size:12px;line-height:1.5;color:#7b7266}.account{margin-top:18px;padding-top:15px;border-top:1px solid #e1d8ca;color:#756d63;font-size:11px;text-align:center}@media(max-width:520px){.card{padding:22px 18px;margin:3vh auto}.card h1{font-size:28px}}
  </style></head><body><div class="shade"><main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><div class="eyebrow">First scan</div><h1>Make this Wall yours.</h1><p class="intro">Name the place and add a location. You can change both later from My Walls.</p>${wall.serial_code ? `<div class="serial">Plaque ${escapeHtml(wall.serial_code)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/setup/${encodeURIComponent(token)}"><input type="hidden" name="_csrf" value="${escapeHtml(customer.csrf)}"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required autofocus placeholder="e.g. The Royal Hotel — Men's Bathroom"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" required placeholder="e.g. Singleton NSW"></div><button class="button" type="submit">Finish Wall setup</button></form><p class="help">This setup is only available to the customer account that purchased this plaque.</p><div class="account">Signed in as ${escapeHtml(customer.email)}</div></main></div></body></html>`;
}

function completePage({ token, wall }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wall ready</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:520px;margin:8vh auto;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;padding:28px;text-align:center}.logo{width:108px}.card h1{font-size:31px;margin:16px 0 8px}.card p{color:#625a50;line-height:1.5}.button{display:flex;min-height:50px;align-items:center;justify-content:center;margin-top:12px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}.button.secondary{background:#fffaf1;color:#171411}</style></head><body><div class="shade"><main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>${escapeHtml(wall.display_name)} is ready.</h1><p>${escapeHtml(wall.location_hint)}</p><p>From now on, scanning this plaque opens the Wall and grants the normal in-person writing window.</p><a class="button" href="/t/${encodeURIComponent(token)}">Open this Wall</a><a class="button secondary" href="/my-walls/${encodeURIComponent(wall.id)}">Manage in My Walls</a></main></div></body></html>`;
}

export function mountPlaqueSetup(app) {
  // Browser scans that have not been configured yet go straight into the owner setup flow.
  app.get('/t/:token', async (req, res, next) => {
    try {
      const token = clean(req.params.token);
      if (token.length < 20 || token.length > 200) return next();
      const found = await pool.query(
        `select 1
           from wall_tags t
           join walls w on w.id = t.wall_id
          where t.token_hash = $1 and t.active = true and w.active = true and w.setup_required = true
          limit 1`,
        [hashToken(token)],
      );
      if (found.rowCount === 0) return next();
      return res.redirect(303, `/my-walls/setup/${encodeURIComponent(token)}`);
    } catch (error) {
      return next(error);
    }
  });

  // Installed apps use the JSON API. Intercept only first-time plaques; configured
  // plaques continue to the original anonymous visit/write-access route.
  app.post('/api/tags/open', async (req, res, next) => {
    try {
      const token = clean(req.body?.token);
      if (token.length < 20 || token.length > 200) return next();
      const found = await pool.query(
        `select 1
           from wall_tags t
           join walls w on w.id = t.wall_id
          where t.token_hash = $1 and t.active = true and w.active = true and w.setup_required = true
          limit 1`,
        [hashToken(token)],
      );
      if (found.rowCount === 0) return next();
      const url = `${(process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '')}/my-walls/setup/${encodeURIComponent(token)}`;
      return res.status(409).json({
        error: 'This plaque needs first-time owner setup.',
        setup_required: true,
        setup_url: url,
      });
    } catch (error) {
      return next(error);
    }
  });

  const router = express.Router();
  router.use(requireCustomer);

  router.get('/:token', async (req, res, next) => {
    try {
      const token = clean(req.params.token);
      const wall = await setupWallForToken(req.plaqueCustomer.id, token);
      if (!wall) return res.status(404).type('html').send('This plaque is not assigned to your account.');
      if (!wall.setup_required) return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}`);
      return res.type('html').send(setupPage({ customer: req.plaqueCustomer, token, wall }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:token', requireCsrf, async (req, res, next) => {
    const token = clean(req.params.token);
    const displayName = clean(req.body?.display_name);
    const location = clean(req.body?.location_hint);
    try {
      if (!displayName || displayName.length > 80) throw new Error('Wall name must be between 1 and 80 characters.');
      if (!location || location.length > 120) throw new Error('Location must be between 1 and 120 characters.');
      const client = await pool.connect();
      let updated;
      try {
        await client.query('begin');
        const owned = await client.query(
          `select w.id, w.slug, w.display_name, w.location_hint, w.setup_required
             from wall_tags t
             join walls w on w.id = t.wall_id
             join wall_ownerships o on o.wall_id = w.id and o.ended_at is null
            where t.token_hash = $1
              and t.active = true
              and w.active = true
              and o.customer_id = $2
            limit 1
            for update of w`,
          [hashToken(token), req.plaqueCustomer.id],
        );
        if (owned.rowCount === 0) throw new Error('This plaque is not assigned to your account.');
        if (!owned.rows[0].setup_required) {
          await client.query('commit');
          return res.redirect(303, `/my-walls/${encodeURIComponent(owned.rows[0].id)}`);
        }
        const result = await client.query(
          `update walls
              set display_name = $2,
                  location_hint = $3,
                  setup_required = false,
                  setup_completed_at = now()
            where id = $1
            returning id, slug, display_name, location_hint`,
          [owned.rows[0].id, displayName, location],
        );
        updated = result.rows[0];
        await client.query(
          `insert into customer_audit_log
             (customer_id, email_snapshot, action, wall_id, wall_name, details)
           values ($1, $2, 'wall.first_setup', $3, $4, $5::jsonb)`,
          [req.plaqueCustomer.id, req.plaqueCustomer.email, updated.id, updated.display_name, JSON.stringify({ location_hint: updated.location_hint })],
        );
        await client.query('commit');
      } catch (error) {
        try { await client.query('rollback'); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
      return res.type('html').send(completePage({ token, wall: updated }));
    } catch (error) {
      const wall = await setupWallForToken(req.plaqueCustomer.id, token).catch(() => null);
      if (!wall) return res.status(400).type('html').send(escapeHtml(error?.message || 'Could not set up this plaque.'));
      return res.status(400).type('html').send(setupPage({ customer: req.plaqueCustomer, token, wall, error: error?.message || 'Could not set up this plaque.' }));
    }
  });

  app.use('/my-walls/setup', router);
}

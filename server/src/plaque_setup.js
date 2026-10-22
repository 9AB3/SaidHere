import express from 'express';

import { hashToken, makeToken } from './auth.js';
import {
  hashAdminPassword as hashPassword,
  validateAdminPassword as validatePassword,
} from './admin_auth.js';
import { pool } from './db.js';

const CUSTOMER_COOKIE = 'the_wall_customer';
const SESSION_HOURS = 24 * 30;

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

function setCustomerCookie(req, res, token) {
  const parts = [
    `${CUSTOMER_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/my-walls',
    `Max-Age=${SESSION_HOURS * 60 * 60}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' || req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function csrf(raw) {
  return hashToken(`customer-csrf:${raw}`);
}

async function startSession(req, customerId) {
  const raw = makeToken(48);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await pool.query(
    `insert into customer_sessions (customer_id, token_hash, expires_at, user_agent)
     values ($1, $2, $3, $4)`,
    [customerId, hashToken(raw), expiresAt, (req.get('user-agent') || '').slice(0, 500)],
  );
  return raw;
}

async function currentCustomer(req) {
  const raw = parseCookies(req)[CUSTOMER_COOKIE] || '';
  if (!raw) return null;
  const result = await pool.query(
    `update customer_sessions s
        set last_seen_at = now()
       from customer_accounts c
      where s.token_hash = $1
        and s.customer_id = c.id
        and s.expires_at > now()
        and c.active = true
    returning c.id, c.email, c.display_name`,
    [hashToken(raw)],
  );
  if (result.rowCount === 0) return null;
  return {
    id: result.rows[0].id,
    email: result.rows[0].email,
    displayName: result.rows[0].display_name,
    raw,
    csrf: csrf(raw),
  };
}

async function wallForToken(rawToken) {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.setup_required,
            p.serial_code,
            o.customer_id,
            c.email as customer_email,
            c.password_hash as customer_password_hash,
            c.active as customer_active
       from wall_tags t
       join walls w on w.id = t.wall_id
       join wall_ownerships o on o.wall_id = w.id and o.ended_at is null
       join customer_accounts c on c.id = o.customer_id
       left join plaques p on p.wall_tag_id = t.id
      where t.token_hash = $1
        and t.active = true
        and w.active = true
      limit 1`,
    [hashToken(rawToken)],
  );
  return result.rows[0] || null;
}

function setupPage({ customer = null, token, wall, activateAccount = false, error = '' }) {
  const accountFields = activateAccount
    ? `<div class="divider"><span>Owner account</span></div><div class="field"><label>Purchase email</label><input name="email" type="email" autocomplete="email" required placeholder="Email used at checkout"></div><div class="field"><label>Create password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label>Confirm password</label><input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></div>`
    : `<input type="hidden" name="_csrf" value="${escapeHtml(customer?.csrf || '')}">`;
  const accountNote = activateAccount
    ? 'Possession of this physical Wall plus the matching purchase email lets you activate the owner account even if the checkout email did not arrive.'
    : `Signed in as ${escapeHtml(customer?.email || '')}.`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Set up your Wall</title><style>
    *{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:540px;margin:5vh auto;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;padding:26px;box-shadow:0 18px 48px rgba(25,20,15,.18)}.logo{display:block;width:104px;margin:0 auto 18px}.eyebrow{text-align:center;font-size:9px;text-transform:uppercase;letter-spacing:1.6px;color:#796f63;font-weight:950}.card h1{text-align:center;margin:7px 0 8px;font-size:31px;letter-spacing:-.8px}.intro{text-align:center;color:#625a50;line-height:1.5;margin:0 0 22px}.serial{width:max-content;max-width:100%;margin:0 auto 20px;padding:7px 10px;border-radius:999px;background:#eee7dc;color:#6b635a;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.7px}.field{display:flex;flex-direction:column;gap:6px;margin:0 0 13px}.field label{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.field input{min-height:50px;padding:11px 12px;border:1px solid #9d917f;border-radius:8px;background:#fffdf8;font:inherit}.button{display:flex;width:100%;min-height:50px;align-items:center;justify-content:center;margin-top:9px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900;cursor:pointer}.error{padding:11px 13px;margin-bottom:14px;background:#f0d8d3;border-left:4px solid #963c33;border-radius:8px}.help{font-size:12px;line-height:1.5;color:#7b7266}.account{margin-top:18px;padding-top:15px;border-top:1px solid #e1d8ca;color:#756d63;font-size:11px;text-align:center}.divider{display:flex;align-items:center;gap:9px;margin:18px 0 13px;color:#7b7266;font-size:8px;text-transform:uppercase;letter-spacing:1px;font-weight:900}.divider::before,.divider::after{content:'';height:1px;flex:1;background:#ddd3c5}@media(max-width:520px){.card{padding:22px 18px;margin:3vh auto}.card h1{font-size:28px}}
  </style></head><body><div class="shade"><main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><div class="eyebrow">First scan</div><h1>Make this Wall yours.</h1><p class="intro">Choose the Wall name and location now. After setup, both can be changed whenever you like from My Walls.</p>${wall.serial_code ? `<div class="serial">Wall ${escapeHtml(wall.serial_code)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/setup/${encodeURIComponent(token)}"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required autofocus placeholder="e.g. The Royal Hotel — Men's Bathroom"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" required placeholder="e.g. Singleton NSW"></div>${accountFields}<button class="button" type="submit">${activateAccount ? 'Activate account & finish setup' : 'Finish Wall setup'}</button></form><p class="help">${accountNote}</p></main></div></body></html>`;
}

function loginNeededPage(token) {
  const next = `/my-walls/setup/${encodeURIComponent(token)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:500px;margin:8vh auto;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;padding:28px;text-align:center}.logo{width:106px}.card h1{font-size:30px;margin:16px 0 8px}.card p{color:#625a50;line-height:1.55}.button{display:flex;min-height:50px;align-items:center;justify-content:center;margin-top:14px;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}</style></head><body><div class="shade"><main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>Sign in to finish setup.</h1><p>This owner account has already been activated. Sign in, then you will return directly to this Wall setup.</p><a class="button" href="/my-walls/login?next=${encodeURIComponent(next)}">Sign in to My Walls</a></main></div></body></html>`;
}

function wrongAccountPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Different owner account · The Wall</title><style>body{margin:0;background:#eee5d5;color:#171411;font-family:Arial,sans-serif}.card{max-width:520px;margin:10vh auto;padding:28px;background:#fffaf1;border:1px solid #cabfab;border-radius:16px}a{color:inherit;font-weight:800}</style></head><body><main class="card"><h1>This Wall belongs to a different owner account.</h1><p>Log out of My Walls, then scan the Wall again and sign in with the purchase account.</p><p><a href="/my-walls">Open My Walls</a></p></main></body></html>`;
}

function completePage({ token, wall }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wall ready</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:520px;margin:8vh auto;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;padding:28px;text-align:center}.logo{width:108px}.card h1{font-size:31px;margin:16px 0 8px}.card p{color:#625a50;line-height:1.5}.button{display:flex;min-height:50px;align-items:center;justify-content:center;margin-top:12px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}.button.secondary{background:#fffaf1;color:#171411}</style></head><body><div class="shade"><main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>${escapeHtml(wall.display_name)} is ready.</h1><p>${escapeHtml(wall.location_hint)}</p><p>From now on, scanning this Wall opens it and grants the normal in-person writing window.</p><a class="button" href="/t/${encodeURIComponent(token)}">Open this Wall</a><a class="button secondary" href="/my-walls/${encodeURIComponent(wall.id)}">Manage in My Walls</a></main></div></body></html>`;
}

async function finishSetup({ token, customerId, email, displayName, location, password = null }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const owned = await client.query(
      `select w.id, w.slug, w.setup_required, c.password_hash
         from wall_tags t
         join walls w on w.id = t.wall_id
         join wall_ownerships o on o.wall_id = w.id and o.ended_at is null
         join customer_accounts c on c.id = o.customer_id
        where t.token_hash = $1
          and t.active = true
          and w.active = true
          and o.customer_id = $2
        limit 1
        for update of w, c`,
      [hashToken(token), customerId],
    );
    if (owned.rowCount === 0) throw new Error('This Wall is not assigned to this account.');
    if (!owned.rows[0].setup_required) {
      await client.query('commit');
      return { id: owned.rows[0].id, alreadyDone: true };
    }

    if (password != null) {
      if (owned.rows[0].password_hash) throw new Error('This account is already activated. Sign in instead.');
      await client.query(
        `update customer_accounts
            set password_hash = $2, updated_at = now()
          where id = $1 and password_hash is null`,
        [customerId, hashPassword(password)],
      );
      await client.query(
        `update customer_claim_tokens
            set used_at = coalesce(used_at, now())
          where customer_id = $1 and used_at is null`,
        [customerId],
      );
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
    const wall = result.rows[0];
    await client.query(
      `insert into customer_audit_log
         (customer_id, email_snapshot, action, wall_id, wall_name, details)
       values ($1, $2, 'wall.first_setup', $3, $4, $5::jsonb)`,
      [customerId, email, wall.id, wall.display_name, JSON.stringify({ location_hint: wall.location_hint, activated_from_wall: password != null })],
    );
    await client.query('commit');
    return wall;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

export function mountPlaqueSetup(app) {
  // Browser first scans that are not configured yet go straight to owner setup.
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

  // Native app scans receive a setup URL instead of opening an unnamed Wall.
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
        error: 'This Wall needs first-time owner setup.',
        setup_required: true,
        setup_url: url,
      });
    } catch (error) {
      return next(error);
    }
  });

  const router = express.Router();

  router.get('/:token', async (req, res, next) => {
    try {
      const token = clean(req.params.token);
      const wall = await wallForToken(token);
      if (!wall) return res.status(404).type('html').send('This Wall is not active.');
      const customer = await currentCustomer(req);
      if (!wall.setup_required) {
        if (customer?.id === wall.customer_id) return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}`);
        return res.redirect(303, `/t/${encodeURIComponent(token)}`);
      }
      if (customer && customer.id !== wall.customer_id) return res.status(403).type('html').send(wrongAccountPage());
      if (customer) return res.type('html').send(setupPage({ customer, token, wall }));
      if (!wall.customer_active) return res.status(403).type('html').send('This owner account is inactive. Contact The Wall support.');
      if (!wall.customer_password_hash) return res.type('html').send(setupPage({ token, wall, activateAccount: true }));
      return res.type('html').send(loginNeededPage(token));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:token', async (req, res, next) => {
    const token = clean(req.params.token);
    const displayName = clean(req.body?.display_name);
    const location = clean(req.body?.location_hint);
    try {
      if (!displayName || displayName.length > 80) throw new Error('Wall name must be between 1 and 80 characters.');
      if (!location || location.length > 120) throw new Error('Location must be between 1 and 120 characters.');
      const wallRecord = await wallForToken(token);
      if (!wallRecord) return res.status(404).type('html').send('This Wall is not active.');
      const customer = await currentCustomer(req);

      if (customer) {
        if (customer.id !== wallRecord.customer_id) return res.status(403).type('html').send(wrongAccountPage());
        if (clean(req.body?._csrf) !== customer.csrf) throw new Error('Request expired. Scan the Wall again and retry.');
        const wall = await finishSetup({
          token,
          customerId: customer.id,
          email: customer.email,
          displayName,
          location,
        });
        if (wall.alreadyDone) return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}`);
        return res.type('html').send(completePage({ token, wall }));
      }

      if (wallRecord.customer_password_hash) {
        return res.redirect(303, `/my-walls/login?next=${encodeURIComponent(`/my-walls/setup/${token}`)}`);
      }

      const email = clean(req.body?.email).toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const confirm = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
      if (email !== clean(wallRecord.customer_email).toLowerCase()) throw new Error('Purchase email does not match this Wall.');
      if (password !== confirm) throw new Error('The passwords do not match.');
      validatePassword(password);

      const wall = await finishSetup({
        token,
        customerId: wallRecord.customer_id,
        email: wallRecord.customer_email,
        displayName,
        location,
        password,
      });
      const rawSession = await startSession(req, wallRecord.customer_id);
      setCustomerCookie(req, res, rawSession);
      await pool.query(`update customer_accounts set last_login_at = now() where id = $1`, [wallRecord.customer_id]);
      return res.type('html').send(completePage({ token, wall }));
    } catch (error) {
      try {
        const wall = await wallForToken(token);
        if (!wall) return res.status(400).type('html').send(escapeHtml(error?.message || 'Could not set up this Wall.'));
        const customer = await currentCustomer(req);
        if (customer?.id === wall.customer_id) {
          return res.status(400).type('html').send(setupPage({ customer, token, wall, error: error?.message || 'Could not set up this Wall.' }));
        }
        if (!wall.customer_password_hash) {
          return res.status(400).type('html').send(setupPage({ token, wall, activateAccount: true, error: error?.message || 'Could not set up this Wall.' }));
        }
      } catch (_) {}
      return next(error);
    }
  });

  app.use('/my-walls/setup', router);
}

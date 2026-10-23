import nodemailer from 'nodemailer';
import rateLimit from 'express-rate-limit';

import { hashAdminPassword as hashPassword, validateAdminPassword as validatePassword } from './admin_auth.js';
import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

const RESET_MINUTES = 60;

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

function webBaseUrl() {
  return (process.env.PUBLIC_WEB_URL || 'https://saidhere.app').replace(/\/$/, '');
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)} · The Wall</title><style>
  *{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:455px;margin:7vh auto;padding:26px;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;box-shadow:0 12px 30px rgba(42,34,25,.13)}.logo{display:block;width:86px;height:86px;object-fit:cover;border-radius:14px;margin:0 auto 16px}.eyebrow{text-align:center;margin:0 0 7px;color:#776d60;font-size:9px;text-transform:uppercase;letter-spacing:1.7px;font-weight:950}h1{text-align:center;margin:0 0 8px;font-size:30px;letter-spacing:-.7px}p{color:#625a50;line-height:1.55}.field{display:flex;flex-direction:column;gap:6px;margin:14px 0}.field label{font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.field input{min-height:49px;padding:11px 12px;border:1px solid #9f9382;border-radius:8px;background:#fffdf8;font:inherit}.button{display:flex;width:100%;align-items:center;justify-content:center;min-height:49px;margin-top:14px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font:inherit;font-weight:900;cursor:pointer}.secondary{background:transparent;color:#171411}.error,.notice{padding:11px 13px;margin:13px 0;border-radius:9px;font-size:13px;font-weight:750}.error{background:#f0d8d3;border-left:4px solid #963c33}.notice{background:#dde8d8;border-left:4px solid #4e6847}.help{font-size:12px;color:#786f62}.link{text-align:center;margin:15px 0 0}.link a{color:#171411;font-weight:850}</style></head><body><div class="shade">${body}</div></body></html>`;
}

function requestPage({ error = '' } = {}) {
  return page('Forgot password', `<main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><div class="eyebrow">My Walls</div><h1>Recover your account</h1><p>Enter the email used to purchase your Wall. We’ll send a secure link to set a new password.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/forgot-password"><div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required autofocus></div><button class="button" type="submit">Send recovery link</button></form><p class="help">If you bought a Wall but never activated My Walls, the same link will let you create your first password.</p><p class="link"><a href="/my-walls/login">Back to sign in</a></p></main>`);
}

function requestedPage() {
  return page('Check your email', `<main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><div class="eyebrow">My Walls</div><h1>Check your email</h1><div class="notice">If a My Walls account exists for that email, a recovery link has been sent.</div><p>The link expires after ${RESET_MINUTES} minutes and can only be used once.</p><a class="button secondary" href="/my-walls/login">Back to sign in</a></main>`);
}

function resetPage({ token, email = '', activating = false, error = '' }) {
  const label = activating ? 'Activate My Walls' : 'Reset password';
  const intro = activating
    ? 'Set your first password to activate access to the Walls you own.'
    : 'Choose a new password for your My Walls account.';
  return page(label, `<main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><div class="eyebrow">${activating ? 'Account activation' : 'Password recovery'}</div><h1>${escapeHtml(label)}</h1><p>${escapeHtml(intro)}</p>${email ? `<p class="help" style="text-align:center"><b>${escapeHtml(email)}</b></p>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/reset-password/${encodeURIComponent(token)}"><div class="field"><label>New password</label><input name="password" type="password" autocomplete="new-password" required minlength="10"></div><div class="field"><label>Confirm new password</label><input name="confirm_password" type="password" autocomplete="new-password" required minlength="10"></div><button class="button" type="submit">${activating ? 'Activate account' : 'Set new password'}</button></form><p class="help">Use at least 10 characters. A password reset signs out any existing My Walls sessions.</p></main>`);
}

function expiredPage() {
  return page('Recovery link expired', `<main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><div class="eyebrow">My Walls</div><h1>Link expired</h1><p>This recovery link has expired or has already been used.</p><a class="button" href="/my-walls/forgot-password">Send a new link</a><a class="button secondary" href="/my-walls/login">Back to sign in</a></main>`);
}

function smtpTransport() {
  const user = clean(process.env.SMTP_USERNAME);
  const pass = process.env.SMTP_PASSWORD || '';
  if (!user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: clean(process.env.SMTP_HOST) || 'mail-au.smtp2go.com',
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
}

async function sendRecoveryEmail({ email, resetUrl, activating }) {
  const transport = smtpTransport();
  if (!transport) throw new Error('SMTP is not configured.');
  const subject = activating ? 'Activate your My Walls account' : 'Reset your My Walls password';
  const action = activating ? 'Activate My Walls' : 'Reset password';
  try {
    await transport.sendMail({
      from: process.env.CUSTOMER_EMAIL_FROM || 'The Wall <orders@saidhere.app>',
      to: email,
      replyTo: clean(process.env.CUSTOMER_REPLY_TO) || undefined,
      subject,
      text: `${subject}\n\n${action}: ${resetUrl}\n\nThis link expires in ${RESET_MINUTES} minutes and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<div style="max-width:560px;margin:auto;font-family:Arial,sans-serif;color:#171411;background:#f5efe5;padding:24px"><div style="background:#171411;color:#f7f0e5;padding:22px;border-radius:12px 12px 0 0"><div style="font-size:11px;letter-spacing:3px;font-weight:700">THE WALL</div><h1 style="margin:8px 0 0;font-size:26px">${escapeHtml(subject)}</h1></div><div style="padding:24px;border:1px solid #d8cdbc;border-top:0;background:#fffaf1;border-radius:0 0 12px 12px"><p style="line-height:1.55">${activating ? 'Create your password to activate access to My Walls.' : 'Use the secure link below to choose a new password.'}</p><p style="margin:24px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:14px 18px;background:#171411;color:#fff;text-decoration:none;font-weight:800;border-radius:8px">${escapeHtml(action)}</a></p><p style="color:#6f675d;font-size:13px;line-height:1.55">This link expires in ${RESET_MINUTES} minutes and can only be used once. If the button does not work, paste this address into your browser:<br><span style="word-break:break-all">${escapeHtml(resetUrl)}</span></p><p style="color:#6f675d;font-size:13px">If you did not request this, you can ignore this email.</p></div></div>`,
    });
  } finally {
    try { transport.close(); } catch (_) {}
  }
}

async function issueReset(email) {
  const normalized = clean(email).toLowerCase();
  if (!normalized || !normalized.includes('@')) return;
  const customerResult = await pool.query(
    `select id, email, password_hash, active
       from customer_accounts
      where lower(email) = $1
      limit 1`,
    [normalized],
  );
  if (customerResult.rowCount === 0 || !customerResult.rows[0].active) return;
  const customer = customerResult.rows[0];

  const client = await pool.connect();
  let raw;
  try {
    await client.query('begin');
    await client.query(
      `update customer_password_reset_tokens
          set used_at = coalesce(used_at, now())
        where customer_id = $1 and used_at is null`,
      [customer.id],
    );
    raw = makeToken(32);
    await client.query(
      `insert into customer_password_reset_tokens
         (customer_id, token_hash, expires_at)
       values ($1, $2, now() + interval '${RESET_MINUTES} minutes')`,
      [customer.id, hashToken(raw)],
    );
    await client.query(
      `insert into customer_audit_log (customer_id, email_snapshot, action, details)
       values ($1, $2, 'customer.password_recovery_requested', '{}'::jsonb)`,
      [customer.id, customer.email],
    );
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  const resetUrl = `${webBaseUrl()}/my-walls/reset-password/${raw}`;
  await sendRecoveryEmail({
    email: customer.email,
    resetUrl,
    activating: !customer.password_hash,
  });
}

async function loadValidToken(rawToken) {
  const token = clean(rawToken);
  if (token.length < 20 || token.length > 200) return null;
  const result = await pool.query(
    `select t.id, c.id as customer_id, c.email, c.password_hash, c.active
       from customer_password_reset_tokens t
       join customer_accounts c on c.id = t.customer_id
      where t.token_hash = $1
        and t.used_at is null
        and t.expires_at > now()
        and c.active = true
      limit 1`,
    [hashToken(token)],
  );
  return result.rows[0] || null;
}

export function mountCustomerPasswordReset(app) {
  const requestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  app.get('/my-walls/forgot-password', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.type('html').send(requestPage());
  });

  app.post('/my-walls/forgot-password', requestLimiter, async (req, res) => {
    try {
      await issueReset(req.body?.email);
    } catch (error) {
      // Do not reveal account existence or SMTP state to the requester.
      console.error('[customer-password-reset] Recovery email failed:', error?.message || error);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.type('html').send(requestedPage());
  });

  app.get('/my-walls/reset-password/:token', async (req, res) => {
    const found = await loadValidToken(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    if (!found) return res.status(410).type('html').send(expiredPage());
    return res.type('html').send(resetPage({
      token: req.params.token,
      email: found.email,
      activating: !found.password_hash,
    }));
  });

  app.post('/my-walls/reset-password/:token', resetLimiter, async (req, res) => {
    const token = clean(req.params.token);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirm = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
    let client;
    try {
      if (password !== confirm) throw new Error('The passwords do not match.');
      validatePassword(password);
      client = await pool.connect();
      await client.query('begin');
      const found = await client.query(
        `select t.id as token_id, c.id as customer_id, c.email, c.password_hash
           from customer_password_reset_tokens t
           join customer_accounts c on c.id = t.customer_id
          where t.token_hash = $1
            and t.used_at is null
            and t.expires_at > now()
            and c.active = true
          limit 1
          for update of t, c`,
        [hashToken(token)],
      );
      if (found.rowCount === 0) throw new Error('This recovery link has expired or has already been used.');
      const customer = found.rows[0];
      const activating = !customer.password_hash;

      await client.query(
        `update customer_accounts
            set password_hash = $2, updated_at = now()
          where id = $1`,
        [customer.customer_id, hashPassword(password)],
      );
      await client.query(
        `update customer_password_reset_tokens
            set used_at = coalesce(used_at, now())
          where customer_id = $1 and used_at is null`,
        [customer.customer_id],
      );
      await client.query(
        `update customer_claim_tokens
            set used_at = coalesce(used_at, now())
          where customer_id = $1 and used_at is null`,
        [customer.customer_id],
      );
      await client.query(`delete from customer_sessions where customer_id = $1`, [customer.customer_id]);
      await client.query(
        `insert into customer_audit_log (customer_id, email_snapshot, action, details)
         values ($1, $2, $3, '{}'::jsonb)`,
        [customer.customer_id, customer.email, activating ? 'customer.account_activated_via_recovery' : 'customer.password_reset'],
      );
      await client.query('commit');
      client.release();
      client = null;
      const message = activating ? 'Account activated. Sign in with your new password.' : 'Password updated. Sign in with your new password.';
      return res.redirect(303, `/my-walls/login?notice=${encodeURIComponent(message)}`);
    } catch (error) {
      if (client) {
        try { await client.query('rollback'); } catch (_) {}
        client.release();
      }
      const found = await loadValidToken(token);
      res.setHeader('Cache-Control', 'no-store');
      if (!found) return res.status(410).type('html').send(expiredPage());
      return res.status(400).type('html').send(resetPage({
        token,
        email: found.email,
        activating: !found.password_hash,
        error: error?.message || 'Could not update the password.',
      }));
    }
  });
}

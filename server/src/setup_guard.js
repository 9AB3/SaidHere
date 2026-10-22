import { hashToken } from './auth.js';
import { pool } from './db.js';

const CUSTOMER_COOKIE = 'the_wall_customer';
const UUID = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})';
const UUID_PATH = new RegExp(`^/${UUID}/?$`);
const EDIT_PATH = new RegExp(`^/${UUID}/edit/?$`);
const STATUS_PATH = new RegExp(`^/${UUID}/status/?$`);

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function waitingPage(email) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>First scan required · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:520px;margin:8vh auto;padding:28px;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;text-align:center}.logo{width:106px}.card h1{margin:16px 0 8px;font-size:30px}.card p{color:#625a50;line-height:1.55}.button{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:14px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}.account{margin-top:16px;color:#7b7266;font-size:11px}</style></head><body><div class="shade"><main class="card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>Scan the Wall first.</h1><p>This Wall has been assigned to your account, but its name and location stay locked until you receive the physical Wall.</p><p>When it arrives, scan the NFC. The first scan opens setup so you can choose the Wall name and location. After that, you can change them here whenever you like.</p><a class="button" href="/my-walls">Back to My Walls</a><div class="account">Signed in as ${escapeHtml(email)}</div></main></div></body></html>`;
}

export function mountSetupGuard(app) {
  app.use('/my-walls', async (req, res, next) => {
    try {
      const match = req.method === 'GET'
        ? req.path.match(UUID_PATH)
        : req.method === 'POST'
          ? (req.path.match(EDIT_PATH) || req.path.match(STATUS_PATH))
          : null;
      if (!match) return next();
      const raw = parseCookies(req)[CUSTOMER_COOKIE] || '';
      if (!raw) return next();
      const result = await pool.query(
        `select c.email, w.setup_required
           from customer_sessions s
           join customer_accounts c on c.id = s.customer_id
           join wall_ownerships o on o.customer_id = c.id and o.ended_at is null
           join walls w on w.id = o.wall_id
          where s.token_hash = $1
            and s.expires_at > now()
            and c.active = true
            and w.id = $2
          limit 1`,
        [hashToken(raw), match[1]],
      );
      if (result.rowCount === 0 || !result.rows[0].setup_required) return next();
      return res.status(req.method === 'POST' ? 409 : 200).type('html').send(waitingPage(result.rows[0].email));
    } catch (error) {
      return next(error);
    }
  });
}

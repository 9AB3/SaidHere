import { pool } from './db.js';
import { resendCustomerConfirmation } from './commerce_support.js';

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

function isPaid(order) {
  return Boolean(order && ['paid', 'fulfilled'].includes(order.status));
}

async function orderForCheckoutSession(sessionId) {
  const id = clean(sessionId);
  if (!id.startsWith('cs_')) return null;
  const result = await pool.query(
    `select o.id,
            o.status,
            o.purchaser_email,
            o.customer_confirmation_sent_at,
            o.customer_confirmation_error,
            o.customer_confirmation_last_attempt_at,
            c.password_hash
       from commerce_orders o
       left join customer_accounts c on c.id = o.customer_id
      where o.stripe_checkout_session_id = $1
      limit 1`,
    [id],
  );
  return result.rows[0] || null;
}

function activationPanel(order, sessionId, resentState) {
  const email = clean(order?.purchaser_email) || 'the email address used at checkout';
  const emailLabel = email.includes('@') ? `<strong>${escapeHtml(email)}</strong>` : escapeHtml(email);
  const deliveryProblem = Boolean(clean(order?.customer_confirmation_error));

  let notice = '';
  if (resentState === '1') {
    notice = '<div class="activationNotice good">✓ A fresh activation email has been sent.</div>';
  } else if (resentState === 'recent') {
    notice = '<div class="activationNotice">An activation email was sent recently. Check your inbox and junk/spam folder before trying again.</div>';
  } else if (deliveryProblem) {
    notice = '<div class="activationNotice warn">We had trouble delivering the first email. Use the resend button below.</div>';
  }

  return `<section class="activationBox">
    <div class="activationKicker">ONE LAST STEP</div>
    <h2>Create your My Walls password</h2>
    <p>We sent an account activation email to ${emailLabel}. Open that email and tap <strong>Create My Walls password</strong>.</p>
    <p><strong>You do not have a My Walls login yet.</strong> The email link is what creates your password. After that, you can sign in normally and manage this Wall and any future Walls you buy.</p>
    ${notice}
    <form method="post" action="/purchase/resend-activation">
      <input type="hidden" name="session_id" value="${escapeHtml(sessionId)}">
      <button class="button secondary" type="submit">Resend activation email</button>
    </form>
    <p class="already">Already used the activation email? <a href="/my-walls/login">Log in to My Walls</a></p>
  </section>`;
}

function polishSuccessPage(body, order, sessionId, resentState) {
  if (typeof body !== 'string' || !isPaid(order)) return body;

  // Existing customers already have a password, so the standard Open My Walls
  // button is correct for them. Only first-time purchasers need activation help.
  if (order.password_hash) return body;

  const panel = activationPanel(order, sessionId, resentState);
  const inactiveButton = /<a class="button" href="[^"]*\/my-walls\/login">Manage My Walls<\/a>/;
  let next = body.replace(inactiveButton, panel);

  // Keep this self-contained so it can safely sit on top of the existing polished
  // commerce renderer without duplicating that large template.
  const styles = `.activationBox{margin:18px 0 0;padding:18px;border:1px solid #cfc3b1;border-radius:12px;background:#f7f0e4}.activationKicker{font-size:9px;letter-spacing:1.4px;font-weight:950;color:#8e3a32}.activationBox h2{font-size:20px;margin:5px 0 10px}.activationBox p{font-size:13px;line-height:1.5;color:#655d53}.activationBox .button.secondary{width:100%;border:1px solid #171411;background:#fffaf1;color:#171411;cursor:pointer}.activationNotice{margin:12px 0;padding:10px 11px;border-radius:8px;background:#eee6d8;color:#5f584f;font-size:12px;font-weight:750}.activationNotice.good{background:#e5efe1;color:#3e5c39}.activationNotice.warn{background:#f4e5bc;color:#72591b}.activationBox .already{text-align:center;margin:12px 0 0;font-size:11px}.activationBox .already a{color:#171411;font-weight:850}`;
  if (!next.includes('.activationBox{')) {
    next = next.replace('</style>', `${styles}</style>`);
  }
  return next;
}

export function installPurchaseSuccessUiPatch(app) {
  app.post('/purchase/resend-activation', async (req, res, next) => {
    try {
      const sessionId = clean(req.body?.session_id);
      const order = await orderForCheckoutSession(sessionId);
      if (!isPaid(order)) {
        return res.status(400).type('text').send('This paid order could not be verified.');
      }
      if (order.password_hash) {
        return res.redirect(303, '/my-walls');
      }

      const lastAttempt = order.customer_confirmation_last_attempt_at
        ? new Date(order.customer_confirmation_last_attempt_at).getTime()
        : 0;
      const previousDeliveryFailed = Boolean(clean(order.customer_confirmation_error));
      if (!previousDeliveryFailed && lastAttempt && Date.now() - lastAttempt < 60 * 1000) {
        return res.redirect(303, `/purchase/success?session_id=${encodeURIComponent(sessionId)}&resent=recent`);
      }

      await resendCustomerConfirmation(order.id);
      return res.redirect(303, `/purchase/success?session_id=${encodeURIComponent(sessionId)}&resent=1`);
    } catch (error) {
      console.error('[purchase-resend-activation]', error);
      return next(error);
    }
  });

  app.use('/purchase/success', async (req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
      const sessionId = clean(req.query?.session_id);
      const order = await orderForCheckoutSession(sessionId);
      const resentState = clean(req.query?.resent);
      const originalSend = res.send.bind(res);
      res.send = (body) => originalSend(polishSuccessPage(body, order, sessionId, resentState));
      return next();
    } catch (error) {
      return next(error);
    }
  });
}

import { pool } from './db.js';
import {
  reconcileCheckoutSessionById as reconcileCheckoutSessionByIdUnlocked,
  reconcilePaidCheckout as reconcilePaidCheckoutUnlocked,
} from './commerce_support.js';

async function withCheckoutLock(sessionId, operation) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!id || !id.startsWith('cs_')) throw new Error('Invalid Stripe Checkout Session ID.');
  const client = await pool.connect();
  const key = `stripe-checkout:${id}`;
  try {
    // Hold a session-level advisory lock through reconciliation and email delivery.
    // This prevents the success-page recovery and Stripe webhook from issuing
    // competing activation links or duplicate confirmation emails.
    await client.query(`select pg_advisory_lock(hashtextextended($1, 0))`, [key]);
    return await operation();
  } finally {
    try { await client.query(`select pg_advisory_unlock(hashtextextended($1, 0))`, [key]); }
    catch (error) { console.error('[checkout-reconcile-unlock]', error); }
    client.release();
  }
}

export async function reconcileCheckoutSessionById(sessionId) {
  return withCheckoutLock(sessionId, () => reconcileCheckoutSessionByIdUnlocked(sessionId));
}

export async function reconcilePaidCheckout(session) {
  const sessionId = typeof session?.id === 'string' ? session.id : '';
  return withCheckoutLock(sessionId, () => reconcilePaidCheckoutUnlocked(session));
}

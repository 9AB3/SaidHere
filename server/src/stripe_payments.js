import crypto from 'node:crypto';
import express from 'express';

import { pool } from './db.js';

const WEBHOOK_PATH = '/api/payments/stripe-webhook';
const SIGNATURE_TOLERANCE_SECONDS = 300;

function text(value) {
  return typeof value === 'string' ? value : '';
}

function stripeId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function timingSafeHexEqual(left, right) {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!Buffer.isBuffer(rawBody) || !signatureHeader || !secret) return false;

  const parts = signatureHeader
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const timestampText = parts.find((part) => part.startsWith('t='))?.slice(2) || '';
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));

  const timestamp = Number(timestampText);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestampText}.`, 'utf8'), rawBody]))
    .digest('hex');

  return signatures.some((signature) => timingSafeHexEqual(signature, expected));
}

async function markCheckoutPaid(client, session) {
  const orderId = text(session?.metadata?.order_id).trim();
  if (!orderId || session?.payment_status !== 'paid') {
    return { matched: false, reason: 'not-paid-or-no-order-id' };
  }

  const amountTotal = Number.isInteger(session.amount_total) ? session.amount_total : null;
  const currency = text(session.currency).trim().toLowerCase() || null;
  const purchaserEmail = text(session.customer_details?.email || session.customer_email).trim().toLowerCase() || null;
  const checkoutSessionId = text(session.id).trim() || null;
  const paymentIntentId = stripeId(session.payment_intent);
  const customerId = stripeId(session.customer);

  const result = await client.query(
    `update commerce_orders
        set status = case when status in ('fulfilled', 'refunded') then status else 'paid' end,
            amount_total = coalesce($2, amount_total),
            currency = coalesce($3, currency),
            stripe_checkout_session_id = coalesce($4, stripe_checkout_session_id),
            stripe_payment_intent_id = coalesce($5, stripe_payment_intent_id),
            stripe_customer_id = coalesce($6, stripe_customer_id),
            purchaser_email = coalesce($7, purchaser_email),
            paid_at = coalesce(paid_at, now()),
            updated_at = now()
      where id = $1
      returning id, status`,
    [
      orderId,
      amountTotal,
      currency,
      checkoutSessionId,
      paymentIntentId,
      customerId,
      purchaserEmail,
    ],
  );

  return {
    matched: result.rowCount > 0,
    orderId,
    status: result.rows[0]?.status || null,
  };
}

async function markCheckoutCancelled(client, session) {
  const orderId = text(session?.metadata?.order_id).trim();
  if (!orderId) return { matched: false, reason: 'no-order-id' };

  const result = await client.query(
    `update commerce_orders
        set status = case when status = 'pending' then 'cancelled' else status end,
            stripe_checkout_session_id = coalesce($2, stripe_checkout_session_id),
            updated_at = now()
      where id = $1
      returning id, status`,
    [orderId, text(session.id).trim() || null],
  );
  return {
    matched: result.rowCount > 0,
    orderId,
    status: result.rows[0]?.status || null,
  };
}

async function processStripeEvent(event) {
  const eventId = text(event?.id).trim();
  const eventType = text(event?.type).trim();
  const object = event?.data?.object || {};
  if (!eventId || !eventType) throw new Error('Stripe event is missing an id or type.');

  const client = await pool.connect();
  try {
    await client.query('begin');

    await client.query(
      `insert into stripe_webhook_events
         (stripe_event_id, event_type, stripe_object_id)
       values ($1, $2, $3)
       on conflict (stripe_event_id) do nothing`,
      [eventId, eventType, stripeId(object)],
    );

    const eventRow = await client.query(
      `select processed_at
         from stripe_webhook_events
        where stripe_event_id = $1
        for update`,
      [eventId],
    );

    if (eventRow.rows[0]?.processed_at) {
      await client.query('commit');
      return { duplicate: true, eventType };
    }

    let result = { matched: false, reason: 'event-not-actioned' };
    if (
      eventType === 'checkout.session.completed' ||
      eventType === 'checkout.session.async_payment_succeeded'
    ) {
      result = await markCheckoutPaid(client, object);
    } else if (
      eventType === 'checkout.session.expired' ||
      eventType === 'checkout.session.async_payment_failed'
    ) {
      result = await markCheckoutCancelled(client, object);
    }

    await client.query(
      `update stripe_webhook_events
          set processed_at = now(), last_error = null
        where stripe_event_id = $1`,
      [eventId],
    );
    await client.query('commit');
    return { duplicate: false, eventType, ...result };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

export function mountStripePayments(app) {
  // This route must be mounted BEFORE express.json(). Stripe signs the exact raw
  // request bytes, so parsing/re-serialising JSON before verification would break
  // signature validation.
  app.get(WEBHOOK_PATH, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      service: 'the-wall-stripe-webhook',
      configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    });
  });

  app.post(
    WEBHOOK_PATH,
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
      const signature = req.get('stripe-signature') || '';

      if (!secret) {
        return res.status(503).json({ error: 'Stripe webhook is not configured.' });
      }
      if (!verifyStripeSignature(req.body, signature, secret)) {
        return res.status(400).json({ error: 'Invalid Stripe signature.' });
      }

      let event;
      try {
        event = JSON.parse(req.body.toString('utf8'));
      } catch (_) {
        return res.status(400).json({ error: 'Invalid Stripe event JSON.' });
      }

      try {
        const result = await processStripeEvent(event);
        return res.json({ received: true, duplicate: result.duplicate === true });
      } catch (error) {
        console.error('[stripe/webhook]', {
          eventId: event?.id,
          eventType: event?.type,
          message: error?.message,
        });
        return res.status(500).json({ error: 'Webhook processing failed.' });
      }
    },
  );
}

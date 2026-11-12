import { sendSessionNotification } from './session_notifications.js';

// Native builds can tell us their platform; older builds cannot.
// Both routes use the same notification ledger to avoid duplicate pushes.
export function mountFirstOpenNotifications(app, { requireSession, pool, fetchImpl = fetch }) {
  app.post('/api/app/first-open', requireSession, async (req, res, next) => {
    const platform = typeof req.body?.platform === 'string'
      ? req.body.platform.toLowerCase().trim()
      : '';
    if (platform !== 'ios' && platform !== 'android') {
      return res.status(400).json({ error: 'Invalid app platform.' });
    }

    try {
      await pool.query(
        `insert into app_first_opens (session_id, platform)
         values ($1, $2)
         on conflict (session_id) do update set platform = excluded.platform`,
        [req.sessionId, platform],
      );
      const outcome = await sendSessionNotification({
        pool, sessionId: req.sessionId, source: 'native', platform, fetchImpl,
      });
      if (outcome.status === 'unconfigured') {
        return res.status(503).json({ error: 'Notification service not configured.' });
      }
      if (outcome.status === 'sent' || outcome.status === 'already_handled') {
        await pool.query(
          `update app_first_opens set notified_at = coalesce(notified_at, now())
           where session_id = $1`,
          [req.sessionId],
        );
      }
      return res.status(outcome.status === 'sent' ? 201 : 200).json({
        ok: true,
        already_reported: outcome.status === 'already_handled',
        suppressed: outcome.status === 'rate_limited',
      });
    } catch (error) {
      console.error('[first-open] Notification failed:', error);
      return next(error);
    }
  });
}

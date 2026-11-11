// Registers the first launch of a native installation and notifies the owner.
// A unique anonymous session limits an installation to one successful alert.
// Do not put Pushover credentials in client-side code.
export function mountFirstOpenNotifications(app, { requireSession, pool, fetchImpl = fetch }) {
  app.post('/api/app/first-open', requireSession, async (req, res, next) => {
    const platform = typeof req.body?.platform === 'string'
      ? req.body.platform.toLowerCase().trim()
      : '';
    if (platform !== 'ios' && platform !== 'android') {
      return res.status(400).json({ error: 'Invalid app platform.' });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into app_first_opens (session_id, platform)
         values ($1, $2)
         on conflict (session_id) do nothing`,
        [req.sessionId, platform],
      );
      // Lock this installation while sending so simultaneous requests cannot
      // generate duplicate successful push messages.
      const result = await client.query(
        `select notified_at from app_first_opens
         where session_id = $1 for update`,
        [req.sessionId],
      );
      if (result.rows[0]?.notified_at) {
        await client.query('commit');
        return res.json({ ok: true, already_reported: true });
      }

      const token = process.env.PUSHOVER_APP_TOKEN;
      const user = process.env.PUSHOVER_USER_KEY;
      if (!token || !user) {
        await client.query('commit');
        // A new installation can retry on its next launch once configured.
        return res.status(503).json({ error: 'Notification service not configured.' });
      }

      try {
        const response = await fetchImpl('https://api.pushover.net/1/messages.json', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token,
            user,
            title: 'Said Here - new installation',
            message: `Said Here was opened for the first time on ${platform === 'ios' ? 'iPhone (iOS)' : 'Android'}.`,
            ...(process.env.PUSHOVER_DEVICE?.trim() ? { device: process.env.PUSHOVER_DEVICE.trim() } : {}),
          }),
          signal: AbortSignal.timeout(6000),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body?.status !== 1) {
          throw new Error(`Pushover refused first-launch alert (HTTP ${response.status}).`);
        }
      } catch (error) {
        console.error('First-launch push failed:', error);
        await client.query('commit');
        // Leave notified_at null; the app retries on a later launch.
        return res.status(503).json({ error: 'Notification temporarily unavailable.' });
      }

      await client.query(
        `update app_first_opens set notified_at = now() where session_id = $1`,
        [req.sessionId],
      );
      await client.query('commit');
      return res.status(201).json({ ok: true, already_reported: false });
    } catch (error) {
      try { await client.query('rollback'); } catch (_) {}
      return next(error);
    } finally {
      client.release();
    }
  });
}

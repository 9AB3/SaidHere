// Best-effort owner notifications when a new anonymous API session is created.
// This is NOT a verified App Store or Google Play installation event.
const MAX_HOURLY_ALERTS = 30;

export async function sendSessionNotification({
  pool,
  sessionId,
  source = 'session',
  platform = null,
  fetchImpl = fetch,
  env = process.env,
}) {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) return { status: 'unconfigured' };
  if (!['session', 'native'].includes(source)) throw new Error('Unexpected notification source');

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('begin');
    inTransaction = true;
    await client.query(
      `insert into session_push_notifications (session_id) values ($1)
       on conflict (session_id) do nothing`,
      [sessionId],
    );
    const existing = await client.query(
      `select notified_at, suppressed_at from session_push_notifications
       where session_id = $1 for update`,
      [sessionId],
    );
    if (existing.rows[0]?.notified_at || existing.rows[0]?.suppressed_at) {
      const status = existing.rows[0]?.notified_at ? 'already_handled' : 'rate_limited';
      await client.query('commit');
      inTransaction = false;
      return { status };
    }

    // Guard against quota exhaustion from automated session creation.
    const recent = await client.query(
      `select count(*)::int as total from session_push_notifications
       where notified_at >= now() - interval '1 hour'`,
    );
    if (Number(recent.rows[0]?.total || 0) >= MAX_HOURLY_ALERTS) {
      await client.query(
        `update session_push_notifications set suppressed_at = now()
         where session_id = $1`, [sessionId],
      );
      await client.query('commit');
      inTransaction = false;
      return { status: 'rate_limited' };
    }

    const platformLabel = platform === 'ios' ? 'iPhone (iOS)' :
      platform === 'android' ? 'Android' : null;
    const message = source === 'native' && platformLabel
      ? `Said Here was first opened on ${platformLabel}.`
      : 'A new anonymous Said Here app session was created. It may be a first launch, reinstall, or cleared app storage; it is not a confirmed download.';
    const payload = {
      token: env.PUSHOVER_APP_TOKEN,
      user: env.PUSHOVER_USER_KEY,
      title: source === 'native' ? 'Said Here - first app launch' : 'Said Here - new app session',
      message,
    };
    if (env.PUSHOVER_DEVICE?.trim()) payload.device = env.PUSHOVER_DEVICE.trim();

    const response = await fetchImpl('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload),
      signal: AbortSignal.timeout(6000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== 1) throw new Error(`Pushover returned HTTP ${response.status}`);
    await client.query(
      `update session_push_notifications
       set notified_at = now(), source = $2
       where session_id = $1`,
      [sessionId, source],
    );
    await client.query('commit');
    inTransaction = false;
    return { status: 'sent' };
  } catch (error) {
    if (inTransaction) {
      try { await client.query('rollback'); } catch (_) {}
    }
    throw error;
  } finally {
    client.release();
  }
}

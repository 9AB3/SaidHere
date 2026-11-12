import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSessionNotification } from '../src/session_notifications.js';

function fakeDatabase({ sent = false, suppressed = false, hourly = 0 } = {}) {
  const state = { sent, suppressed, hourly, inserts: 0, releases: 0 };
  const client = {
    async query(sql) {
      const q = sql.trim().toLowerCase();
      if (q === 'begin' || q === 'commit' || q === 'rollback') return { rows: [] };
      if (q.startsWith('insert into session_push_notifications')) {
        state.inserts += 1; return { rows: [] };
      }
      if (q.startsWith('select notified_at, suppressed_at')) {
        return { rows: [{ notified_at: state.sent ? new Date() : null, suppressed_at: state.suppressed ? new Date() : null }] };
      }
      if (q.startsWith('select count(*)')) return { rows: [{ total: state.hourly }] };
      if (q.startsWith('update session_push_notifications set suppressed_at')) {
        state.suppressed = true; return { rows: [] };
      }
      if (q.startsWith('update session_push_notifications')) {
        state.sent = true; return { rows: [] };
      }
      throw new Error('Unexpected query in test: ' + sql);
    },
    release() { state.releases += 1; },
  };
  return { state, pool: { connect: async () => client } };
}

const env = {
  PUSHOVER_APP_TOKEN: 'test-token',
  PUSHOVER_USER_KEY: 'test-user',
  PUSHOVER_DEVICE: 'AB_Phone',
};

test('sends once per session and skips repeat native request', async () => {
  const { state, pool } = fakeDatabase();
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    assert.equal(options.body.get('token'), 'test-token');
    assert.equal(options.body.get('user'), 'test-user');
    assert.equal(options.body.get('device'), 'AB_Phone');
    assert.equal(options.body.get('title'), 'Said Here - new app session');
    return { ok: true, status: 200, json: async () => ({ status: 1 }) };
  };
  const one = await sendSessionNotification({ pool, sessionId: 'test-session', env, fetchImpl });
  const two = await sendSessionNotification({ pool, sessionId: 'test-session', source: 'native', platform: 'ios', env, fetchImpl });
  assert.equal(one.status, 'sent');
  assert.equal(two.status, 'already_handled');
  assert.equal(calls, 1);
  assert.equal(state.releases, 2);
});

test('mobile first-open can send platform-specific alert when session alert has not yet fired', async () => {
  const { pool } = fakeDatabase();
  let title = '', message = '';
  const fetchImpl = async (_url, options) => {
    title = options.body.get('title');
    message = options.body.get('message');
    return { ok: true, status: 200, json: async () => ({ status: 1 }) };
  };
  const response = await sendSessionNotification({ pool, sessionId: 'native', source: 'native', platform: 'android', env, fetchImpl });
  assert.equal(response.status, 'sent');
  assert.match(title, /first app launch/);
  assert.match(message, /Android/);
});

test('new session cap protects against notification flooding', async () => {
  const { pool, state } = fakeDatabase({ hourly: 30 });
  const status = await sendSessionNotification({
    pool, sessionId: 'overflow', env,
    fetchImpl: () => { throw new Error('Should not send'); },
  });
  assert.equal(status.status, 'rate_limited');
  assert.equal(state.suppressed, true);
});

test('missing keys never affect session issuance', async () => {
  const status = await sendSessionNotification({ pool: {}, sessionId: 'no-config', env: {} });
  assert.equal(status.status, 'unconfigured');
});

test('Pushover errors roll back the notification ledger', async () => {
  const { pool, state } = fakeDatabase();
  await assert.rejects(
    sendSessionNotification({
      pool, sessionId: 'retry-me', env,
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ status: 0 }) }),
    }), /Pushover returned HTTP 400/,
  );
  assert.equal(state.sent, false);
  assert.equal(state.releases, 1);
});

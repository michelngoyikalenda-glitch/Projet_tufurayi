import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashToken } from '../server/auth.js';

test('OAuth : liaison au navigateur, usage unique et récupération sécurisée', async t => {
  const variables = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
    APPLE_CLIENT_ID: 'test-apple', APPLE_TEAM_ID: 'test-team', APPLE_KEY_ID: 'test-key', APPLE_PRIVATE_KEY: 'test-key' };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  Object.assign(process.env, variables);
  const db = await openDatabase({ url: '', filename: ':memory:' });
  const service = createApp(db, 'oauth-test-secret-'.repeat(4), {
    test: true, origin: 'https://quiz.example', mailer: { async sendMail() {} }
  });
  const server = createServer(service.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const nativeFetch = globalThis.fetch;
  let profile = { email: 'oauth@test.fr', email_verified: true, name: 'Joueur OAuth' };
  let exchanges = 0, expectedChallenge;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith(base)) return nativeFetch(url, options);
    if (url === 'https://oauth2.googleapis.com/token') {
      exchanges++;
      const form = options.body;
      assert.equal(form.get('redirect_uri'), 'https://quiz.example/api/auth/oauth/google/callback');
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), expectedChallenge);
      return Response.json({ access_token: 'test-access-token' });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(profile);
    throw new Error(`Appel externe inattendu : ${url}`);
  });
  t.after(async () => {
    t.mock.restoreAll();
    await new Promise(resolve => server.close(resolve));
    await db.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  async function start(provider = 'google') {
    const response = await fetch(`${base}/oauth/${provider}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const url = new URL(response.headers.get('location'));
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, new RegExp(`Path=/api/auth/oauth/${provider}/callback`));
    if (provider === 'google') {
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      expectedChallenge = url.searchParams.get('code_challenge');
      assert.match(setCookie, /SameSite=Lax/i);
    } else assert.match(setCookie, /SameSite=None/i);
    return { state: url.searchParams.get('state'), cookie: setCookie.split(';')[0] };
  }
  function callback(flow, provider = 'google', post = false, origin) {
    const params = new URLSearchParams({ code: 'test-authorization-code', state: flow.state });
    return fetch(`${base}/oauth/${provider}/callback${post ? '' : `?${params}`}`, {
      redirect: 'manual', method: post ? 'POST' : 'GET',
      headers: { ...(flow.cookie ? { Cookie: flow.cookie } : {}),
        ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(origin ? { Origin: origin } : {}) }, ...(post ? { body: params } : {})
    });
  }
  async function localPost(route, body, cookie) {
    return fetch(`${base}/${route}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body) });
  }
  async function addUser(email, verified) {
    const user = { id: randomUUID(), email, pseudo: 'Joueur', role: 'player', avatar: 'indigo', verified, token_version: 0 };
    await db.query('INSERT INTO users (id,email,password_hash,pseudo,role,verified,created_at) VALUES (?,?,?,?,?,?,?)',
      [user.id, email, await bcrypt.hash('TestPassword2026!', 12), user.pseudo, user.role, verified, Date.now()]);
    return user;
  }

  await t.test('un état volé sans le bon cookie est refusé avant tout échange', async () => {
    const flow = await start();
    assert.equal((await callback({ ...flow, cookie: undefined })).status, 400);
    const other = await start();
    assert.equal((await callback({ ...flow, cookie: other.cookie })).status, 400);
    assert.equal(exchanges, 0);
  });
  await t.test('un état expiré, falsifié ou destiné à un autre fournisseur est refusé', async () => {
    const flow = await start();
    assert.equal((await callback({ ...flow, state: 'f'.repeat(64) })).status, 400);
    assert.equal((await callback(flow, 'apple', true, 'https://appleid.apple.com')).status, 400);
    await db.query('UPDATE oauth_requests SET expires_at=? WHERE hash=?', [Date.now() - 1, hashToken(flow.state)]);
    assert.equal((await callback(flow)).status, 400);
    assert.equal(exchanges, 0);
    await start();
    assert.equal((await db.query('SELECT * FROM oauth_requests WHERE hash=?', [hashToken(flow.state)])).length, 0);
  });
  await t.test('Apple utilise un cookie adapté au callback POST sans ouvrir les autres routes', async () => {
    const flow = await start('apple');
    assert.equal((await callback({ ...flow, cookie: undefined }, 'apple', true, 'https://appleid.apple.com')).status, 400);
    assert.equal((await callback(flow, 'apple', true, 'https://evil.example')).status, 403);
    assert.equal((await fetch(`${base}/providers`, { headers: { Origin: 'https://appleid.apple.com' } })).status, 403);
    assert.equal(exchanges, 0);
  });
  await t.test('la récupération OAuth révoque le mot de passe, les liens et les sessions préexistants', async () => {
    const user = await addUser(profile.email, 0);
    const oldAccess = service.auth.access(user);
    const refresh = 'r'.repeat(96), verify = 'v'.repeat(64), reset = 's'.repeat(64);
    for (const [kind, token] of [['refresh', refresh], ['verify', verify], ['reset', reset]]) {
      await db.query('INSERT INTO auth_tokens (hash,user_id,kind,expires_at) VALUES (?,?,?,?)',
        [hashToken(token), user.id, kind, Date.now() + 60000]);
    }
    const flow = await start();
    const response = await callback(flow);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://quiz.example');
    assert.match(response.headers.get('set-cookie'), /oauth_browser=;/);
    const [saved] = await db.query('SELECT * FROM users WHERE id=?', [user.id]);
    assert.equal(saved.verified, 1);
    assert.equal(saved.token_version, 1);
    assert.equal(await bcrypt.compare('TestPassword2026!', saved.password_hash), false);
    await assert.rejects(service.auth.authenticate(oldAccess), { status: 401 });
    for (const token of [refresh, verify, reset]) {
      assert.equal((await db.query('SELECT * FROM auth_tokens WHERE hash=?', [hashToken(token)])).length, 0);
    }
    assert.equal((await localPost('login', { email: user.email, password: 'TestPassword2026!' })).status, 401);
    assert.equal((await localPost('refresh', {}, `refresh=${refresh}`)).status, 401);
    assert.equal((await localPost('reset', { token: reset, password: 'NewPassword2026!' })).status, 400);
    const cookies = response.headers.getSetCookie();
    const current = cookies.find(cookie => cookie.startsWith('refresh=')).split(';')[0];
    assert.equal((await localPost('refresh', {}, current)).status, 200);
    const count = exchanges;
    assert.equal((await callback(flow)).status, 400);
    assert.equal(exchanges, count);
  });
  await t.test('les comptes vérifiés conservent leur mot de passe et leurs sessions', async () => {
    profile = { ...profile, email: 'verified@test.fr' };
    const user = await addUser(profile.email, 1);
    const oldAccess = service.auth.access(user);
    assert.equal((await callback(await start())).status, 302);
    assert.equal((await localPost('login', { email: user.email, password: 'TestPassword2026!' })).status, 200);
    assert.equal((await service.auth.authenticate(oldAccess)).id, user.id);
  });
  await t.test('deux callbacks concurrents ne consomment un état qu’une seule fois', async () => {
    profile = { ...profile, email: 'new@test.fr' };
    const flow = await start();
    const count = exchanges;
    const responses = await Promise.all([callback(flow), callback(flow)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [302, 400]);
    assert.equal(exchanges, count + 1);
    const [user] = await db.query('SELECT * FROM users WHERE email=?', [profile.email]);
    assert.equal(user.verified, 1);
    assert.equal(user.role, 'player');
  });
  await t.test('un email non confirmé par Google ne peut pas activer un compte', async () => {
    profile = { ...profile, email: 'unconfirmed@test.fr', email_verified: false };
    const user = await addUser(profile.email, 0);
    const flow = await start();
    assert.equal((await callback(flow)).status, 403);
    const [saved] = await db.query('SELECT * FROM users WHERE id=?', [user.id]);
    assert.equal(saved.verified, 0);
    assert.equal(saved.token_version, 0);
    assert.equal(await bcrypt.compare('TestPassword2026!', saved.password_hash), true);
    assert.equal((await callback(flow)).status, 400);
  });
});

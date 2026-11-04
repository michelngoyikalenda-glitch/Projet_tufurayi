import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('lien de session : le code est transporté et récupéré depuis le lien complet', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  const previousLocation = globalThis.location;
  globalThis.location = { origin: 'https://tufurayi.test' };
  try {
    const { parseSessionLink, sessionLink } = await vite.ssrLoadModule('/src/api.ts');
    const link = sessionLink('session-id', 'code secret');
    assert.equal(link, 'https://tufurayi.test/?session=session-id&code=code+secret');
    assert.deepEqual(parseSessionLink(link), { id: 'session-id', code: 'code secret' });
    assert.deepEqual(parseSessionLink(' session-id '), { id: 'session-id', code: '' });
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    await vite.close();
  }
});

test('invitation mémorisée et liens de partage (WhatsApp, Telegram, Gmail)', async () => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  const previous = { location: globalThis.location, localStorage: globalThis.localStorage };
  const store = new Map();
  globalThis.location = { origin: 'https://tufurayi.test', search: '' };
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  try {
    const { readInvite, saveInvite, sessionLink, shareTargets } = await vite.ssrLoadModule('/src/api.ts');
    assert.deepEqual(readInvite('?session=abc&code=XYZ'), { id: 'abc', code: 'XYZ' });
    assert.equal(readInvite(''), null);
    saveInvite({ id: 'abc', code: 'XYZ' });
    assert.deepEqual(readInvite(''), { id: 'abc', code: 'XYZ' });
    store.set('tufurayi:invitation', JSON.stringify({ id: 'abc', code: '', at: Date.now() - 8 * 86400000 }));
    assert.equal(readInvite(''), null);
    saveInvite(null);
    assert.equal(store.size, 0);
    const link = sessionLink('abc', 'XYZ');
    const targets = Object.fromEntries(shareTargets(link, 'Quiz').map(t => [t.name, t.url]));
    for (const name of ['WhatsApp', 'Telegram', 'Gmail', 'Email', 'SMS']) assert.ok(targets[name].includes(encodeURIComponent(link)), name);
    assert.match(targets.WhatsApp, /^https:\/\/wa\.me\/\?text=/);
    assert.match(targets.Telegram, /^https:\/\/t\.me\/share\/url\?url=/);
    assert.match(targets.Gmail, /^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    await vite.close();
  }
});

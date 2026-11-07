import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';

test('production : inscriptions publiques réservées aux joueurs', async t => {
  const previous = process.env.NODE_ENV;
  const db = await openDatabase({ url: '', filename: ':memory:' });
  let service;
  try {
    process.env.NODE_ENV = 'production';
    service = createApp(db, 'production-test-secret-'.repeat(4), {
      test: true, origin: 'https://quiz.example', mailer: { async sendMail() {} }
    });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
  const server = createHttpServer(service.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  for (const role of [undefined, 'player', 'creator', 'admin']) {
    const email = `${role || 'default'}@test.fr`;
    const response = await fetch(`${base}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'TestPassword2026!', pseudo: 'Joueur', ...(role ? { role } : {}) })
    });
    const allowed = !role || role === 'player';
    assert.equal(response.status, allowed ? 201 : 400);
    const users = await db.query('SELECT * FROM users WHERE email=?', [email]);
    assert.equal(users.length, allowed ? 1 : 0);
    if (allowed) {
      const user = users[0];
      assert.equal(user.role, 'player');
      const token = service.auth.access(user);
      for (const [path, method] of [['/quizzes', 'POST'], ['/sessions', 'POST'], ['/admin', 'GET'],
        ['/admin/users/other', 'PUT'], ['/quizzes/other/stats', 'GET']]) {
        const denied = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
        assert.equal(denied.status, 403, `${method} ${path}`);
      }
    }
  }
});

test('interface : démonstration et choix créateur absents en production, conservés en développement', async () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const production of [false, true]) {
      process.env.NODE_ENV = production ? 'production' : 'development';
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
      try {
        const { Auth } = await vite.ssrLoadModule('/src/Auth.tsx');
        const { SessionCard, Hero } = await vite.ssrLoadModule('/src/components.tsx');
        const props = { close() {}, onLogin() {} };
        const login = renderToStaticMarkup(createElement(Auth, props));
        const registration = renderToStaticMarkup(createElement(Auth, { ...props, initial: 'register' }));
        assert.equal(login.includes('Découvrir avec un compte de démonstration'), !production);
        for (const label of ['Joueur', 'Créatrice', 'Admin']) {
          assert.equal(login.includes(`>${label}</button>`), !production);
        }
        assert.equal(registration.includes('Créer et animer des quiz'), !production);
        assert.ok(login.includes('Se connecter'));
        assert.ok(registration.includes('Créer mon compte'));
        for (const role of ['player', 'creator', 'admin']) {
          const creator = role !== 'player';
          const user = { id: 'owner', role };
          const session = { id: 'session', owner_id: user.id, owner: 'Animateur', title: 'Quiz',
            description: 'Description', category: 'Sciences', cover: 'blue', mode: 'live',
            opens_at: Date.now() - 60000, closes_at: Date.now() + 60000, status: 'waiting', player_count: 0, question_count: 1 };
          const card = renderToStaticMarkup(createElement(SessionCard, { session, user, onJoin() {} }));
          assert.equal(card.includes('>Animer'), creator);
          assert.equal(card.includes('>Jouer'), !creator);
          const hero = renderToStaticMarkup(createElement(Hero, { creator, onDiscover() {}, onCreate() {} }));
          assert.equal(hero.includes('Créer un quiz'), creator);
        }
      } finally {
        await vite.close();
      }
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createGame } from '../server/game.js';

test('salles : approbation administrateur obligatoire et suppression persistante des participations non autorisées', async t => {
  const db = await openDatabase({ url: '', filename: ':memory:' });
  const service = createApp(db, 'access-test-secret-'.repeat(4), { test: true });
  const server = createServer(service.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const users = {};
  for (const role of ['admin', 'creator', 'player']) {
    const user = { id: randomUUID(), email: `${role}@access.test`, pseudo: role, role, verified: 1, token_version: 0 };
    await db.query('INSERT INTO users (id,email,password_hash,pseudo,role,verified,created_at) VALUES (?,?,?,?,?,1,?)',
      [user.id, user.email, 'not-a-login-hash', user.pseudo, user.role, Date.now()]);
    users[role] = { ...user, token: service.auth.access(user) };
  }
  async function request(path, user = users.player, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method,
      headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  async function fixture(mode = 'async', visibility = 'public') {
    const quiz = await request('/quizzes', users.creator, 'POST', {
      title: 'Quiz autorisé', description: 'Test des autorisations', category: 'Sciences', cover: 'blue', visibility, published: true,
      questions: [{ text: 'Quelle réponse choisir ?', explanation: '', duration: 120,
        answers: [{ text: 'Oui', correct: true }, { text: 'Non', correct: false }] }]
    });
    assert.equal(quiz.status, 201);
    const session = await request('/sessions', users.creator, 'POST', {
      quizId: quiz.body.id, mode, opensAt: Date.now() - 60000, closesAt: Date.now() + 600000, emails: [users.player.email]
    });
    assert.equal(session.status, 201);
    const detail = await request(`/quizzes/${quiz.body.id}`, users.creator);
    const [question] = await db.query('SELECT id FROM questions WHERE quiz_id=?', [quiz.body.id]);
    const [answer] = await db.query('SELECT id FROM answers WHERE question_id=? AND correct=1', [question.id]);
    return { id: session.body.id, question: question.id, answer: answer.id, code: detail.body.invitation_code };
  }
  async function seedParticipation(session, user = users.player) {
    const id = randomUUID();
    await db.query('INSERT INTO participations (id,session_id,user_id,score,status,question_order) VALUES (?,?,?,1000,?,?)',
      [id, session.id, user.id, 'playing', JSON.stringify([session.question])]);
    await db.query('INSERT INTO participation_answers (id,participation_id,question_id,answer_id,elapsed_ms,points) VALUES (?,?,?,?,100,1000)',
      [randomUUID(), id, session.question, session.answer]);
    return id;
  }
  await t.test('un lien, un code et une invitation ne suffisent jamais, même pour un quiz public', async () => {
    for (const visibility of ['public', 'private', 'invitation']) {
      const session = await fixture('async', visibility);
      const path = `/sessions/${session.id}`;
      const denied = await request(`${path}/join`, users.player, 'POST', { code: session.code });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, 'SESSION_UNAUTHORIZED');
      assert.match(denied.body.error, /Avertissement.*sans l’autorisation explicite/);
      assert.equal((await db.query('SELECT id FROM participations WHERE session_id=?', [session.id])).length, 0);
      const pending = await request(`${path}/access`, users.admin);
      assert.equal(pending.body.find(user => user.id === users.player.id).status, 'pending');
      assert.equal((await request(`${path}/access`, users.creator)).status, 403);
      assert.equal((await request(`${path}/access`, users.creator, 'POST', { email: users.player.email, approved: true })).status, 403);
      assert.equal((await request(`${path}/access`, users.player, 'POST', { email: users.player.email, approved: true })).status, 403);
      assert.equal((await request(`${path}/access`, users.admin, 'POST', { email: users.player.email, approved: true })).status, 200);
      assert.equal((await request(`${path}/join`, users.player, 'POST', {})).status, 200);
      assert.equal((await request(path)).status, 200);
      assert.equal((await createGame(db).snapshot(session.id, users.player)).id, session.id);
    }
  });
  await t.test('chaque voie d’accès supprime les réponses et la participation avant de refuser', async () => {
    const other = await fixture();
    await request(`/sessions/${other.id}/access`, users.admin, 'POST', { email: users.player.email, approved: true });
    const retainedId = await seedParticipation(other);
    for (const [route, method] of [['', 'GET'], ['/join', 'POST'], ['/start', 'POST'], ['/answer', 'POST'], ['/next', 'POST'], ['/report', 'GET']]) {
      const session = await fixture();
      const participation = await seedParticipation(session);
      const denied = await request(`/sessions/${session.id}${route}`, users.player, method,
        method === 'POST' ? { questionId: session.question, answerId: session.answer } : undefined);
      assert.equal(denied.status, 403, route);
      assert.equal(denied.body.code, 'SESSION_UNAUTHORIZED');
      assert.equal((await db.query('SELECT id FROM participations WHERE id=?', [participation])).length, 0);
      assert.equal((await db.query('SELECT id FROM participation_answers WHERE participation_id=?', [participation])).length, 0);
      assert.equal((await request('/me/history')).body.some(entry => entry.session_id === session.id), false);
      assert.equal((await db.query('SELECT id FROM users WHERE id=?', [users.player.id])).length, 1);
    }
    assert.equal((await db.query('SELECT id FROM participations WHERE id=?', [retainedId])).length, 1);
  });
  await t.test('une révocation efface aussi une partie terminée et interdit toute reconnexion', async () => {
    const session = await fixture();
    const path = `/sessions/${session.id}`;
    await request(`${path}/access`, users.admin, 'POST', { email: users.player.email, approved: true });
    await request(`${path}/join`, users.player, 'POST', {});
    await request(`${path}/start`, users.player, 'POST', {});
    assert.equal((await request(`${path}/answer`, users.player, 'POST', { questionId: session.question, answerId: session.answer })).status, 200);
    assert.equal((await request(`${path}/next`, users.player, 'POST', {})).status, 200);
    assert.equal((await request(path)).body.state, 'finished');
    assert.equal((await request(`${path}/access`, users.admin, 'POST', { email: users.player.email, approved: false })).status, 200);
    assert.equal((await request(path)).body.code, 'SESSION_UNAUTHORIZED');
    assert.equal((await request(`${path}/join`, users.player, 'POST', {})).body.code, 'SESSION_UNAUTHORIZED');
    assert.equal((await request(`${path}/report`, users.admin)).body.players.length, 0);
    assert.equal((await request(`${path}/access`, users.admin)).body.find(user => user.id === users.player.id).status, 'denied');
  });
  await t.test('au redémarrage les anciennes participations sans autorisation sont supprimées, pas les animateurs', async () => {
    const session = await fixture('live');
    const old = await seedParticipation(session);
    const host = await seedParticipation(session, users.creator);
    const cleaned = await service.game.enforceApprovals();
    assert.ok(cleaned.includes(session.id));
    assert.equal((await db.query('SELECT id FROM participations WHERE id=?', [old])).length, 0);
    assert.equal((await db.query('SELECT id FROM participation_answers WHERE participation_id=?', [old])).length, 0);
    assert.equal((await db.query('SELECT id FROM participations WHERE id=?', [host])).length, 1);
    assert.equal((await service.game.snapshot(session.id, users.creator)).host, true);
    assert.equal((await service.game.snapshot(session.id, users.admin)).host, true);
  });
  await t.test('approbation et révocation concurrentes ne laissent aucune participation après le refus', async () => {
    const session = await fixture();
    const path = `/sessions/${session.id}`;
    await request(`${path}/access`, users.admin, 'POST', { email: users.player.email, approved: true });
    await Promise.all([
      request(`${path}/join`, users.player, 'POST', {}),
      request(`${path}/access`, users.admin, 'POST', { email: users.player.email, approved: false })
    ]);
    assert.equal((await db.query('SELECT id FROM participations WHERE session_id=?', [session.id])).length, 0);
    assert.equal((await request(path)).status, 403);
  });
  await t.test('un compte suspendu ne peut être approuvé mais sa participation peut être supprimée', async () => {
    const session = await fixture();
    const participation = await seedParticipation(session);
    await db.query('UPDATE users SET disabled=1 WHERE id=?', [users.player.id]);
    try {
      const path = `/sessions/${session.id}/access`;
      assert.equal((await request(path, users.admin, 'POST', { email: users.player.email, approved: true })).status, 400);
      assert.equal((await request(path, users.admin, 'POST', { email: users.player.email, approved: false })).status, 200);
      assert.equal((await db.query('SELECT id FROM participations WHERE id=?', [participation])).length, 0);
    } finally {
      await db.query('UPDATE users SET disabled=0 WHERE id=?', [users.player.id]);
    }
  });
});

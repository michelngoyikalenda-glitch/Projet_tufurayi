import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createGame } from '../server/game.js';

let db, service, server, base, folder, clock, owner, player, stranger;
const mails = [];
const userIds = [];
let failEmailSend = false;
const prefix = randomUUID();
const secret = 'test-only-secret-'.repeat(4);
async function request(path, { method = 'GET', body, token, cookie, origin } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function requestMedia({ token, mime = 'image/png', data = Buffer.from([137, 80, 78, 71]) } = {}) {
  const response = await fetch(`${base}/api/media`, { method: 'POST', headers: {
    'Content-Type': 'application/octet-stream', 'X-Media-Type': mime, ...(token ? { Authorization: 'Bearer ' + token } : {})
  }, body: data });
  return { status: response.status, body: await response.json() };
}
async function register(name, role = 'player') {
  const email = `${prefix}-${name.toLowerCase()}@test.fr`;
  let r = await request('/auth/register', { method: 'POST', body: { email, pseudo: name, password: 'TestPassword2026!', role } });
  assert.equal(r.status, 201);
  const mail = mails.find(m => m.to === email);
  const token = mail.text.match(/verify=([a-f0-9]+)/)[1];
  r = await request('/auth/verify', { method: 'POST', body: { token } });
  assert.equal(r.status, 200);
  r = await request('/auth/login', { method: 'POST', body: { email, password: 'TestPassword2026!' } });
  assert.equal(r.status, 200);
  userIds.push(r.body.user.id);
  return { ...r.body.user, token: r.body.token, cookie: r.cookie };
}
const quizBody = visibility => ({
  title: `${prefix} Quiz de test`, description: 'Un quiz de test', category: 'Sciences', cover: 'blue', visibility, published: true,
  questions: [1, 2].map(i => ({ text: `Question de test ${i} ?`, duration: 5, explanation: 'Une explication utile.',
    answers: [{ text: 'Oui', correct: true }, { text: 'Non', correct: false }] }))
});
async function fixture(mode = 'async', visibility = 'public', emails = [], questionCount = 2, media = null) {
  const body = quizBody(visibility);
  body.questions = Array.from({ length: questionCount }, (_, index) => ({ ...body.questions[0],
    text: `Question de test ${index + 1} ?`, mediaUrl: media?.url || null, mediaType: media?.type || null }));
  const quiz = await request('/quizzes', { method: 'POST', token: owner.token, body });
  assert.equal(quiz.status, 201);
  const detail = await request(`/quizzes/${quiz.body.id}`, { token: owner.token });
  const session = await request('/sessions', { method: 'POST', token: owner.token,
    body: { quizId: quiz.body.id, mode, opensAt: clock - 60000, closesAt: clock + 86400000, emails } });
  assert.equal(session.status, 201);
  for (const userId of userIds) await db.query(`INSERT INTO session_access (session_id,user_id,status,requested_at)
    VALUES (?,?,'approved',?)`, [session.body.id, userId, clock]);
  return { quiz: detail.body, id: session.body.id };
}
async function correctAnswer(questionId) {
  const [a] = await db.query('SELECT id FROM answers WHERE question_id=? AND correct=1', [questionId]); return a.id;
}

before(async () => {
  clock = Date.now();
  folder = await mkdtemp(join(tmpdir(), 'tufurayi-test-'));
  db = await openDatabase({ url: process.env.TEST_DATABASE_URL || '', filename: join(folder, 'test.sqlite') });
  service = createApp(db, secret, { test: true, clock: () => clock, origin: 'http://localhost:5173', mediaDir: join(folder, 'media'),
    mailer: { async sendMail(mail) { if (failEmailSend) throw new Error('Échec SMTP simulé.'); mails.push(mail); } } });
  server = createServer(service.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await register('Createur', 'creator');
  player = await register('Joueur');
  stranger = await register('Autre');
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  const placeholders = userIds.map(() => '?').join(',');
  if (userIds.length) await db.transaction(async tx => {
    await tx.query(`DELETE FROM reports WHERE user_id IN (${placeholders})`, userIds);
    await tx.query(`DELETE FROM feedback WHERE user_id IN (${placeholders})`, userIds);
    await tx.query(`DELETE FROM session_access WHERE user_id IN (${placeholders}) OR decided_by IN (${placeholders})`, [...userIds, ...userIds]);
    await tx.query(`DELETE FROM session_exclusions WHERE user_id IN (${placeholders}) OR excluded_by IN (${placeholders})`, [...userIds, ...userIds]);
    await tx.query(`DELETE FROM participation_answers WHERE participation_id IN (SELECT id FROM participations WHERE user_id IN (${placeholders}))`, userIds);
    await tx.query(`DELETE FROM participations WHERE user_id IN (${placeholders})`, userIds);
    await tx.query('DELETE FROM invitations WHERE session_id IN (SELECT s.id FROM sessions s JOIN quizzes q ON q.id=s.quiz_id WHERE q.owner_id=?)', [owner.id]);
    await tx.query('DELETE FROM sessions WHERE quiz_id IN (SELECT id FROM quizzes WHERE owner_id=?)', [owner.id]);
    await tx.query('DELETE FROM answers WHERE question_id IN (SELECT qs.id FROM questions qs JOIN quizzes q ON q.id=qs.quiz_id WHERE q.owner_id=?)', [owner.id]);
    await tx.query('DELETE FROM questions WHERE quiz_id IN (SELECT id FROM quizzes WHERE owner_id=?)', [owner.id]);
    await tx.query('DELETE FROM quizzes WHERE owner_id=?', [owner.id]);
    await tx.query(`DELETE FROM auth_tokens WHERE user_id IN (${placeholders})`, userIds);
    await tx.query(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);
  });
  await db.close();
  for (const filename of ['test.sqlite', 'test.sqlite-wal', 'test.sqlite-shm']) await rm(join(folder, filename), { force: true });
  await rm(join(folder, 'media'), { recursive: true, force: true });
  await rmdir(folder);
});

test('auth : protections, mot de passe et email vérifié obligatoire', async () => {
  assert.equal((await request('/health', { origin: 'http://127.0.0.1:5173' })).status, 200);
  assert.equal((await request('/health', { origin: 'http://127.0.0.1:5174' })).status, 403);
  assert.equal((await request('/quizzes')).status, 401);
  assert.equal((await request('/auth/register', { method: 'POST', body: { email: 'bad', password: 'short', pseudo: 'X' } })).status, 400);
  assert.equal((await request('/auth/register', { method: 'POST', body: { email: 'long@test.fr', password: 'é'.repeat(40), pseudo: 'Trop long' } })).status, 400);
  assert.equal((await request('/auth/register', { method: 'POST', body: { email: 'admin-test@test.fr', password: 'TestPassword2026!', pseudo: 'Admin', role: 'admin' } })).status, 400);
  const fort = `${prefix}-fort@test.fr`;
  assert.equal((await request('/auth/register', { method: 'POST', body: { email: fort, password: 'Fort1234', pseudo: 'Fort' } })).status, 201);
  userIds.push((await db.query('SELECT id FROM users WHERE email=?', [fort]))[0].id);
  assert.equal((await request('/auth/register', { method: 'POST', body: { email: `${prefix}-faible@test.fr`, password: 'motdepasse', pseudo: 'Faible' } })).status, 400);
  assert.equal((await request('/auth/register', { method: 'POST', body: { email: `${prefix}-court@test.fr`, password: 'Fort123', pseudo: 'Court' } })).status, 400);
  assert.deepEqual((await request('/auth/providers')).body, { google: false, apple: false });
  assert.equal((await request('/auth/oauth/google')).status, 503);
  assert.equal((await request('/auth/oauth/apple')).status, 503);
  const email = `${prefix}-non-verifie@test.fr`;
  assert.equal((await request('/auth/register', { method: 'POST', body: { email, password: 'TestPassword2026!', pseudo: 'Non vérifié' } })).status, 201);
  const [user] = await db.query('SELECT id FROM users WHERE email=?', [email]); userIds.push(user.id);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email, password: 'TestPassword2026!' } })).status, 403);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: player.email, password: 'mauvais' } })).status, 401);
  assert.equal((await request('/auth/refresh', { method: 'POST', cookie: player.cookie, origin: 'https://evil.example' })).status, 403);
});

test('validation : messages en français', async () => {
  const result = await request('/auth/register', { method: 'POST', body: {
    email: 'adresse-invalide', password: 'TestPassword2026!', pseudo: 'Joueur'
  } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /invalide/i);
  assert.doesNotMatch(result.body.error, /\b(invalid|expected|received)\b/i);
});

test('refresh : rotation à usage unique et cookie HttpOnly', async () => {
  const login = await request('/auth/login', { method: 'POST', body: { email: player.email, password: 'TestPassword2026!' } });
  const refreshed = await request('/auth/refresh', { method: 'POST', cookie: login.cookie });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.cookie, login.cookie);
  assert.equal((await request('/auth/refresh', { method: 'POST', cookie: login.cookie })).status, 401);
  assert.equal((await request('/auth/logout', { method: 'POST', cookie: refreshed.cookie })).status, 200);
  assert.equal((await request('/auth/refresh', { method: 'POST', cookie: refreshed.cookie })).status, 401);
});

test('éditeur : rôle, validation des réponses et immutabilité après planification', async () => {
  assert.equal((await request('/quizzes', { method: 'POST', token: player.token, body: quizBody('public') })).status, 403);
  const bad = quizBody('public'); bad.questions[0].answers[1].correct = true;
  assert.equal((await request('/quizzes', { method: 'POST', token: owner.token, body: bad })).status, 400);
  const incomplete = quizBody('public');
  incomplete.questions[1].text = '  ';
  incomplete.questions[1].answers[0].text = '';
  incomplete.questions[1].answers[1].text = ' ';
  const invalid = await request('/quizzes', { method: 'POST', token: owner.token, body: incomplete });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /Question 2 : L’énoncé/);
  assert.match(invalid.body.error, /Question 2, réponse 1 : Saisissez/);
  assert.match(invalid.body.error, /Question 2, réponse 2 : Saisissez/);
  assert.doesNotMatch(invalid.body.error, /Trop petit|>=/);
  const { quiz } = await fixture();
  assert.equal((await request(`/quizzes/${quiz.id}`, { method: 'PUT', token: owner.token, body: quizBody('public') })).status, 409);
  const publicDetail = await request(`/quizzes/${quiz.id}`, { token: player.token });
  assert.equal(publicDetail.status, 200);
  assert.equal(publicDetail.body.questions, undefined);
  assert.equal(publicDetail.body.invitation_code, undefined);
});

test('réclamation : envoi joueur, consultation administrateur et traitement', async () => {
  assert.equal((await request('/feedback', { method: 'POST', body: { category: 'Fraude', message: 'Je signale une fraude.' } })).status, 401);
  assert.equal((await request('/feedback', { method: 'POST', token: player.token,
    body: { email: 'joueur@test.fr', category: 'invalide', message: 'Description suffisamment longue.' } })).status, 400);
  assert.equal((await request('/feedback', { method: 'POST', token: player.token,
    body: { email: 'adresse-invalide', category: 'Réclamation', message: 'Description suffisamment longue.' } })).status, 400);
  assert.equal((await request('/feedback', { method: 'POST', token: player.token,
    body: { email: 'joueur@test.fr', category: 'Réclamation', message: '   court ' } })).status, 400);
  failEmailSend = true;
  const failedReceipt = await request('/feedback', { method: 'POST', token: player.token,
    body: { email: 'accuse@test.fr', category: 'Réclamation', message: 'Mon accusé de réception doit être transmis.' } });
  failEmailSend = false;
  assert.equal(failedReceipt.status, 500);
  assert.equal((await db.query('SELECT id FROM feedback WHERE user_id=?', [player.id])).length, 0);
  const submitted = await request('/feedback', { method: 'POST', token: player.token,
    body: { email: 'contact-joueur@test.fr', category: 'Favoritisme', message: 'Je souhaite signaler un favoritisme pendant une partie.' } });
  assert.equal(submitted.status, 201);
  const receipt = mails.at(-1);
  assert.equal(receipt.to, 'contact-joueur@test.fr');
  assert.match(receipt.subject, /Accusé de réception/);
  assert.match(receipt.text, /Nous avons bien reçu votre demande/);
  assert.match(receipt.text, /Favoritisme/);
  assert.equal((await request('/admin', { token: player.token })).status, 403);
  await db.query("UPDATE users SET role='admin' WHERE id=?", [owner.id]);
  try {
    const feedback = (await request('/admin', { token: owner.token })).body.feedback
      .find(item => item.pseudo === player.pseudo && item.category === 'Favoritisme');
    assert.ok(feedback);
    assert.equal(feedback.message, 'Je souhaite signaler un favoritisme pendant une partie.');
    assert.equal(feedback.receipt_email, 'contact-joueur@test.fr');
    assert.equal((await request(`/admin/feedback/${feedback.id}`, { method: 'PUT', token: player.token,
      body: { status: 'resolved' } })).status, 403);
    assert.equal((await request(`/admin/feedback/${feedback.id}`, { method: 'PUT', token: owner.token,
      body: { status: 'resolved' } })).status, 200);
    assert.equal((await request('/admin', { token: owner.token })).body.feedback.find(item => item.id === feedback.id).status, 'resolved');
  } finally {
    await db.query("UPDATE users SET role='creator' WHERE id=?", [owner.id]);
  }
});

test('médias : import réservé aux créateurs, conservation avec la question et lecture en jeu', async () => {
  assert.equal((await requestMedia({ token: player.token })).status, 403);
  assert.equal((await requestMedia({ token: owner.token, mime: 'application/pdf' })).status, 400);
  const uploaded = await requestMedia({ token: owner.token });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.type, 'image');
  assert.equal((await fetch(`${base}${uploaded.body.url}`)).status, 200);
  const { quiz, id } = await fixture('async', 'public', [], 1, uploaded.body);
  assert.equal(quiz.questions[0].mediaUrl, uploaded.body.url);
  assert.equal(quiz.questions[0].mediaType, 'image');
  await request(`/sessions/${id}/join`, { method: 'POST', token: player.token, body: {} });
  const begun = await request(`/sessions/${id}/start`, { method: 'POST', token: player.token, body: {} });
  assert.equal(begun.body.question.mediaUrl, uploaded.body.url);
  assert.equal(begun.body.question.mediaType, 'image');
});

test('différé : participation unique, réponses masquées, reprise, correction et historique', async () => {
  const { id } = await fixture();
  const first = await request(`/sessions/${id}/join`, { method: 'POST', token: player.token, body: {} });
  assert.equal(first.status, 200);
  assert.equal(first.body.state, 'waiting');
  assert.equal(first.body.question, null);
  const begun = await request(`/sessions/${id}/start`, { method: 'POST', token: player.token, body: {} });
  assert.equal(begun.status, 200);
  assert.equal(begun.body.state, 'playing');
  assert.equal(begun.body.question.answers.some(a => 'correct' in a), false);
  assert.equal(begun.body.question.explanation, undefined);
  const qid = begun.body.question.id;
  const again = await request(`/sessions/${id}/join`, { method: 'POST', token: player.token, body: {} });
  assert.equal(again.body.question.id, qid);
  assert.deepEqual(again.body.question.answers, begun.body.question.answers);
  assert.equal((await db.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [id, player.id])).length, 1);
  const answerId = await correctAnswer(qid);
  clock += 1000;
  assert.equal((await request(`/sessions/${id}/answer`, { method: 'POST', token: player.token, body: { questionId: qid, answerId, points: 999999 } })).body.points, 450);
  assert.equal((await request(`/sessions/${id}/answer`, { method: 'POST', token: player.token, body: { questionId: qid, answerId } })).status, 409);
  const review = await request(`/sessions/${id}`, { token: player.token });
  assert.equal(review.body.state, 'review');
  assert.equal(review.body.score, 450);
  assert.equal(review.body.question.points, 450);
  assert.equal(review.body.question.answers.filter(a => a.correct).length, 1);
  const next = await request(`/sessions/${id}/next`, { method: 'POST', token: player.token, body: {} });
  assert.notEqual(next.body.question.id, qid);
  assert.equal((await request(`/sessions/${id}/answer`, { method: 'POST', token: player.token, body: { questionId: qid, answerId } })).status, 409);
  const secondId = next.body.question.id;
  await request(`/sessions/${id}/answer`, { method: 'POST', token: player.token, body: { questionId: secondId, answerId: await correctAnswer(secondId) } });
  const end = await request(`/sessions/${id}/next`, { method: 'POST', token: player.token, body: {} });
  assert.equal(end.body.state, 'finished');
  assert.equal(end.body.score, 950);
  assert.equal(end.body.correction.length, 2);
  assert.equal((await request('/me/history', { token: player.token })).body.find(h => h.session_id === id).status, 'finished');
  assert.equal((await request('/leaderboard', { token: player.token })).body.find(p => p.id === player.id).score, 950);
  await service.game.join(id, stranger);
  const report = await request(`/sessions/${id}/report`, { token: player.token });
  assert.equal(report.status, 200);
  assert.equal(report.body.scope, 'individual');
  assert.equal(report.body.players.length, 1);
  assert.equal(report.body.players[0].id, player.id);
  assert.equal(report.body.question_count, 2);
  assert.equal(report.body.players[0].score, 950);
  assert.equal(report.body.players[0].correct, 2);
  assert.equal((await request(`/sessions/${id}/report?scope=collective`, { token: player.token })).status, 403);
  assert.equal((await request(`/sessions/${id}/report`, { token: owner.token })).status, 403);
  const [previousRole] = await db.query('SELECT role FROM users WHERE id=?', [owner.id]);
  await db.query("UPDATE users SET role='admin' WHERE id=?", [owner.id]);
  try {
    const collective = await request(`/sessions/${id}/report?scope=collective`, { token: owner.token });
    assert.equal(collective.status, 200);
    assert.equal(collective.body.scope, 'collective');
    assert.equal(collective.body.players.length, 2);
    assert.deepEqual(new Set(collective.body.players.map(p => p.id)), new Set([player.id, stranger.id]));
    assert.equal((await request(`/sessions/${id}/report`, { token: owner.token })).status, 403);
    assert.equal((await request(`/sessions/${id}/report?scope=unknown`, { token: owner.token })).status, 400);
  } finally {
    await db.query('UPDATE users SET role=? WHERE id=?', [previousRole.role, owner.id]);
  }
});

test('différé : temps écoulé pendant une déconnexion, aucune réponse tardive récompensée', async () => {
  const { id } = await fixture();
  await request(`/sessions/${id}/join`, { method: 'POST', token: stranger.token, body: {} });
  const start = await request(`/sessions/${id}/start`, { method: 'POST', token: stranger.token, body: {} });
  clock += 5000;
  const answer = await request(`/sessions/${id}/answer`, { method: 'POST', token: stranger.token, body: { questionId: start.body.question.id, answerId: await correctAnswer(start.body.question.id) } });
  assert.equal(answer.body.points, 0);
  const next = await request(`/sessions/${id}/next`, { method: 'POST', token: stranger.token, body: {} });
  clock += 6000;
  const resumed = await request(`/sessions/${id}`, { token: stranger.token });
  assert.equal(resumed.body.state, 'review');
  assert.equal(resumed.body.score, 0);
  assert.equal(resumed.body.question.id, next.body.question.id);
  assert.equal(resumed.body.question.selected, null);
});

test('direct : synchronisation, non-divulgation des scores, deadline, classement et reconnexion', async () => {
  const { id } = await fixture('live');
  await service.game.join(id, player);
  await service.game.join(id, stranger);
  assert.equal((await service.game.snapshot(id, player)).state, 'waiting');
  await assert.rejects(service.game.control(id, player, 'start'), e => e.status === 403);
  await service.game.control(id, owner, 'start');
  const a = await service.game.snapshot(id, player), b = await service.game.snapshot(id, stranger);
  assert.equal(a.question.id, b.question.id);
  assert.equal(a.question.endsAt, b.question.endsAt);
  const qid = a.question.id;
  await service.game.answer(id, player, await correctAnswer(qid), qid);
  const concealed = await service.game.snapshot(id, player);
  assert.equal(concealed.score, 0);
  assert.equal(concealed.players.find(p => p.id === player.id).score, 0);
  assert.equal(concealed.question.answers.some(a => 'correct' in a), false);
  assert.equal(concealed.question.points, undefined);
  assert.equal(concealed.answered, true);
  const history = await request('/me/history', { token: player.token });
  assert.equal(history.body.find(h => h.session_id === id).score, 0);
  assert.equal(history.body.find(h => h.session_id === id).question_order, undefined);
  await assert.rejects(service.game.control(id, owner, 'next'), e => e.status === 409);
  clock += 5000;
  await service.game.tick();
  const review = await service.game.snapshot(id, player);
  assert.equal(review.state, 'review'); assert.equal(review.score, 500);
  assert.equal(review.players[0].id, player.id);
  assert.equal((await service.game.snapshot(id, stranger)).question.points, 0);
  await service.game.control(id, owner, 'next');
  await service.game.join(id, player);
  assert.notEqual((await service.game.snapshot(id, player)).question.id, qid);
  await assert.rejects(service.game.join(id, { ...player, id: owner.id }), e => e.status === 409);
  clock += 5000;
  await service.game.tick(); await service.game.control(id, owner, 'next');
  assert.equal((await service.game.snapshot(id, player)).state, 'finished');
});

test('concurrence : une seule réponse prise en compte', async () => {
  const { id } = await fixture();
  await service.game.join(id, player);
  await service.game.begin(id, player);
  const start = await service.game.snapshot(id, player), qid = start.question.id, answerId = await correctAnswer(qid);
  const results = await Promise.allSettled([service.game.answer(id, player, answerId, qid), service.game.answer(id, player, answerId, qid)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await service.game.snapshot(id, player)).score, 500);
});

test('scores sur 1000 : limites, arrondis, anciens résultats et cumul de plusieurs quiz', async () => {
  const participant = await register('ScoreTest');
  for (const mode of ['async', 'live']) {
    const { id, quiz } = await fixture(mode, 'public', [], 3);
    await service.game.join(id, participant);
    if (mode === 'live') await service.game.control(id, owner, 'start');
    else await service.game.begin(id, participant);
    let contributions = 0;
    for (let index = 0; index < 3; index++) {
      const current = await service.game.snapshot(id, participant);
      const answer = await service.game.answer(id, participant, await correctAnswer(current.question.id), current.question.id);
      if (mode === 'live') {
        assert.equal((await service.game.snapshot(id, participant)).score, Math.round(index * 1000 / 3));
        clock += 5000;
        await service.game.tick();
      }
      const review = await service.game.snapshot(id, participant);
      contributions += review.question.points;
      assert.equal(review.score, Math.round((index + 1) * 1000 / 3));
      if (mode === 'async') assert.equal(answer.points, review.question.points);
      if (mode === 'live') await service.game.control(id, owner, 'next');
      else await service.game.next(id, participant);
    }
    const end = await service.game.snapshot(id, participant);
    assert.equal(end.score, 1000);
    assert.equal(contributions, 1000);
    assert.equal(end.correction.reduce((sum, correction) => sum + correction.points, 0), 1000);
    assert.equal(end.players.find(entry => entry.id === participant.id).score, 1000);
    const history = await request('/me/history', { token: participant.token });
    assert.equal(history.body.find(entry => entry.session_id === id).score, 1000);
    const stats = await request(`/quizzes/${quiz.id}/stats`, { token: owner.token });
    assert.equal(stats.body.players.find(entry => entry.pseudo === participant.pseudo).score, 1000);
    const report = await request(`/sessions/${id}/report`, { token: participant.token });
    assert.equal(report.body.players.find(entry => entry.id === participant.id).score, 1000);
    const [stored] = await db.query('SELECT score FROM participations WHERE session_id=? AND user_id=?', [id, participant.id]);
    assert.equal(stored.score, 3000);
    const recreated = createGame(db, { clock: () => clock });
    assert.equal((await recreated.snapshot(id, participant)).score, 1000);
  }
  const { id } = await fixture('async', 'public', [], 1);
  await service.game.join(id, participant);
  await service.game.begin(id, participant);
  const start = await service.game.snapshot(id, participant);
  await service.game.answer(id, participant, await correctAnswer(start.question.id), start.question.id);
  await service.game.next(id, participant);
  assert.equal((await service.game.snapshot(id, participant)).score, 1000);
  assert.equal((await request('/leaderboard', { token: participant.token })).body.find(entry => entry.id === participant.id).score, 3000);
});

test('invitations privées et code : aucun accès non autorisé, accès durable après inscription', async () => {
  const privateSession = await fixture('async', 'private', [player.email]);
  await assert.rejects(service.game.join(privateSession.id, stranger), e => e.status === 403 && /adresse.*invitée/i.test(e.message));
  await service.game.join(privateSession.id, player);
  const catalogue = await request('/sessions', { token: stranger.token });
  assert.equal(catalogue.body.some(s => s.id === privateSession.id), false);
  const coded = await fixture('async', 'invitation');
  await assert.rejects(service.game.join(coded.id, player, 'FAUX'), e => e.status === 403 && /code d’invitation/i.test(e.message));
  await service.game.join(coded.id, player, coded.quiz.invitation_code);
  assert.equal((await service.game.snapshot(coded.id, player)).state, 'waiting');
  await service.game.begin(coded.id, player);
  assert.equal((await service.game.snapshot(coded.id, player)).state, 'playing');
  const listing = await request('/sessions', { token: player.token });
  assert.equal(listing.body.find(s => s.id === coded.id).invitation_code, null);
  assert.equal(listing.body.find(s => s.id === coded.id).question_order, undefined);
});

test('invitations : les codes sont disponibles pour l’animateur uniquement', async () => {
  for (const visibility of ['public', 'private', 'invitation']) {
    const { id, quiz } = await fixture('async', visibility, [player.email]);
    const own = (await request('/sessions', { token: owner.token })).body.find(session => session.id === id);
    assert.equal(own.invitation_code, quiz.invitation_code);
    assert.equal(own.visibility, visibility);
    const invited = (await request('/sessions', { token: player.token })).body.find(session => session.id === id);
    assert.equal(invited.invitation_code, null);
  }
});

test('exclusion : autorisations, salle d’attente, retour bloqué et autres sessions préservées', async () => {
  const { id, quiz } = await fixture('live', 'invitation');
  await service.game.join(id, player, quiz.invitation_code);
  const path = `/sessions/${id}/players/${player.id}/exclude`;
  assert.equal((await request(`/sessions/${id}/players`, { token: player.token })).status, 403);
  assert.equal((await request(path, { method: 'POST', token: stranger.token })).status, 403);
  assert.equal((await request(path, { method: 'POST' })).status, 401);
  assert.equal((await request(`/sessions/${id}/players/${owner.id}/exclude`, { method: 'POST', token: owner.token })).status, 400);
  assert.equal((await request(`/sessions/${id}/players/${stranger.id}/exclude`, { method: 'POST', token: owner.token })).status, 404);
  assert.equal((await request(path, { method: 'POST', token: owner.token })).status, 200);
  assert.equal((await request(path, { method: 'POST', token: owner.token })).status, 200);
  const roster = await request(`/sessions/${id}/players`, { token: owner.token });
  assert.equal(roster.body.find(entry => entry.id === player.id).excluded, true);
  assert.equal(roster.body.find(entry => entry.id === player.id).can_exclude, false);
  await assert.rejects(service.game.join(id, player, quiz.invitation_code), error => error.code === 'SESSION_EXCLUDED');
  await assert.rejects(service.game.snapshot(id, player), error => error.code === 'SESSION_EXCLUDED');
  await assert.rejects(service.game.control(id, owner, 'start'), error => error.status === 409);
  assert.equal((await request(`/sessions/${id}`, { token: player.token })).status, 403);
  assert.equal((await request(`/sessions/${id}/report`, { token: player.token })).status, 403);
  assert.equal((await request('/sessions', { token: player.token })).body.some(s => s.id === id), false);
  const history = (await request('/me/history', { token: player.token })).body.find(h => h.session_id === id);
  assert.equal(history.excluded, true);
  assert.equal(history.score, 0);
  const recreated = createGame(db, { clock: () => clock });
  await assert.rejects(recreated.join(id, player), error => error.code === 'SESSION_EXCLUDED');
  const other = await fixture();
  await service.game.join(other.id, player);
  await service.game.begin(other.id, player);
  assert.equal((await service.game.snapshot(other.id, player)).state, 'playing');
});

test('exclusion : résultats conservés en cours de jeu et après la fin, en direct et en différé', async () => {
  for (const mode of ['live', 'async']) {
    for (const completed of [false, true]) {
      const { id } = await fixture(mode);
      await service.game.join(id, player);
      if (mode === 'live') await service.game.control(id, owner, 'start');
      else await service.game.begin(id, player);
      const start = await service.game.snapshot(id, player);
      await service.game.answer(id, player, await correctAnswer(start.question.id), start.question.id);
      if (completed) {
        if (mode === 'live') {
          clock += 5000; await service.game.tick(); await service.game.control(id, owner, 'next');
          clock += 5000; await service.game.tick(); await service.game.control(id, owner, 'next');
        } else {
          await service.game.next(id, player);
          const second = await service.game.snapshot(id, player);
          await service.game.answer(id, player, await correctAnswer(second.question.id), second.question.id);
          await service.game.next(id, player);
        }
      }
      const [before] = await db.query('SELECT * FROM participations WHERE session_id=? AND user_id=?', [id, player.id]);
      const answers = await db.query('SELECT * FROM participation_answers WHERE participation_id=? ORDER BY id', [before.id]);
      assert.equal((await request(`/sessions/${id}/players/${player.id}/exclude`, { method: 'POST', token: owner.token })).status, 200);
      await assert.rejects(service.game.answer(id, player, await correctAnswer(start.question.id), start.question.id), error => error.code === 'SESSION_EXCLUDED');
      await assert.rejects(service.game.next(id, player), error => error.code === 'SESSION_EXCLUDED');
      if (!completed && mode === 'live') { clock += 5000; await service.game.tick(); }
      const [after] = await db.query('SELECT * FROM participations WHERE id=?', [before.id]);
      assert.equal(after.score, before.score);
      assert.equal(after.status, 'finished');
      if (completed) assert.equal(after.finished_at, before.finished_at);
      assert.deepEqual(await db.query('SELECT * FROM participation_answers WHERE participation_id=? ORDER BY id', [before.id]), answers);
      const [previousRole] = await db.query('SELECT role FROM users WHERE id=?', [owner.id]);
      await db.query("UPDATE users SET role='admin' WHERE id=?", [owner.id]);
      try {
        const report = await request(`/sessions/${id}/report?scope=collective`, { token: owner.token });
        assert.equal(report.body.players.find(entry => entry.id === player.id).excluded, true);
        assert.equal(report.body.players.find(entry => entry.id === player.id).score, Math.round(before.score / 2));
      } finally {
        await db.query('UPDATE users SET role=? WHERE id=?', [previousRole.role, owner.id]);
      }
      const board = (await service.game.snapshot(id, owner)).players.find(entry => entry.id === player.id);
      assert.equal(board.excluded, true);
      assert.equal(board.score, Math.round(before.score / 2));
    }
  }
});

test('sessions : plage de dates et expiration globale', async () => {
  const { id } = await fixture();
  await service.game.join(id, player);
  await db.query('UPDATE sessions SET closes_at=? WHERE id=?', [clock - 1, id]);
  await service.game.tick();
  assert.equal((await service.game.snapshot(id, player)).state, 'finished');
  await assert.rejects(service.game.join(id, stranger), e =>
    e.status === 409 && e.message === 'Cette session est terminée. Demandez à l’animateur de planifier une nouvelle session.');
  await assert.rejects(service.game.next(id, player), e => e.status === 409);
});

test('reprise après recréation du moteur : état et deadline persistants', async () => {
  const { id } = await fixture();
  await service.game.join(id, player);
  await service.game.begin(id, player);
  const previous = await service.game.snapshot(id, player);
  const recreated = createGame(db, { clock: () => clock });
  const resumed = await recreated.snapshot(id, player);
  assert.equal(previous.question.id, resumed.question.id);
  assert.equal(previous.question.endsAt, resumed.question.endsAt);
  assert.deepEqual(previous.question.answers, resumed.question.answers);
});

test('statistiques et modération : accès créateur et administrateur', async () => {
  const { quiz, id } = await fixture();
  await service.game.join(id, player);
  assert.equal((await request(`/quizzes/${quiz.id}/stats`, { token: player.token })).status, 403);
  assert.equal((await request(`/quizzes/${quiz.id}/stats`, { token: owner.token })).status, 200);
  assert.equal((await request('/admin', { token: owner.token })).status, 403);
  await request(`/quizzes/${quiz.id}/report`, { method: 'POST', token: player.token, body: { reason: 'Contenu de démonstration à vérifier.' } });
  const [administrator] = await db.query('SELECT * FROM users WHERE id=?', [owner.id]);
  await db.query("UPDATE users SET role='admin' WHERE id=?", [owner.id]);
  await service.game.join(id, owner);
  await service.game.begin(id, owner);
  const data = await request('/admin', { token: owner.token });
  const adminSession = data.body.sessions.find(s => s.id === id);
  assert.ok(adminSession);
  assert.equal(adminSession.participation_status, 'playing');
  assert.equal(typeof adminSession.opens_at, 'number');
  await db.query("UPDATE participations SET status='finished' WHERE session_id=? AND user_id=?", [id, owner.id]);
  assert.equal((await request('/admin', { token: owner.token })).body.sessions.find(s => s.id === id).participation_status, 'finished');
  assert.equal((await request(`/sessions/${id}/report`, { token: owner.token })).status, 200);
  const report = data.body.reports.find(r => r.title === quiz.title && r.status === 'open');
  assert.equal((await request(`/admin/reports/${report.id}`, { method: 'PUT', token: owner.token, body: { hide: true } })).status, 200);
  assert.equal((await service.game.snapshot(id, player)).state, 'finished');
  assert.equal((await request(`/quizzes/${quiz.id}`, { token: player.token })).status, 403);
  assert.equal((await request(`/admin/users/${owner.id}`, { method: 'PUT', token: owner.token, body: { role: 'player', disabled: true } })).status, 400);
  assert.equal((await request(`/admin/users/${stranger.id}`, { method: 'PUT', token: owner.token, body: { role: 'player', disabled: true } })).status, 200);
  assert.equal((await request('/me', { token: stranger.token })).status, 401);
  await db.query('UPDATE users SET role=? WHERE id=?', [administrator.role, owner.id]);
});

test('administrateur : retrait du catalogue sans suppression des sessions ni des résultats', async () => {
  const { quiz, id } = await fixture('async', 'public', [], 1);
  await service.game.join(id, player);
  const begun = await request(`/sessions/${id}/start`, { method: 'POST', token: player.token, body: {} });
  await service.game.answer(id, player, await correctAnswer(begun.body.question.id), begun.body.question.id);
  await db.query("UPDATE sessions SET status='ended' WHERE id=?", [id]);
  await db.query("UPDATE users SET role='admin' WHERE id=?", [owner.id]);
  try {
    const adminData = await request('/admin', { token: owner.token });
    const listed = adminData.body.quizzes.find(item => item.id === quiz.id);
    const listedSession = adminData.body.sessions.find(item => item.id === id);
    assert.ok(listed);
    assert.ok(listedSession);
    assert.equal(listedSession.quiz_id, quiz.id);
    assert.equal(Number(listedSession.published), 1);
    assert.equal(Number(listed.session_count), 1);
    assert.equal(Number(listed.player_count), 1);
    assert.equal((await request(`/admin/quizzes/${quiz.id}/archive`, { method: 'POST', token: player.token })).status, 403);
    assert.equal((await request('/admin/quizzes/not-a-quiz/archive', { method: 'POST', token: owner.token })).status, 404);
    assert.equal((await request(`/admin/quizzes/${quiz.id}/archive`, { method: 'POST', token: owner.token })).status, 200);
    assert.equal((await request(`/admin/quizzes/${quiz.id}/archive`, { method: 'POST', token: owner.token })).status, 409);

    const [storedQuiz] = await db.query('SELECT published FROM quizzes WHERE id=?', [quiz.id]);
    assert.equal(storedQuiz.published, 0);
    assert.equal((await db.query('SELECT id FROM sessions WHERE id=?', [id])).length, 1);
    assert.equal((await db.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [id, player.id])).length, 1);
    assert.equal((await db.query('SELECT id FROM participation_answers WHERE participation_id IN (SELECT id FROM participations WHERE session_id=?)', [id])).length, 1);
    assert.equal((await request(`/quizzes/${quiz.id}`, { token: player.token })).status, 403);
    assert.equal((await request(`/sessions/${id}`, { token: player.token })).status, 200);
  } finally {
    await db.query("UPDATE users SET role='creator' WHERE id=?", [owner.id]);
  }
});

test('rôles : un ancien créateur devenu joueur perd toutes les fonctions de gestion', async () => {
  const { quiz, id } = await fixture('live', 'invitation');
  await service.game.join(id, owner);
  await db.query("UPDATE users SET role='player' WHERE id=?", [owner.id]);
  try {
    const [demoted] = await db.query('SELECT * FROM users WHERE id=?', [owner.id]);
    assert.equal((await service.game.snapshot(id, demoted)).host, false);
    await assert.rejects(service.game.control(id, demoted, 'start'), { status: 403 });
    await assert.rejects(service.game.players(id, demoted), { status: 403 });
    await assert.rejects(service.game.exclude(id, demoted, player.id), { status: 403 });
    assert.equal((await request(`/quizzes/${quiz.id}`, { token: owner.token })).status, 403);
    assert.equal((await request('/quizzes', { token: owner.token })).body.some(q => q.id === quiz.id), false);
    const session = (await request('/sessions', { token: owner.token })).body.find(s => s.id === id);
    assert.ok(session);
    assert.equal(session.invitation_code, null);
    assert.equal((await request(`/sessions/${id}/players`, { token: owner.token })).status, 403);
    assert.equal((await request(`/sessions/${id}/control`, { method: 'POST', token: owner.token, body: { action: 'start' } })).status, 403);
    assert.equal((await request(`/quizzes/${quiz.id}/stats`, { token: owner.token })).status, 403);
    assert.equal((await request('/admin', { token: owner.token })).status, 403);
  } finally {
    await db.query("UPDATE users SET role='creator' WHERE id=?", [owner.id]);
  }
  assert.equal((await request(`/quizzes/${quiz.id}/stats`, { token: owner.token })).status, 200);
  assert.equal((await service.game.snapshot(id, owner)).host, true);
});

test('réinitialisation : lien unique, nouvelle connexion et révocation des access tokens', async () => {
  assert.equal((await request('/auth/forgot', { method: 'POST', body: { email: player.email } })).status, 200);
  const mail = mails.filter(m => m.to === player.email).at(-1);
  const token = mail.text.match(/reset=([a-f0-9]+)/)[1];
  const reset = await request('/auth/reset', { method: 'POST', body: { token, password: 'NewPassword2026!' } });
  assert.equal(reset.status, 200);
  assert.equal((await request('/auth/reset', { method: 'POST', body: { token, password: 'NewPassword2026!' } })).status, 400);
  assert.equal((await request('/me', { token: player.token })).status, 401);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: player.email, password: 'TestPassword2026!' } })).status, 401);
  assert.equal((await request('/auth/login', { method: 'POST', body: { email: player.email, password: 'NewPassword2026!' } })).status, 200);
});

test('invitation : un nouveau joueur s’inscrit depuis le lien puis entre dans la salle', async () => {
  const { quiz, id } = await fixture('async', 'invitation');
  const email = `${prefix}-invite@test.fr`;
  let r = await request('/auth/register', { method: 'POST', body: { email, pseudo: 'Invité', password: 'TestPassword2026!',
    invite: { session: id, code: quiz.invitation_code } } });
  assert.equal(r.status, 201);
  const link = new URL(mails.find(m => m.to === email).text.match(/http\S+/)[0]);
  assert.equal(link.searchParams.get('session'), id);
  assert.equal(link.searchParams.get('code'), quiz.invitation_code);
  r = await request('/auth/verify', { method: 'POST', body: { token: link.searchParams.get('verify') } });
  assert.equal(r.status, 200);
  r = await request('/auth/login', { method: 'POST', body: { email, password: 'TestPassword2026!' } });
  userIds.push(r.body.user.id);
  assert.equal((await request(`/sessions/${id}`, { token: r.body.token })).status, 403);
  assert.equal((await request(`/sessions/${id}/join`, { method: 'POST', token: r.body.token, body: { code: link.searchParams.get('code') } })).body.code, 'SESSION_UNAUTHORIZED');
  await service.game.decideAccess(id, { ...owner, role: 'admin' }, email, true);
  assert.equal((await request(`/sessions/${id}/join`, { method: 'POST', token: r.body.token, body: { code: link.searchParams.get('code') } })).status, 200);
  assert.equal((await request(`/sessions/${id}`, { token: r.body.token })).status, 200);
  const other = `${prefix}-invite-bis@test.fr`;
  r = await request('/auth/register', { method: 'POST', body: { email: other, pseudo: 'Invité bis', password: 'TestPassword2026!', invite: { session: 'pas-un-uuid' } } });
  assert.equal(r.status, 201);
  const [created] = await db.query('SELECT id FROM users WHERE email=?', [other]); userIds.push(created.id);
  assert.doesNotMatch(mails.find(m => m.to === other).text, /session=/);
});

test('administrateur : suppression définitive d’un joueur non autorisé', async () => {
  const { id } = await fixture('async', 'public');
  const intruder = await register('Intrus');
  const moderator = await register('Moderateur');
  const player = await register('Fidele');
  await db.query("UPDATE users SET role='admin' WHERE id=?", [moderator.id]);
  for (const u of [player, intruder]) await service.game.decideAccess(id, { ...moderator, role: 'admin' }, u.email, true);
  await service.game.join(id, player);
  await service.game.join(id, intruder);
  const path = `/sessions/${id}/players/${intruder.id}/remove`;
  assert.equal((await request(path, { method: 'POST', token: owner.token })).status, 403);
  assert.equal((await request(path, { method: 'POST', token: player.token })).status, 403);
  assert.equal((await request(`/sessions/${id}/players`, { token: owner.token })).body.some(p => p.can_remove), false);
  const roster = await request(`/sessions/${id}/players`, { token: moderator.token });
  assert.equal(roster.status, 200);
  assert.equal(roster.body.find(p => p.id === intruder.id).can_remove, true);
  assert.equal((await request(`/sessions/${id}/players/${owner.id}/remove`, { method: 'POST', token: moderator.token })).status, 400);
  assert.equal((await request(path, { method: 'POST', token: moderator.token })).status, 200);
  assert.equal((await request(path, { method: 'POST', token: moderator.token })).status, 404);
  const after = await request(`/sessions/${id}/players`, { token: moderator.token });
  assert.equal(after.body.some(p => p.id === intruder.id), false);
  assert.equal(after.body.some(p => p.id === player.id), true);
  assert.equal((await db.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [id, intruder.id])).length, 0);
  assert.equal((await request(`/sessions/${id}/join`, { method: 'POST', token: intruder.token, body: {} })).status, 403);
  assert.equal((await request('/me/history', { token: intruder.token })).body.some(h => h.session_id === id), false);
});

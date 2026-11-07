import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, rmdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { openDatabase } from '../server/db.js';
import { createAuth } from '../server/auth.js';

function event(socket, name, condition = () => true, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const handler = data => {
      if (!condition(data)) return;
      clearTimeout(timer); socket.off(name, handler); resolve(data);
    };
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Événement ${name} non reçu.`)); }, timeout);
    socket.on(name, handler);
  });
}
function emit(socket, name, data) {
  return new Promise((resolve, reject) => socket.timeout(5000).emit(name, data, (timeout, reply) => {
    if (timeout) reject(timeout); else if (reply.error) reject(new Error(reply.error)); else resolve(reply);
  }));
}
test('Socket.IO réel : deux comptes, lancement synchronisé, réponse secrète, reconnexion et fin', { timeout: 30000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tufurayi-socket-'));
  const db = await openDatabase({ url: '', filename: join(folder, 'data', 'tufurayi.sqlite') });
  const secret = 'socket-test-secret-'.repeat(4);
  const owner = { id: randomUUID(), email: 'creator@socket.test', pseudo: 'Créateur socket', role: 'creator', token_version: 0 };
  const player = { id: randomUUID(), email: 'player@socket.test', pseudo: 'Joueur socket', role: 'player', token_version: 0 };
  const administrator = { id: randomUUID(), email: 'admin@socket.test', pseudo: 'Administrateur socket', role: 'admin', token_version: 0 };
  const quizId = randomUUID(), questionId = randomUUID(), answerId = randomUUID(), sessionId = randomUUID();
  const now = Date.now();
  await db.transaction(async tx => {
    for (const u of [owner, player, administrator]) await tx.query('INSERT INTO users (id,email,password_hash,pseudo,role,verified,created_at) VALUES (?,?,?,?,?,1,?)',
      [u.id, u.email, 'not-a-login-hash', u.pseudo, u.role, now]);
    await tx.query('INSERT INTO quizzes (id,owner_id,title,description,category,cover,visibility,invitation_code,published,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',
      [quizId, owner.id, 'Quiz socket', 'Test de synchronisation', 'Sciences', 'blue', 'public', 'TEST', now]);
    await tx.query('INSERT INTO questions (id,quiz_id,text,explanation,duration,position) VALUES (?,?,?,?,5,0)', [questionId, quizId, 'La bonne réponse ?', 'Explication de test.']);
    await tx.query('INSERT INTO answers (id,question_id,text,correct) VALUES (?,?,?,1)', [answerId, questionId, 'Bonne réponse']);
    await tx.query('INSERT INTO answers (id,question_id,text,correct) VALUES (?,?,?,0)', [randomUUID(), questionId, 'Mauvaise réponse']);
    await tx.query('INSERT INTO sessions (id,quiz_id,mode,opens_at,closes_at,question_order,created_at) VALUES (?,?,?,?,?,?,?)',
      [sessionId, quizId, 'live', now - 60000, now + 60000, JSON.stringify([questionId]), now]);
  });
  const auth = createAuth(db, secret);
  let child, hostSocket, playerSocket;
  let logs = '';
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('../server/index.js', import.meta.url))], {
      cwd: folder, env: { ...process.env, PORT: '0', JWT_SECRET: secret, NODE_ENV: 'test', DATABASE_URL: '', REDIS_URL: '', SMTP_HOST: '', APP_URL: 'http://localhost:5173' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stderr.on('data', chunk => { logs += chunk; });
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Serveur non démarré : ${logs}`)), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Serveur arrêté (${code}) : ${logs}`)); });
      child.stdout.on('data', chunk => {
        logs += chunk;
        const port = logs.match(/Tufurayi API : http:\/\/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
      });
    });
    const localBrowserOrigin = { Origin: 'http://127.0.0.1:5173' };
    hostSocket = io(base, { auth: { token: auth.access(owner) }, extraHeaders: localBrowserOrigin, transports: ['websocket'], autoConnect: false });
    playerSocket = io(base, { auth: { token: auth.access(player) }, extraHeaders: localBrowserOrigin, transports: ['websocket'], autoConnect: false });
    const connected = Promise.all([event(hostSocket, 'connect'), event(playerSocket, 'connect')]);
    hostSocket.connect(); playerSocket.connect(); await connected;
    await emit(hostSocket, 'session:join', { id: sessionId });
    await assert.rejects(emit(playerSocket, 'session:join', { id: sessionId }), /sans l’autorisation explicite/);
    const approval = await fetch(`${base}/api/sessions/${sessionId}/access`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.access(administrator)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: player.email, approved: true })
    });
    assert.equal(approval.status, 200);
    await emit(playerSocket, 'session:join', { id: sessionId });
    const questions = Promise.all([event(hostSocket, 'game:question'), event(playerSocket, 'game:question')]);
    await emit(hostSocket, 'session:start', { id: sessionId });
    const [host, first] = await questions;
    assert.equal(first.question.id, host.question.id);
    assert.equal(first.question.endsAt, host.question.endsAt);
    assert.equal(first.question.answers.some(a => 'correct' in a), false);
    const recorded = event(playerSocket, 'game:question', state => state.answered);
    await emit(playerSocket, 'player:answer', { id: sessionId, questionId, answerId });
    const concealed = await recorded;
    assert.equal(concealed.score, 0);
    assert.equal(concealed.question.points, undefined);
    playerSocket.disconnect();
    const reconnected = event(playerSocket, 'connect'); playerSocket.connect(); await reconnected;
    const resumed = event(playerSocket, 'session:join', state => state.answered);
    await emit(playerSocket, 'session:join', { id: sessionId });
    assert.equal((await resumed).question.id, questionId);
    const reviews = await Promise.all([event(hostSocket, 'game:question_end'), event(playerSocket, 'game:question_end')]);
    assert.equal(reviews[1].state, 'review');
    assert.ok(reviews[1].score >= 500 && reviews[1].score <= 1000);
    assert.equal(reviews[1].question.answers.find(a => a.id === answerId).correct, true);
    const endings = Promise.all([event(hostSocket, 'game:end'), event(playerSocket, 'game:end')]);
    const response = await fetch(`${base}/api/sessions/${sessionId}/control`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.access(owner)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next' })
    });
    assert.equal(response.status, 200);
    const [, end] = await endings;
    assert.equal(end.state, 'finished');
    assert.equal(end.correction.length, 1);
    assert.equal(end.correction[0].correct, 'Bonne réponse');
    const excluded = event(playerSocket, 'session:excluded');
    const exclusion = await fetch(`${base}/api/sessions/${sessionId}/players/${player.id}/exclude`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.access(owner)}`, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(exclusion.status, 200);
    assert.equal((await excluded).id, sessionId);
    assert.equal(playerSocket.connected, true);
    await assert.rejects(emit(playerSocket, 'session:join', { id: sessionId }), /exclu/);
    await assert.rejects(emit(playerSocket, 'player:answer', { id: sessionId, questionId, answerId }), /exclu/);
    playerSocket.disconnect();
    const reconnectExcluded = event(playerSocket, 'connect');
    playerSocket.connect(); await reconnectExcluded;
    await assert.rejects(emit(playerSocket, 'session:join', { id: sessionId }), /exclu/);
    const retained = await fetch(`${base}/api/sessions/${sessionId}/report`, { headers: { Authorization: `Bearer ${auth.access(owner)}` } });
    const retainedPlayer = (await retained.json()).players.find(entry => entry.id === player.id);
    assert.equal(retainedPlayer.excluded, true);
    assert.equal(retainedPlayer.score, end.score);
    const unauthorized = event(hostSocket, 'session:excluded', value => value.code === 'SESSION_UNAUTHORIZED');
    await db.query("UPDATE users SET role='player' WHERE id=?", [owner.id]);
    const hostDenied = await fetch(`${base}/api/sessions/${sessionId}/access`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.access(administrator)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: owner.email, approved: false })
    });
    assert.equal(hostDenied.status, 200);
    assert.match((await unauthorized).error, /sans l’autorisation explicite/);
  } finally {
    hostSocket?.close(); playerSocket?.close();
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await db.close();
    const data = join(folder, 'data');
    for (const name of await readdir(data)) await rm(join(data, name));
    await rmdir(data); await rmdir(folder);
  }
});

import 'dotenv/config';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { openDatabase } from './db.js';
import { getSecret } from './auth.js';
import { createApp } from './app.js';
import { isAllowedOrigin } from './origin.js';

if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) throw new Error('SMTP_HOST est obligatoire en production.');
const db = await openDatabase();
const service = createApp(db, await getSecret());
const server = createServer(service.app);
const origin = process.env.APP_URL || 'http://localhost:5173';
const io = new Server(server, { cors: { origin: (requestOrigin, done) => done(null, !requestOrigin || isAllowedOrigin(requestOrigin, origin)), credentials: true }, maxHttpBufferSize: 10000,
  allowRequest: (req, done) => done(null, !req.headers.origin || isAllowedOrigin(req.headers.origin, origin)) });
let pub, sub;
if (process.env.REDIS_URL) {
  pub = createClient({ url: process.env.REDIS_URL }); sub = pub.duplicate();
  pub.on('error', error => console.error('Redis publication :', error));
  sub.on('error', error => console.error('Redis abonnement :', error));
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
}
io.use(async (socket, next) => {
  try { socket.data.user = await service.auth.authenticate(socket.handshake.auth.token); next(); }
  catch (error) { next(error); }
});
async function notify(id) {
  const sockets = await io.in(id).fetchSockets();
  for (const socket of sockets) {
    try {
      const user = await service.auth.authenticate(socket.data.token);
      const state = await service.game.snapshot(id, user);
      const event = state.state === 'waiting' ? 'session:join' : state.state === 'review' ? 'game:question_end' :
        ['finished', 'ended'].includes(state.state) ? 'game:end' : 'game:question';
      socket.emit(event, state);
    } catch (error) {
      if (error.code === 'SESSION_EXCLUDED') {
        await socket.leave(id);
        socket.emit('session:excluded', { id, error: error.message });
      } else if (error.status === 401) socket.disconnect(true);
      else { console.error('Diffusion de session :', error); socket.emit('game:error', { error: error.status ? error.message : 'Diffusion temporairement indisponible.' }); }
    }
  }
  if (pub) {
    const [state] = await db.query('SELECT id,status,current_index,started_at FROM sessions WHERE id=?', [id]);
    if (state) await pub.set(`session:${id}`, JSON.stringify(state), { EX: 86400 });
  }
}
service.setNotify(notify);
io.on('connection', socket => {
  socket.data.token = socket.handshake.auth.token;
  let requests = 0;
  const rateTimer = setInterval(() => { requests = 0; }, 60000);
  const handle = fn => async (payload, reply) => {
    const ack = typeof reply === 'function' ? reply : () => {};
    try {
      if (++requests > 120) throw Object.assign(new Error('Trop de requêtes.'), { status: 429 });
      socket.data.user = await service.auth.authenticate(socket.data.token);
      await fn(payload || {});
      ack({ ok: true });
    } catch (error) {
      if (!error.status) console.error(error);
      ack({ error: error.status ? error.message : 'Action impossible.' });
    }
  };
  socket.on('session:join', handle(async ({ id, code }) => {
    if (typeof id !== 'string' || id.length > 50 || code && (typeof code !== 'string' || code.length > 30)) throw Object.assign(new Error('Session invalide.'), { status: 400 });
    const snapshot = await service.game.snapshot(id, socket.data.user).catch(async error => {
      if (error.status !== 403) throw error;
      await service.game.join(id, socket.data.user, code?.trim().toUpperCase());
      return service.game.snapshot(id, socket.data.user);
    });
    await socket.join(id);
    socket.emit('session:join', snapshot);
    await notify(id);
  }));
  socket.on('session:start', handle(async ({ id }) => { await service.game.control(id, socket.data.user, 'start'); await notify(id); }));
  socket.on('player:answer', handle(async ({ id, answerId, questionId }) => {
    if (typeof answerId !== 'string' || typeof questionId !== 'string') throw Object.assign(new Error('Réponse invalide.'), { status: 400 });
    await service.game.answer(id, socket.data.user, answerId, questionId); await notify(id);
  }));
  socket.on('disconnect', () => clearInterval(rateTimer));
});
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { for (const id of await service.game.tick()) await notify(id); }
  catch (error) { console.error('Moteur temps réel :', error); }
  finally { ticking = false; }
}, 500);
server.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => {
  console.info(`Tufurayi API : http://localhost:${server.address().port} (${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite local'})`);
});
async function shutdown() {
  clearInterval(timer);
  await new Promise(resolve => io.close(resolve));
  if (pub) await Promise.all([pub.quit(), sub.quit()]);
  await db.close();
}
process.once('SIGINT', () => shutdown().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); }));
process.once('SIGTERM', () => shutdown().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); }));
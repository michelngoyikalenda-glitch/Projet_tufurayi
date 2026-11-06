import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { createAuth, assert, safeUser, emailSchema, HttpError } from './auth.js';
import { createGame, getQuestions, shuffle } from './game.js';
import { isAllowedOrigin } from './origin.js';
import { quizScore } from './scores.js';

z.config(z.locales.fr());

const questionSchema = z.object({
  text: z.string().trim().min(3, 'L’énoncé doit contenir au moins 3 caractères.').max(1000), explanation: z.string().max(2000).default(''),
  duration: z.number().int().min(5).max(120),
  answers: z.array(z.object({ text: z.string().trim().min(1, 'Saisissez le texte de la réponse.').max(500), correct: z.boolean() })).min(2).max(6)
}).refine(q => q.answers.filter(a => a.correct).length === 1, 'Chaque question doit avoir exactement une bonne réponse.');
const quizSchema = z.object({
  title: z.string().trim().min(3, 'Le titre du quiz doit contenir au moins 3 caractères.').max(100), description: z.string().max(1000).default(''),
  category: z.enum(['Culture générale', 'Sciences', 'Technologie', 'Histoire', 'Géographie', 'Sport']),
  cover: z.enum(['violet', 'blue', 'orange', 'green', 'pink', 'navy']).default('violet'),
  visibility: z.enum(['public', 'private', 'invitation']), published: z.boolean(),
  questions: z.array(questionSchema).min(1).max(50)
});
const creator = (req, _res, next) => {
  try { assert(['creator', 'admin'].includes(req.user.role), 403, 'Un compte créateur est nécessaire.'); next(); } catch (e) { next(e); }
};
const admin = (req, _res, next) => {
  try { assert(req.user.role === 'admin', 403, 'Accès réservé aux administrateurs.'); next(); } catch (e) { next(e); }
};

export function createApp(db, secret, options = {}) {
  const app = express();
  const auth = createAuth(db, secret, options);
  const game = createGame(db, options);
  let notify = async () => {};
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"] } } }));
  app.use(express.json({ limit: '256kb' }), cookieParser());
  app.use('/api', (req, _res, next) => {
    const origin = req.headers.origin;
    const expected = options.origin || process.env.APP_URL || 'http://localhost:5173';
    if (origin && !isAllowedOrigin(origin, expected)) return next(new HttpError(403, 'Origine de la requête non autorisée.'));
    next();
  });
  const authLimit = rateLimit({ windowMs: 15 * 60000, limit: options.test ? 10000 : 30,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' } });
  const playLimit = rateLimit({ windowMs: 60000, limit: options.test ? 10000 : 240,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Trop de requêtes. Patientez une minute.' } });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authLimit);
  app.post('/api/auth/register', auth.register);
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/refresh', auth.refresh);
  app.post('/api/auth/logout', auth.logout);
  app.post('/api/auth/forgot', (req, res) => auth.requestLink(req, res, 'reset'));
  app.post('/api/auth/resend', (req, res) => auth.requestLink(req, res, 'verify'));
  app.post('/api/auth/verify', (req, res) => auth.redeem(req, res, 'verify'));
  app.post('/api/auth/reset', (req, res) => auth.redeem(req, res, 'reset'));
  app.get('/api/auth/providers', (_req, res) => res.json(auth.oauthProviders()));
  app.get('/api/auth/oauth/:provider', (req, res) => auth.oauthStart(req, res));
  app.get('/api/auth/oauth/:provider/callback', (req, res) => auth.oauthCallback(req, res));
  app.post('/api/auth/oauth/:provider/callback', express.urlencoded({ limit: '8kb' }), (req, res) => auth.oauthCallback(req, res));
  app.use('/api', auth.middleware, playLimit);
  app.get('/api/me', (req, res) => res.json(safeUser(req.user)));
  app.put('/api/me', async (req, res) => {
    const input = z.object({ pseudo: z.string().trim().min(2).max(30), avatar: z.enum(['indigo', 'green', 'orange', 'pink', 'blue']) }).parse(req.body);
    await db.query('UPDATE users SET pseudo=?,avatar=? WHERE id=?', [input.pseudo, input.avatar, req.user.id]);
    res.json(safeUser({ ...req.user, ...input }));
  });
  app.get('/api/me/history', async (req, res) => {
    const history = await db.transaction(async tx => {
      const rows = await tx.query(`SELECT p.id,p.session_id,p.score,p.status,p.finished_at,q.title,q.category,s.mode,
        s.status AS session_status,s.question_order,s.current_index,
        CASE WHEN EXISTS (SELECT 1 FROM session_exclusions e WHERE e.session_id=s.id AND e.user_id=p.user_id) THEN 1 ELSE 0 END AS excluded,
        (SELECT COUNT(*) FROM questions WHERE quiz_id=q.id) AS question_count
        FROM participations p JOIN sessions s ON s.id=p.session_id JOIN quizzes q ON q.id=s.quiz_id
        WHERE p.user_id=? ORDER BY COALESCE(p.finished_at,s.created_at) DESC${tx.lock ? ' FOR UPDATE OF s,p' : ''}`, [req.user.id]);
      for (const row of rows) {
        if (row.mode === 'live' && row.session_status === 'question') {
          const [current] = await tx.query('SELECT points FROM participation_answers WHERE participation_id=? AND question_id=?',
            [row.id, JSON.parse(row.question_order)[row.current_index]]);
          row.score -= current?.points || 0;
        }
        delete row.session_status; delete row.question_order; delete row.current_index;
        row.score = quizScore(row.score, row.question_count);
        row.excluded = Boolean(row.excluded);
      }
      return rows;
    });
    res.json(history);
  });
  app.get('/api/leaderboard', async (_req, res) => res.json(await db.query(`SELECT u.id,u.pseudo,u.avatar,
    COALESCE(SUM(ROUND(1.0*p.score/(SELECT COUNT(*) FROM questions WHERE quiz_id=s.quiz_id),0)),0) AS score,COUNT(p.id) AS games FROM users u
    LEFT JOIN participations p ON p.user_id=u.id AND p.status='finished'
    LEFT JOIN sessions s ON s.id=p.session_id
    WHERE u.disabled=0 GROUP BY u.id,u.pseudo,u.avatar HAVING COUNT(p.id)>0 ORDER BY score DESC,u.pseudo LIMIT 100`)));
  app.get('/api/quizzes', async (req, res) => {
    const quizzes = await db.query(`SELECT q.id,q.title,q.description,q.category,q.cover,q.visibility,q.published,q.owner_id,
      u.pseudo AS owner,(SELECT COUNT(*) FROM questions WHERE quiz_id=q.id) AS question_count
      FROM quizzes q JOIN users u ON u.id=q.owner_id
      WHERE (q.published=1 AND q.visibility='public') OR q.owner_id=? ORDER BY q.created_at DESC`, [req.user.id]);
    res.json(quizzes);
  });
  app.get('/api/quizzes/:id', async (req, res) => {
    const [q] = await db.query('SELECT * FROM quizzes WHERE id=?', [req.params.id]);
    assert(q, 404, 'Quiz introuvable.');
    const owner = q.owner_id === req.user.id || req.user.role === 'admin';
    assert(owner || (q.published && q.visibility === 'public'), 403, 'Ce quiz est privé.');
    if (owner) q.questions = await getQuestions(db, q.id);
    else delete q.invitation_code;
    res.json(q);
  });
  async function saveQuiz(req, res) {
    const input = quizSchema.parse(req.body);
    const id = req.params.id || randomUUID();
    await db.transaction(async tx => {
      if (req.params.id) {
        const [q] = await tx.query(`SELECT * FROM quizzes WHERE id=?${tx.lock}`, [id]);
        assert(q && (q.owner_id === req.user.id || req.user.role === 'admin'), 403, 'Vous ne pouvez pas modifier ce quiz.');
        assert(!(await tx.query('SELECT id FROM sessions WHERE quiz_id=?', [id])).length, 409, 'Ce quiz possède des sessions. Dupliquez-le pour le modifier sans changer les résultats.');
        await tx.query('UPDATE quizzes SET title=?,description=?,category=?,cover=?,visibility=?,published=? WHERE id=?',
          [input.title, input.description, input.category, input.cover, input.visibility, Number(input.published), id]);
        await tx.query('DELETE FROM questions WHERE quiz_id=?', [id]);
      } else await tx.query('INSERT INTO quizzes (id,owner_id,title,description,category,cover,visibility,invitation_code,published,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, req.user.id, input.title, input.description, input.category, input.cover, input.visibility, randomBytes(5).toString('hex').toUpperCase(), Number(input.published), Date.now()]);
      for (const [position, q] of input.questions.entries()) {
        const qId = randomUUID();
        await tx.query('INSERT INTO questions (id,quiz_id,text,explanation,duration,position) VALUES (?,?,?,?,?,?)',
          [qId, id, q.text, q.explanation, q.duration, position]);
        for (const a of q.answers) await tx.query('INSERT INTO answers (id,question_id,text,correct) VALUES (?,?,?,?)',
          [randomUUID(), qId, a.text, Number(a.correct)]);
      }
    });
    res.status(req.params.id ? 200 : 201).json({ id });
  }
  app.post('/api/quizzes', creator, saveQuiz);
  app.put('/api/quizzes/:id', creator, saveQuiz);
  app.post('/api/quizzes/:id/report', async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(10).max(1000) }).parse(req.body);
    const [quiz] = await db.query('SELECT id FROM quizzes WHERE id=? AND published=1 AND visibility=?', [req.params.id, 'public']);
    assert(quiz, 404, 'Quiz introuvable.');
    await db.query('INSERT INTO reports (id,quiz_id,user_id,reason,created_at) VALUES (?,?,?,?,?)', [randomUUID(), quiz.id, req.user.id, reason, Date.now()]);
    res.status(201).json({ message: 'Signalement transmis à un administrateur.' });
  });
  app.get('/api/sessions', async (req, res) => {
    const rows = await db.query(`SELECT DISTINCT s.*,q.title,q.description,q.category,q.cover,q.owner_id,q.visibility,
      u.pseudo AS owner,(SELECT COUNT(*) FROM questions WHERE quiz_id=q.id) AS question_count,
      (SELECT COUNT(*) FROM participations WHERE session_id=s.id) AS player_count,
      (SELECT status FROM participations WHERE session_id=s.id AND user_id=?) AS participation_status,
      CASE WHEN q.owner_id=? THEN q.invitation_code ELSE NULL END AS invitation_code
      FROM sessions s JOIN quizzes q ON q.id=s.quiz_id JOIN users u ON u.id=q.owner_id
      LEFT JOIN invitations i ON i.session_id=s.id AND i.email=?
      LEFT JOIN participations p ON p.session_id=s.id AND p.user_id=?
      WHERE (q.owner_id=? OR p.id IS NOT NULL OR (q.published=1 AND (q.visibility='public' OR i.id IS NOT NULL)))
      AND NOT EXISTS (SELECT 1 FROM session_exclusions e WHERE e.session_id=s.id AND e.user_id=?)
      ORDER BY s.created_at DESC`, [req.user.id, req.user.id, req.user.email, req.user.id, req.user.id, req.user.id]);
    res.json(rows.map(({ question_order, ...row }) => row));
  });
  app.get('/api/sessions/:id/report', async (req, res) => {
    const id = getId(req);
    const [excluded] = await db.query('SELECT user_id FROM session_exclusions WHERE session_id=? AND user_id=?', [id, req.user.id]);
    assert(!excluded, 403, 'Vous avez été exclu de cette session. Vos résultats sont conservés.');
    const [session] = await db.query(`SELECT s.id,s.mode,s.status,s.created_at,q.title,q.category,q.owner_id,
      (SELECT COUNT(*) FROM questions WHERE quiz_id=q.id) AS question_count
      FROM sessions s JOIN quizzes q ON q.id=s.quiz_id WHERE s.id=?`, [id]);
    assert(session, 404, 'Session introuvable.');
    const isParticipant = (await db.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [id, req.user.id])).length > 0;
    assert(req.user.role === 'admin' || session.owner_id === req.user.id || isParticipant, 403, 'Vous ne pouvez pas consulter les résultats de cette session.');
    const players = await db.query(`SELECT u.id,u.pseudo,p.score,p.status,p.finished_at,
      CASE WHEN EXISTS (SELECT 1 FROM session_exclusions e WHERE e.session_id=p.session_id AND e.user_id=p.user_id) THEN 1 ELSE 0 END AS excluded,
      COUNT(pa.id) AS responses,COALESCE(SUM(CASE WHEN pa.points>0 THEN 1 ELSE 0 END),0) AS correct
      FROM participations p JOIN users u ON u.id=p.user_id
      LEFT JOIN participation_answers pa ON pa.participation_id=p.id
      WHERE p.session_id=? GROUP BY p.id,p.session_id,p.user_id,u.id,u.pseudo,p.score,p.status,p.finished_at
      ORDER BY p.score DESC,u.pseudo`, [id]);
    res.json({ ...session, players: players.map(player => ({ ...player, excluded: Boolean(player.excluded), score: quizScore(player.score, session.question_count) })) });
  });
  app.post('/api/sessions', creator, async (req, res) => {
    const input = z.object({ quizId: z.string(), mode: z.enum(['live', 'async']), opensAt: z.number().int(), closesAt: z.number().int(),
      emails: z.array(emailSchema).max(200).default([]) }).parse(req.body);
    assert(input.closesAt > Math.max(Date.now(), input.opensAt) && input.closesAt - input.opensAt <= 90 * 86400000,
      400, 'La fermeture doit suivre l’ouverture et se situer dans les 90 jours.');
    const id = randomUUID();
    await db.transaction(async tx => {
      const [q] = await tx.query(`SELECT * FROM quizzes WHERE id=?${tx.lock}`, [input.quizId]);
      assert(q && (q.owner_id === req.user.id || req.user.role === 'admin'), 403, 'Ce quiz ne vous appartient pas.');
      assert(q.published, 400, 'Publiez le quiz avant de planifier une session.');
      const questions = await tx.query('SELECT id FROM questions WHERE quiz_id=? ORDER BY position', [q.id]);
      assert(questions.length, 400, 'Le quiz doit contenir des questions.');
      await tx.query('INSERT INTO sessions (id,quiz_id,mode,opens_at,closes_at,question_order,created_at) VALUES (?,?,?,?,?,?,?)',
        [id, q.id, input.mode, input.opensAt, input.closesAt, JSON.stringify(shuffle(questions.map(q => q.id))), Date.now()]);
      for (const email of new Set(input.emails)) await tx.query('INSERT INTO invitations (id,session_id,email) VALUES (?,?,?)', [randomUUID(), id, email]);
    });
    res.status(201).json({ id });
  });
  const getId = req => z.uuid().parse(req.params.id);
  app.get('/api/sessions/:id/players', async (req, res) => res.json(await game.players(getId(req), req.user)));
  app.post('/api/sessions/:id/players/:userId/exclude', async (req, res) => {
    const id = getId(req);
    await game.exclude(id, req.user, z.uuid().parse(req.params.userId));
    await notify(id);
    res.json({ message: 'Joueur exclu de cette session. Ses résultats sont conservés.' });
  });
  app.post('/api/sessions/:id/players/:userId/remove', admin, async (req, res) => {
    const id = getId(req);
    await game.remove(id, req.user, z.uuid().parse(req.params.userId));
    await notify(id);
    res.json({ message: 'Joueur supprimé de cette session. Son score et ses réponses ont été effacés.' });
  });
  app.post('/api/sessions/:id/join', async (req, res) => {
    const { code } = z.object({ code: z.string().max(30).optional() }).parse(req.body || {});
    const id = getId(req);
    await game.join(id, req.user, code?.trim().toUpperCase());
    await notify(id);
    res.json(await game.snapshot(id, req.user));
  });
  app.get('/api/sessions/:id', async (req, res) => res.json(await game.snapshot(getId(req), req.user)));
  app.post('/api/sessions/:id/start', async (req, res) => {
    const id = getId(req);
    await game.begin(id, req.user);
    await notify(id);
    res.json(await game.snapshot(id, req.user));
  });
  app.post('/api/sessions/:id/answer', async (req, res) => {
    const { answerId, questionId } = z.object({ answerId: z.uuid(), questionId: z.uuid() }).parse(req.body);
    const id = getId(req);
    const result = await game.answer(id, req.user, answerId, questionId);
    await notify(id); res.json(result);
  });
  app.post('/api/sessions/:id/next', async (req, res) => {
    const id = getId(req); await game.next(id, req.user); res.json(await game.snapshot(id, req.user));
  });
  app.post('/api/sessions/:id/control', creator, async (req, res) => {
    const { action } = z.object({ action: z.enum(['start', 'next']) }).parse(req.body);
    const id = getId(req); await game.control(id, req.user, action); await notify(id); res.json(await game.snapshot(id, req.user));
  });
  app.get('/api/quizzes/:id/stats', creator, async (req, res) => {
    const [q] = await db.query('SELECT owner_id FROM quizzes WHERE id=?', [req.params.id]);
    assert(q && (q.owner_id === req.user.id || req.user.role === 'admin'), 403, 'Statistiques privées.');
    const questions = await db.query(`SELECT q.id,q.text,COUNT(pa.id) AS responses,
      COALESCE(SUM(CASE WHEN pa.points>0 THEN 1 ELSE 0 END),0) AS correct,
      COALESCE(AVG(pa.elapsed_ms),0) AS average_ms
      FROM questions q LEFT JOIN participation_answers pa ON pa.question_id=q.id
      WHERE q.quiz_id=? GROUP BY q.id,q.text,q.position ORDER BY q.position`, [req.params.id]);
    const players = await db.query(`SELECT u.pseudo,p.score,p.status,s.mode FROM participations p
      JOIN sessions s ON s.id=p.session_id JOIN users u ON u.id=p.user_id WHERE s.quiz_id=? ORDER BY p.score DESC`, [req.params.id]);
    res.json({ questions, players: players.map(player => ({ ...player, score: quizScore(player.score, questions.length) })) });
  });
  app.get('/api/admin', admin, async (req, res) => {
    const users = (await db.query('SELECT * FROM users ORDER BY created_at DESC')).map(u => ({ ...safeUser(u), disabled: Boolean(u.disabled) }));
    const reports = await db.query('SELECT r.*,q.title,u.pseudo FROM reports r JOIN quizzes q ON q.id=r.quiz_id JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC');
    const sessions = await db.query(`SELECT s.id,s.mode,s.status,s.created_at,s.opens_at,s.closes_at,q.title,q.owner_id,u.pseudo AS owner,
      (SELECT COUNT(*) FROM participations WHERE session_id=s.id) AS player_count,
      (SELECT status FROM participations WHERE session_id=s.id AND user_id=?) AS participation_status
      FROM sessions s JOIN quizzes q ON q.id=s.quiz_id JOIN users u ON u.id=q.owner_id ORDER BY s.created_at DESC`, [req.user.id]);
    const [totals] = await db.query(`SELECT (SELECT COUNT(*) FROM quizzes) AS quizzes,
      (SELECT COUNT(*) FROM sessions) AS sessions,(SELECT COUNT(*) FROM participations) AS participations`);
    res.json({ users, reports, sessions, totals });
  });
  app.put('/api/admin/users/:id', admin, async (req, res) => {
    const input = z.object({ role: z.enum(['player', 'creator', 'admin']), disabled: z.boolean() }).parse(req.body);
    assert(req.params.id !== req.user.id, 400, 'Vous ne pouvez pas modifier votre propre accès administrateur.');
    assert((await db.query('SELECT id FROM users WHERE id=?', [req.params.id])).length, 404, 'Utilisateur introuvable.');
    await db.query('UPDATE users SET role=?,disabled=?,token_version=token_version+1 WHERE id=?', [input.role, Number(input.disabled), req.params.id]);
    await db.query('DELETE FROM auth_tokens WHERE user_id=?', [req.params.id]);
    res.json({ message: 'Utilisateur mis à jour.' });
  });
  app.put('/api/admin/reports/:id', admin, async (req, res) => {
    const { hide } = z.object({ hide: z.boolean() }).parse(req.body);
    await db.transaction(async tx => {
      const [report] = await tx.query('SELECT * FROM reports WHERE id=?', [req.params.id]);
      assert(report, 404, 'Signalement introuvable.');
      if (hide) {
        await tx.query('UPDATE quizzes SET published=0 WHERE id=?', [report.quiz_id]);
        const sessions = await tx.query("SELECT id FROM sessions WHERE quiz_id=? AND status!='ended'", [report.quiz_id]);
        for (const s of sessions) {
          await tx.query("UPDATE sessions SET status='ended' WHERE id=?", [s.id]);
          await tx.query("UPDATE participations SET status='finished',finished_at=? WHERE session_id=? AND status!='finished'", [Date.now(), s.id]);
        }
      }
      await tx.query("UPDATE reports SET status='resolved' WHERE id=?", [report.id]);
    });
    res.json({ message: 'Signalement traité.' });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route introuvable.')));
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(issue => {
      const path = issue.path;
      if (path[0] !== 'questions' || typeof path[1] !== 'number') return issue.message;
      const answer = path[2] === 'answers' && typeof path[3] === 'number' ? `, réponse ${path[3] + 1}` : '';
      return `Question ${path[1] + 1}${answer} : ${issue.message}`;
    }).join('\n') });
    if (error.code === '23505' || error.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(error.message))
      return res.status(409).json({ error: 'Cette donnée existe déjà.' });
    if (!error.status || error.status >= 500) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Une erreur serveur est survenue. Réessayez.' });
  });
  return { app, auth, game, setNotify(fn) { notify = fn; } };
}
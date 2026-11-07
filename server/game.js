import { randomUUID, randomInt, createHash } from 'node:crypto';
import { assert, HttpError, canManageQuiz } from './auth.js';
import { quizScore, questionPoints } from './scores.js';

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export async function getQuestions(db, quizId) {
  const questions = await db.query('SELECT * FROM questions WHERE quiz_id=? ORDER BY position', [quizId]);
  for (const q of questions) q.answers = await db.query('SELECT * FROM answers WHERE question_id=? ORDER BY id', [q.id]);
  return questions;
}
export function createGame(db, { clock = Date.now } = {}) {
  const unauthorized = () => Object.assign(new HttpError(403,
    'Avertissement : vous ne pouvez pas entrer dans cette salle de quiz sans l’autorisation explicite d’un administrateur. Votre participation, vos réponses et votre score dans cette salle ont été supprimés s’ils existaient. Votre compte est conservé. Demandez l’autorisation à un administrateur.'),
    { code: 'SESSION_UNAUTHORIZED' });
  async function load(tx, id) {
    const [session] = await tx.query(`SELECT * FROM sessions WHERE id=?${tx.lock}`, [id]);
    assert(session, 404, 'Session introuvable.');
    const [quiz] = await tx.query('SELECT * FROM quizzes WHERE id=?', [session.quiz_id]);
    return { session, quiz };
  }
  async function allowed(tx, session, quiz, user, code) {
    await notExcluded(tx, session.id, user.id);
    if (canManageQuiz(user, quiz.owner_id) || quiz.visibility === 'public') return;
    const invitation = await tx.query('SELECT id FROM invitations WHERE session_id=? AND email=?', [session.id, user.email]);
    const previous = await tx.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [session.id, user.id]);
    if (quiz.visibility === 'private') {
      assert(invitation.length || previous.length, 403, 'Cette session privée est réservée aux adresses électroniques invitées. Demandez à l’animateur de vous inviter avec l’adresse de votre compte.');
      return;
    }
    assert(invitation.length || previous.length || (quiz.visibility === 'invitation' && code && code === quiz.invitation_code),
      403, 'Cette session nécessite un code d’invitation ou une invitation personnelle. Demandez le lien complet ou le code à l’animateur.');
  }
  async function notExcluded(tx, sessionId, userId) {
    const [exclusion] = await tx.query('SELECT user_id FROM session_exclusions WHERE session_id=? AND user_id=?', [sessionId, userId]);
    if (exclusion) throw Object.assign(new HttpError(403, 'Vous avez été exclu de cette session. Vos résultats sont conservés.'), { code: 'SESSION_EXCLUDED' });
  }
  async function deleteParticipation(tx, id, userId) {
    await tx.query('DELETE FROM participation_answers WHERE participation_id IN (SELECT id FROM participations WHERE session_id=? AND user_id=?)', [id, userId]);
    await tx.query('DELETE FROM participations WHERE session_id=? AND user_id=?', [id, userId]);
  }
  async function checkApproval(tx, id, quiz, user) {
    if (canManageQuiz(user, quiz.owner_id)) return true;
    const [access] = await tx.query('SELECT status FROM session_access WHERE session_id=? AND user_id=?', [id, user.id]);
    if (access?.status === 'approved') return true;
    await deleteParticipation(tx, id, user.id);
    await tx.query(`INSERT INTO session_access (session_id,user_id,requested_at) VALUES (?,?,?)
      ON CONFLICT (session_id,user_id) DO NOTHING`, [id, user.id, clock()]);
    return false;
  }
  async function participantTransaction(id, user, work) {
    const result = await db.transaction(async tx => {
      const { quiz } = await load(tx, id);
      await notExcluded(tx, id, user.id);
      if (!await checkApproval(tx, id, quiz, user)) return { denied: true };
      return { value: await work(tx) };
    });
    // Refuser après le commit pour ne pas annuler la suppression de la participation.
    if (result.denied) throw unauthorized();
    return result.value;
  }
  async function managed(tx, id, user) {
    const result = await load(tx, id);
    await notExcluded(tx, id, user.id);
    assert(canManageQuiz(user, result.quiz.owner_id), 403, 'Seul l’animateur ou un administrateur peut gérer les joueurs.');
    return result;
  }
  async function score(tx, p, q, answerId, start) {
    const elapsed = Math.max(0, clock() - Number(start));
    const timely = elapsed < q.duration * 1000;
    const [answer] = answerId ? await tx.query('SELECT * FROM answers WHERE id=? AND question_id=?', [answerId, q.id]) : [];
    assert(!answerId || answer, 400, 'Cette réponse n’appartient pas à la question.');
    const points = timely && answer?.correct ? Math.round(500 + 500 * (1 - elapsed / (q.duration * 1000))) : 0;
    const previous = await tx.query('SELECT id FROM participation_answers WHERE participation_id=? AND question_id=?', [p.id, q.id]);
    assert(!previous.length, 409, 'Votre réponse est déjà enregistrée.');
    await tx.query('INSERT INTO participation_answers (id,participation_id,question_id,answer_id,elapsed_ms,points) VALUES (?,?,?,?,?,?)',
      [randomUUID(), p.id, q.id, timely ? answerId : null, Math.min(elapsed, q.duration * 1000), points]);
    await tx.query('UPDATE participations SET score=score+? WHERE id=?', [points, p.id]);
    return points;
  }
  async function currentQuestion(tx, session, p) {
    const order = JSON.parse(session.mode === 'live' ? session.question_order : p.question_order);
    const index = session.mode === 'live' ? session.current_index : p.current_index;
    const [q] = await tx.query('SELECT * FROM questions WHERE id=?', [order[index]]);
    assert(q, 409, 'La question n’est plus disponible.');
    return q;
  }
  async function expireLive(tx, session) {
    if (session.mode !== 'live' || session.status !== 'question') return false;
    const q = await currentQuestion(tx, session, null);
    if (clock() < Number(session.started_at) + q.duration * 1000) return false;
    const pending = await tx.query("SELECT p.* FROM participations p WHERE p.session_id=? AND p.status!='finished' AND NOT EXISTS (SELECT 1 FROM participation_answers a WHERE a.participation_id=p.id AND a.question_id=?)", [session.id, q.id]);
    for (const p of pending) await score(tx, p, q, null, session.started_at);
    await tx.query("UPDATE sessions SET status='review' WHERE id=?", [session.id]);
    session.status = 'review';
    return true;
  }
  async function finish(tx, sessionId, participationId) {
    if (participationId) await tx.query("UPDATE participations SET status='finished',finished_at=? WHERE id=?", [clock(), participationId]);
    else {
      await tx.query("UPDATE sessions SET status='ended' WHERE id=?", [sessionId]);
      await tx.query("UPDATE participations SET status='finished',finished_at=? WHERE session_id=? AND status!='finished'", [clock(), sessionId]);
    }
  }
  return {
    async requireApproval(id, user) {
      return participantTransaction(id, user, async () => {});
    },
    async enforceApprovals() {
      const changed = [];
      const sessions = await db.query('SELECT DISTINCT session_id AS id FROM participations');
      for (const { id } of sessions) {
        const removed = await db.transaction(async tx => {
          const { quiz } = await load(tx, id);
          const users = await tx.query('SELECT u.* FROM users u JOIN participations p ON p.user_id=u.id WHERE p.session_id=?', [id]);
          let removed = false;
          for (const user of users) if (!await checkApproval(tx, id, quiz, user)) removed = true;
          return removed;
        });
        if (removed) changed.push(id);
      }
      return changed;
    },
    async accessRequests(id, user) {
      assert(user.role === 'admin', 403, 'Seul un administrateur peut autoriser l’entrée dans une salle.');
      return db.transaction(async tx => {
        await load(tx, id);
        return tx.query(`SELECT u.id,u.email,u.pseudo,u.avatar,a.status,a.requested_at,a.decided_at
          FROM session_access a JOIN users u ON u.id=a.user_id WHERE a.session_id=? ORDER BY a.requested_at,u.pseudo`, [id]);
      });
    },
    async decideAccess(id, user, email, approved) {
      assert(user.role === 'admin', 403, 'Seul un administrateur peut autoriser l’entrée dans une salle.');
      return db.transaction(async tx => {
        const { quiz } = await load(tx, id);
        const [player] = await tx.query('SELECT * FROM users WHERE email=?', [email]);
        assert(player, 400, 'Cette adresse ne correspond à aucun compte.');
        if (approved) assert(!player.disabled && player.verified, 400, 'Cette adresse doit correspondre à un compte actif et vérifié.');
        assert(!canManageQuiz(player, quiz.owner_id), 400, 'L’animateur et les administrateurs disposent déjà de l’accès à la salle.');
        if (approved) await notExcluded(tx, id, player.id);
        await tx.query(`INSERT INTO session_access (session_id,user_id,status,requested_at,decided_by,decided_at)
          VALUES (?,?,?,?,?,?) ON CONFLICT (session_id,user_id) DO UPDATE
          SET status=excluded.status,decided_by=excluded.decided_by,decided_at=excluded.decided_at`,
          [id, player.id, approved ? 'approved' : 'denied', clock(), user.id, clock()]);
        if (approved) {
          await tx.query(`INSERT INTO invitations (id,session_id,email) VALUES (?,?,?)
            ON CONFLICT (session_id,email) DO NOTHING`, [randomUUID(), id, player.email]);
        } else await deleteParticipation(tx, id, player.id);
      });
    },
    async players(id, user) {
      return db.transaction(async tx => {
        const { session, quiz } = await managed(tx, id, user);
        const players = await tx.query(`SELECT u.id,u.pseudo,u.avatar,p.score,p.status,
          CASE WHEN e.user_id IS NULL THEN 0 ELSE 1 END AS excluded
          FROM participations p JOIN users u ON u.id=p.user_id
          LEFT JOIN session_exclusions e ON e.session_id=p.session_id AND e.user_id=p.user_id
          WHERE p.session_id=? ORDER BY u.pseudo,u.id`, [id]);
        return players.map(player => ({ ...player, excluded: Boolean(player.excluded),
          score: quizScore(player.score, JSON.parse(session.question_order).length),
          can_exclude: player.id !== quiz.owner_id && player.id !== user.id && !player.excluded,
          can_remove: user.role === 'admin' && player.id !== quiz.owner_id && player.id !== user.id }));
      });
    },
    async remove(id, user, playerId) {
      return db.transaction(async tx => {
        const { quiz } = await managed(tx, id, user);
        assert(user.role === 'admin', 403, 'Seul un administrateur peut supprimer un joueur d’un quiz.');
        assert(playerId !== user.id && playerId !== quiz.owner_id, 400, 'Vous ne pouvez pas supprimer l’animateur ni vous-même.');
        const [player] = await tx.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [id, playerId]);
        assert(player, 404, 'Ce joueur ne participe pas à cette session.');
        await tx.query('DELETE FROM participation_answers WHERE participation_id=?', [player.id]);
        await tx.query('DELETE FROM participations WHERE id=?', [player.id]);
        await tx.query("UPDATE session_access SET status='denied',decided_by=?,decided_at=? WHERE session_id=? AND user_id=?", [user.id, clock(), id, playerId]);
        // The exclusion row keeps the removed player from joining again with the same link or code.
        await tx.query(`INSERT INTO session_exclusions (session_id,user_id,excluded_by,excluded_at)
          VALUES (?,?,?,?) ON CONFLICT (session_id,user_id) DO NOTHING`, [id, playerId, user.id, clock()]);
      });
    },
    async exclude(id, user, playerId) {
      return db.transaction(async tx => {
        const { quiz } = await managed(tx, id, user);
        assert(playerId !== user.id && playerId !== quiz.owner_id, 400, 'Vous ne pouvez pas exclure l’animateur ni vous-même.');
        const [player] = await tx.query('SELECT id FROM participations WHERE session_id=? AND user_id=?', [id, playerId]);
        assert(player, 404, 'Ce joueur ne participe pas à cette session.');
        await tx.query(`INSERT INTO session_exclusions (session_id,user_id,excluded_by,excluded_at)
          VALUES (?,?,?,?) ON CONFLICT (session_id,user_id) DO NOTHING`, [id, playerId, user.id, clock()]);
        await tx.query("UPDATE participations SET status='finished',finished_at=? WHERE id=? AND status!='finished'", [clock(), player.id]);
      });
    },
    async join(id, user, code) {
      return participantTransaction(id, user, async tx => {
        const { session, quiz } = await load(tx, id);
        await allowed(tx, session, quiz, user, code);
        const [existing] = await tx.query('SELECT * FROM participations WHERE session_id=? AND user_id=?', [id, user.id]);
        if (existing) return existing.id;
        assert(quiz.published, 403, 'Ce quiz n’est pas publié.');
        assert(session.status !== 'ended', 409, 'Cette session est terminée. Demandez à l’animateur de planifier une nouvelle session.');
        assert(clock() >= Number(session.opens_at) && clock() < Number(session.closes_at), 409, 'Cette session n’est pas ouverte.');
        assert(session.mode !== 'live' || session.status === 'waiting', 409, 'La partie a déjà commencé. Les nouveaux joueurs ne peuvent plus entrer.');
        const order = session.mode === 'live' ? JSON.parse(session.question_order) : shuffle(JSON.parse(session.question_order));
        const pId = randomUUID();
        // En mode différé, le chronomètre du joueur ne démarre qu’avec le bouton « Commencez le quiz ».
        await tx.query('INSERT INTO participations (id,session_id,user_id,status,question_order) VALUES (?,?,?,?,?)',
          [pId, id, user.id, session.mode === 'async' ? 'waiting' : 'playing', JSON.stringify(order)]);
        await tx.query("UPDATE invitations SET status='accepted' WHERE session_id=? AND email=?", [id, user.email]);
        return pId;
      });
    },
    async begin(id, user) {
      return participantTransaction(id, user, async tx => {
        const { session } = await load(tx, id);
        await notExcluded(tx, id, user.id);
        assert(session.mode === 'async', 400, 'Cette session se joue en direct : l’animateur lance la partie pour tout le monde.');
        assert(session.status !== 'ended' && clock() < Number(session.closes_at), 409, 'Cette session est terminée.');
        assert(clock() >= Number(session.opens_at), 409, 'Cette session n’est pas encore ouverte.');
        const [p] = await tx.query('SELECT * FROM participations WHERE session_id=? AND user_id=?', [id, user.id]);
        assert(p, 403, 'Rejoignez la session avant de commencer le quiz.');
        if (p.status === 'waiting') await tx.query("UPDATE participations SET status='playing',started_at=? WHERE id=?", [clock(), p.id]);
      });
    },
    async control(id, user, action) {
      return db.transaction(async tx => {
        const { session, quiz } = await load(tx, id);
        await notExcluded(tx, id, user.id);
        assert(canManageQuiz(user, quiz.owner_id), 403, 'Seul l’animateur peut piloter cette session.');
        assert(session.mode === 'live', 400, 'Cette session se joue à votre rythme.');
        await expireLive(tx, session);
        assert(clock() < Number(session.closes_at), 409, 'Cette session est fermée.');
        if (action === 'start') {
          assert(session.status === 'waiting' && clock() >= Number(session.opens_at), 409, 'La session ne peut pas démarrer maintenant.');
          assert((await tx.query("SELECT id FROM participations WHERE session_id=? AND status!='finished'", [id])).length, 409, 'Attendez qu’au moins un joueur rejoigne la salle.');
          await tx.query("UPDATE sessions SET status='question',started_at=? WHERE id=?", [clock(), id]);
        } else {
          assert(session.status === 'review', 409, 'Attendez la fin du temps de réponse.');
          const total = JSON.parse(session.question_order).length;
          if (session.current_index + 1 >= total) await finish(tx, id);
          else await tx.query("UPDATE sessions SET current_index=current_index+1,status='question',started_at=? WHERE id=?", [clock(), id]);
        }
      });
    },
    async answer(id, user, answerId, questionId) {
      return participantTransaction(id, user, async tx => {
        const { session } = await load(tx, id);
        await notExcluded(tx, id, user.id);
        await expireLive(tx, session);
        const [p] = await tx.query('SELECT * FROM participations WHERE session_id=? AND user_id=?', [id, user.id]);
        assert(p && p.status !== 'finished', 409, 'Aucune participation active.');
        assert(clock() < Number(session.closes_at), 409, 'La session est fermée.');
        assert(session.mode !== 'async' || p.status !== 'waiting', 409, 'Cliquez sur « Commencez le quiz » pour démarrer la partie.');
        assert(session.mode === 'async' ? p.status === 'playing' : session.status === 'question', 409, 'Le temps de réponse est écoulé.');
        const q = await currentQuestion(tx, session, p);
        assert(q.id === questionId, 409, 'Cette question n’est plus active.');
        const points = await score(tx, p, q, answerId, session.mode === 'live' ? session.started_at : p.started_at);
        if (session.mode === 'async') await tx.query("UPDATE participations SET status='review' WHERE id=?", [p.id]);
        return { recorded: true, ...(session.mode === 'async' ? {
          points: questionPoints(p.score + points, points, JSON.parse(p.question_order).length)
        } : {}) };
      });
    },
    async next(id, user) {
      return participantTransaction(id, user, async tx => {
        const { session } = await load(tx, id);
        await notExcluded(tx, id, user.id);
        assert(session.mode === 'async' && clock() < Number(session.closes_at), 409, 'La session est fermée ou en direct.');
        const [p] = await tx.query('SELECT * FROM participations WHERE session_id=? AND user_id=?', [id, user.id]);
        assert(p?.status === 'review', 409, 'Répondez à la question avant de continuer.');
        if (p.current_index + 1 >= JSON.parse(p.question_order).length) await finish(tx, id, p.id);
        else await tx.query("UPDATE participations SET current_index=current_index+1,status='playing',started_at=? WHERE id=?", [clock(), p.id]);
      });
    },
    async snapshot(id, user) {
      return participantTransaction(id, user, async tx => {
        const { session, quiz } = await load(tx, id);
        await allowed(tx, session, quiz, user);
        await expireLive(tx, session);
        let [p] = await tx.query('SELECT * FROM participations WHERE session_id=? AND user_id=?', [id, user.id]);
        const host = canManageQuiz(user, quiz.owner_id);
        assert(p || host, 403, 'Rejoignez la session pour voir les questions.');
        if (clock() >= Number(session.closes_at) && session.status !== 'ended') {
          await finish(tx, id); session.status = 'ended';
          if (p) p.status = 'finished';
        }
        let state = session.mode === 'live' ? session.status : p?.status || 'waiting';
        if (session.status === 'ended') state = 'finished';
        const order = JSON.parse(session.mode === 'live' ? session.question_order : p?.question_order || session.question_order);
        const index = session.mode === 'live' ? session.current_index : p?.current_index || 0;
        const board = await tx.query(`SELECT p.score,p.status,u.id,u.pseudo,u.avatar,
          CASE WHEN e.user_id IS NULL THEN 0 ELSE 1 END AS excluded
          FROM participations p JOIN users u ON u.id=p.user_id
          LEFT JOIN session_exclusions e ON e.session_id=p.session_id AND e.user_id=p.user_id
          WHERE p.session_id=? ORDER BY p.score DESC,u.pseudo`, [id]);
        for (const player of board) player.excluded = Boolean(player.excluded);
        const result = { id, title: quiz.title, mode: session.mode, state, host, total: order.length, index, serverTime: clock(),
          players: board, score: p?.score || 0, closesAt: Number(session.closes_at), question: null, answered: false, correction: null };
        if (state === 'waiting' || state === 'finished' || state === 'ended') {
          if (p?.status === 'finished') {
            result.correction = await tx.query(`SELECT q.id AS question_id,q.text,q.explanation,a.text AS selected,c.text AS correct,pa.points
              FROM participation_answers pa JOIN questions q ON q.id=pa.question_id
              LEFT JOIN answers a ON a.id=pa.answer_id JOIN answers c ON c.question_id=q.id AND c.correct=1
              WHERE pa.participation_id=? ORDER BY q.position`, [p.id]);
          }
          if (result.correction) {
            result.correction.sort((a, b) => order.indexOf(a.question_id) - order.indexOf(b.question_id));
            let total = 0;
            for (const correction of result.correction) {
              total += correction.points;
              correction.points = questionPoints(total, correction.points, order.length);
              delete correction.question_id;
            }
          }
          result.score = quizScore(result.score, order.length);
          for (const player of board) player.score = quizScore(player.score, order.length);
          return result;
        }
        const q = await currentQuestion(tx, session, p);
        const startedAt = Number(session.mode === 'live' ? session.started_at : p.started_at);
        if (session.mode === 'async' && state === 'playing' && clock() >= startedAt + q.duration * 1000) {
          await score(tx, p, q, null, p.started_at);
          await tx.query("UPDATE participations SET status='review' WHERE id=?", [p.id]);
          state = result.state = 'review';
        }
        const [response] = p ? await tx.query('SELECT answer_id,points FROM participation_answers WHERE participation_id=? AND question_id=?', [p.id, q.id]) : [];
        const choices = await tx.query('SELECT id,text,correct FROM answers WHERE question_id=? ORDER BY id', [q.id]);
        // Stable per-player ordering survives refresh; correctness is only exposed after the deadline.
        const ordered = choices.sort((a, b) => {
          const key = value => createHash('sha256').update(`${user.id}:${value.id}`).digest('hex');
          return key(a).localeCompare(key(b));
        });
        result.answered = Boolean(response);
        result.question = { id: q.id, text: q.text, duration: q.duration, endsAt: startedAt + q.duration * 1000,
          answers: ordered.map(a => ({ id: a.id, text: a.text, ...(state === 'review' ? { correct: Boolean(a.correct) } : {}) })),
          ...(state === 'review' ? { explanation: q.explanation, selected: response?.answer_id,
            points: questionPoints(result.score, response?.points || 0, order.length) } : {}) };
        // Do not let live players infer correctness from their score or the leaderboard mid-question.
        if (session.mode === 'live' && state === 'question') {
          const earned = await tx.query('SELECT p.user_id,pa.points FROM participation_answers pa JOIN participations p ON p.id=pa.participation_id WHERE p.session_id=? AND pa.question_id=?', [id, q.id]);
          for (const entry of earned) {
            const row = board.find(row => row.id === entry.user_id);
            if (row) row.score -= entry.points;
            if (entry.user_id === user.id) result.score -= entry.points;
          }
          board.sort((a, b) => b.score - a.score || a.pseudo.localeCompare(b.pseudo));
        }
        result.score = quizScore(result.score, order.length);
        for (const player of board) player.score = quizScore(player.score, order.length);
        return result;
      });
    },
    async tick() {
      const changed = [];
      const sessions = await db.query("SELECT id FROM sessions WHERE status!='ended'");
      for (const { id } of sessions) await db.transaction(async tx => {
        const { session } = await load(tx, id);
        if (session.status === 'ended') return;
        if (clock() >= Number(session.closes_at)) { await finish(tx, id); changed.push(id); }
        else if (await expireLive(tx, session)) changed.push(id);
      });
      return changed;
    }
  };
}
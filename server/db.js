import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  pseudo TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'indigo', role TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0, token_version INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_requests (
  hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, provider TEXT NOT NULL,
  verifier TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  description TEXT NOT NULL, category TEXT NOT NULL, cover TEXT NOT NULL, visibility TEXT NOT NULL,
  invitation_code TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  text TEXT NOT NULL, explanation TEXT NOT NULL, duration INTEGER NOT NULL, position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  text TEXT NOT NULL, correct INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id), mode TEXT NOT NULL,
  opens_at BIGINT NOT NULL, closes_at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
  current_index INTEGER NOT NULL DEFAULT 0, started_at BIGINT, question_order TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS participations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), user_id TEXT NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL DEFAULT 0, current_index INTEGER NOT NULL DEFAULT 0, started_at BIGINT,
  status TEXT NOT NULL DEFAULT 'playing', question_order TEXT NOT NULL, finished_at BIGINT,
  UNIQUE(session_id, user_id)
);
CREATE TABLE IF NOT EXISTS participation_answers (
  id TEXT PRIMARY KEY, participation_id TEXT NOT NULL REFERENCES participations(id),
  question_id TEXT NOT NULL REFERENCES questions(id), answer_id TEXT REFERENCES answers(id),
  elapsed_ms INTEGER NOT NULL, points INTEGER NOT NULL, UNIQUE(participation_id, question_id)
);
CREATE TABLE IF NOT EXISTS session_exclusions (
  session_id TEXT NOT NULL REFERENCES sessions(id), user_id TEXT NOT NULL REFERENCES users(id),
  excluded_by TEXT NOT NULL REFERENCES users(id), excluded_at BIGINT NOT NULL,
  PRIMARY KEY(session_id, user_id)
);
CREATE TABLE IF NOT EXISTS session_access (
  session_id TEXT NOT NULL REFERENCES sessions(id), user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending', requested_at BIGINT NOT NULL,
  decided_by TEXT REFERENCES users(id), decided_at BIGINT,
  PRIMARY KEY(session_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', UNIQUE(session_id, email)
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id), user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS participation_user ON participations(user_id);
CREATE INDEX IF NOT EXISTS tokens_expiry ON auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_requests(expires_at);
`;

export async function openDatabase({ url = process.env.DATABASE_URL, filename = resolve('data', 'tufurayi.sqlite') } = {}) {
  let pool, sqlite;
  if (url) {
    pool = new pg.Pool({ connectionString: url });
    await pool.query(schema);
  } else {
    if (filename !== ':memory:') await mkdir(dirname(filename), { recursive: true });
    sqlite = new DatabaseSync(filename);
    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    sqlite.exec(schema);
  }
  const makeQuery = (client) => async (sql, values = []) => {
    if (pool) {
      let i = 0;
      const result = await client.query(sql.replace(/\?/g, () => `$${++i}`), values);
      return result.rows;
    }
    const statement = sqlite.prepare(sql);
    return /^\s*(SELECT|WITH)/i.test(sql) ? statement.all(...values) : (statement.run(...values), []);
  };
  let queue = Promise.resolve();
  const db = {
    query: pool ? makeQuery(pool) : (sql, values) => {
      const result = queue.then(() => makeQuery(null)(sql, values));
      queue = result.catch(() => {});
      return result;
    },
    lock: pool ? ' FOR UPDATE' : '',
    async transaction(work) {
      const execute = async () => {
        const client = pool ? await pool.connect() : null;
        const query = makeQuery(client);
        try {
          if (client) await client.query('BEGIN'); else sqlite.exec('BEGIN IMMEDIATE');
          const result = await work({ query, lock: db.lock });
          if (client) await client.query('COMMIT'); else sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          if (client) await client.query('ROLLBACK'); else sqlite.exec('ROLLBACK');
          throw error;
        } finally { client?.release(); }
      };
      if (pool) return execute();
      const result = queue.then(execute);
      queue = result.catch(() => {});
      return result;
    },
    async close() { await queue; if (pool) await pool.end(); else sqlite.close(); }
  };
  return db;
}
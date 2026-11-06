import { randomBytes, createHash, randomUUID, createPublicKey } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const assert = (condition, status, message) => { if (!condition) throw new HttpError(status, message); };
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const safeUser = ({ id, email, pseudo, role, avatar, verified }) => ({ id, email, pseudo, role, avatar, verified: Boolean(verified) });
export const emailSchema = z.string().trim().pipe(z.email().max(254)).transform(v => v.toLowerCase());
const bcryptLimit = value => Buffer.byteLength(value, 'utf8') <= 72;
export const passwordSchema = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.').max(72)
  .refine(bcryptLimit, 'Le mot de passe doit tenir dans 72 octets UTF-8.')
  .refine(value => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value),
    'Choisissez un mot de passe fort : au moins une majuscule, une minuscule et un chiffre.');

export async function getSecret() {
  if (process.env.JWT_SECRET) {
    assert(process.env.JWT_SECRET.length >= 32, 500, 'JWT_SECRET doit contenir au moins 32 caractères.');
    return process.env.JWT_SECRET;
  }
  assert(process.env.NODE_ENV !== 'production', 500, 'JWT_SECRET est obligatoire en production.');
  await mkdir('data', { recursive: true });
  try { return await readFile('data/auth-secret', 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const secret = randomBytes(48).toString('hex');
    try { await writeFile('data/auth-secret', secret, { flag: 'wx', mode: 0o600 }); return secret; }
    catch (writeError) { if (writeError.code === 'EEXIST') return readFile('data/auth-secret', 'utf8'); throw writeError; }
  }
}

export function createAuth(db, secret, { mailer, origin = process.env.APP_URL || 'http://localhost:5173' } = {}) {
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' };
  const smtp = mailer || (process.env.SMTP_HOST ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  }) : null);
  async function sendLink(user, kind, invite) {
    const token = randomBytes(32).toString('hex');
    const route = kind === 'verify' ? 'verify' : 'reset';
    await db.query('INSERT INTO auth_tokens (hash,user_id,kind,expires_at) VALUES (?,?,?,?)',
      [hashToken(token), user.id, kind, Date.now() + (kind === 'verify' ? 86400000 : 3600000)]);
    const url = new URL(`/?${route}=${token}`, origin);
    if (invite) {
      url.searchParams.set('session', invite.session);
      if (invite.code) url.searchParams.set('code', invite.code);
    }
    const link = url.toString();
    if (smtp) await smtp.sendMail({ from: process.env.MAIL_FROM || 'Tufurayi <noreply@example.com>', to: user.email,
      subject: kind === 'verify' ? 'Vérifiez votre compte Tufurayi' : 'Réinitialisez votre mot de passe',
      text: `Bonjour ${user.pseudo},\n\n${invite ? 'Vérifiez votre compte puis connectez-vous : vous entrerez directement dans la salle du quiz auquel vous avez été invité.\n\n' : ''}${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.` });
    else {
      assert(process.env.NODE_ENV !== 'production', 503, 'Le service email n’est pas configuré.');
      console.info(`[Email local → ${user.email}] ${link}`);
    }
  }
  const access = user => jwt.sign({ sub: user.id, ver: user.token_version || 0 }, secret, { expiresIn: '15m', issuer: 'tufurayi', audience: 'tufurayi' });
  async function issue(res, user) {
    const refresh = randomBytes(48).toString('hex');
    await db.query('INSERT INTO auth_tokens (hash,user_id,kind,expires_at) VALUES (?,?,?,?)',
      [hashToken(refresh), user.id, 'refresh', Date.now() + 7 * 86400000]);
    res.cookie('refresh', refresh, { ...cookieOptions, maxAge: 7 * 86400000 });
    return { token: access(user), user: safeUser(user) };
  }
  async function authenticate(token) {
    let payload;
    try { payload = jwt.verify(token || '', secret, { issuer: 'tufurayi', audience: 'tufurayi' }); }
    catch { throw new HttpError(401, 'Votre session a expiré. Reconnectez-vous.'); }
    const [user] = await db.query('SELECT * FROM users WHERE id=?', [payload.sub]);
    assert(user && !user.disabled && user.token_version === payload.ver, 401, 'Ce compte est indisponible ou la session a été révoquée.');
    return user;
  }
  const middleware = async (req, _res, next) => {
    try { req.user = await authenticate(req.headers.authorization?.replace(/^Bearer /, '')); next(); }
    catch (error) { next(error); }
  };
  async function postForm(url, params) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    assert(response.ok, 502, 'Le fournisseur de connexion n’a pas répondu. Réessayez.');
    return response.json();
  }
  function appleClientSecret() {
    const key = process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    return jwt.sign({}, key, { algorithm: 'ES256', keyid: process.env.APPLE_KEY_ID,
      issuer: process.env.APPLE_TEAM_ID, subject: process.env.APPLE_CLIENT_ID, audience: 'https://appleid.apple.com', expiresIn: '5m' });
  }
  async function applePayload(idToken) {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64url').toString());
    const keys = await fetch('https://appleid.apple.com/auth/keys').then(r => r.json());
    const jwk = keys.keys.find(k => k.kid === header.kid);
    assert(jwk, 502, 'La clé de signature Apple est introuvable.');
    return jwt.verify(idToken, createPublicKey({ key: jwk, format: 'jwk' }),
      { algorithms: ['ES256'], audience: process.env.APPLE_CLIENT_ID, issuer: 'https://appleid.apple.com' });
  }
  const oauth = {
    google: {
      label: 'Google',
      configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      authorize(redirectUri, state) {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', 'openid email profile');
        url.searchParams.set('state', state);
        return url.toString();
      },
      async profile(code, redirectUri) {
        const token = await postForm('https://oauth2.googleapis.com/token', { code, client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' });
        const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
        assert(response.ok, 502, 'Google n’a pas renvoyé votre profil.');
        const profile = await response.json();
        assert(profile.email && profile.email_verified, 403, 'Google n’a pas confirmé votre adresse email.');
        return { email: String(profile.email).toLowerCase(), name: String(profile.name || '') };
      }
    },
    apple: {
      label: 'Apple',
      configured: () => Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
      authorize(redirectUri, state) {
        const url = new URL('https://appleid.apple.com/auth/authorize');
        url.searchParams.set('client_id', process.env.APPLE_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('response_mode', 'form_post');
        url.searchParams.set('scope', 'name email');
        url.searchParams.set('state', state);
        return url.toString();
      },
      async profile(code, redirectUri) {
        const token = await postForm('https://appleid.apple.com/auth/token', { code, client_id: process.env.APPLE_CLIENT_ID,
          client_secret: appleClientSecret(), redirect_uri: redirectUri, grant_type: 'authorization_code' });
        const payload = await applePayload(token.id_token);
        assert(payload.email && payload.email_verified !== false && payload.email_verified !== 'false', 403, 'Apple n’a pas confirmé votre adresse email.');
        return { email: String(payload.email).toLowerCase(), name: '' };
      }
    }
  };
  const oauthRedirectUri = provider => `${origin}/api/auth/oauth/${provider}/callback`;
  return {
    authenticate, middleware, access, sendLink,
    async register(req, res) {
      const input = z.object({ email: emailSchema, password: passwordSchema,
        pseudo: z.string().trim().min(2).max(30), role: z.enum(['player', 'creator']).default('player'),
        invite: z.object({ session: z.uuid(), code: z.string().trim().max(30).regex(/^[\w-]*$/).optional() }).optional().catch(undefined) }).parse(req.body);
      assert(!(await db.query('SELECT id FROM users WHERE email=?', [input.email])).length, 409, 'Cet email est déjà utilisé.');
      const user = { email: input.email, pseudo: input.pseudo, role: input.role, id: randomUUID(), avatar: 'indigo', verified: 0 };
      const password = await bcrypt.hash(input.password, 12);
      await db.query('INSERT INTO users (id,email,password_hash,pseudo,role,created_at) VALUES (?,?,?,?,?,?)',
        [user.id, user.email, password, user.pseudo, user.role, Date.now()]);
      await sendLink(user, 'verify', input.invite);
      res.status(201).json({ message: 'Compte créé. Vérifiez votre email avant de vous connecter.' });
    },
    async login(req, res) {
      const { email, password } = z.object({ email: emailSchema, password: z.string().max(72).refine(bcryptLimit) }).parse(req.body);
      const [user] = await db.query('SELECT * FROM users WHERE email=?', [email]);
      assert(user && await bcrypt.compare(password, user.password_hash) && !user.disabled, 401, 'Email ou mot de passe incorrect.');
      assert(user.verified, 403, 'Vérifiez votre email avant de vous connecter.');
      res.json(await issue(res, user));
    },
    async refresh(req, res) {
      const user = await db.transaction(async tx => {
        const [token] = await tx.query(`SELECT * FROM auth_tokens WHERE hash=? AND kind='refresh'${tx.lock}`, [hashToken(req.cookies.refresh || '')]);
        assert(token && Number(token.expires_at) > Date.now(), 401, 'Reconnectez-vous pour continuer.');
        const [user] = await tx.query('SELECT * FROM users WHERE id=?', [token.user_id]);
        assert(user && !user.disabled && user.verified, 401, 'Ce compte est indisponible.');
        await tx.query('DELETE FROM auth_tokens WHERE hash=?', [token.hash]);
        return user;
      });
      res.json(await issue(res, user));
    },
    async logout(req, res) {
      await db.query('DELETE FROM auth_tokens WHERE hash=?', [hashToken(req.cookies.refresh || '')]);
      res.clearCookie('refresh', cookieOptions).json({ message: 'Déconnecté.' });
    },
    async requestLink(req, res, kind) {
      const { email } = z.object({ email: emailSchema }).parse(req.body);
      const [user] = await db.query('SELECT * FROM users WHERE email=?', [email]);
      if (user && (kind !== 'verify' || !user.verified)) await sendLink(user, kind);
      res.json({ message: 'Si ce compte existe, un email vient d’être envoyé. En mode local, consultez le terminal du serveur.' });
    },
    async redeem(req, res, kind) {
      const { token, password } = z.object({ token: z.string().min(32).max(128), password: passwordSchema.optional() }).parse(req.body);
      if (kind === 'reset') assert(password, 400, 'Un nouveau mot de passe est requis.');
      const passwordHash = kind === 'reset' ? await bcrypt.hash(password, 12) : null;
      await db.transaction(async tx => {
        const [saved] = await tx.query(`SELECT * FROM auth_tokens WHERE hash=? AND kind=?${tx.lock}`, [hashToken(token), kind]);
        assert(saved && Number(saved.expires_at) > Date.now(), 400, 'Ce lien est invalide ou expiré.');
        if (kind === 'verify') await tx.query('UPDATE users SET verified=1 WHERE id=?', [saved.user_id]);
        else await tx.query('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?', [passwordHash, saved.user_id]);
        await tx.query("DELETE FROM auth_tokens WHERE user_id=? AND (kind=? OR kind='refresh')", [saved.user_id, kind]);
      });
      res.json({ message: kind === 'verify' ? 'Email vérifié. Vous pouvez vous connecter.' : 'Mot de passe modifié. Reconnectez-vous.' });
    },
    oauthProviders: () => ({ google: oauth.google.configured(), apple: oauth.apple.configured() }),
    oauthStart(req, res) {
      const provider = z.enum(['google', 'apple']).parse(req.params.provider);
      const conf = oauth[provider];
      assert(conf.configured(), 503, `La connexion ${conf.label} n’est pas encore configurée.`);
      const state = jwt.sign({ p: provider, nonce: randomBytes(16).toString('hex') }, secret,
        { expiresIn: '10m', issuer: 'tufurayi', audience: 'tufurayi-oauth' });
      res.redirect(conf.authorize(oauthRedirectUri(provider), state));
    },
    async oauthCallback(req, res) {
      const provider = z.enum(['google', 'apple']).parse(req.params.provider);
      const conf = oauth[provider];
      assert(conf.configured(), 503, `La connexion ${conf.label} n’est pas encore configurée.`);
      const { code, state } = z.object({ code: z.string().min(10).max(4096), state: z.string().min(10).max(2048) })
        .parse({ code: req.query.code ?? req.body?.code, state: req.query.state ?? req.body?.state });
      let payload;
      try { payload = jwt.verify(state, secret, { issuer: 'tufurayi', audience: 'tufurayi-oauth' }); }
      catch { throw new HttpError(400, 'Cette connexion a expiré. Recommencez.'); }
      assert(payload.p === provider, 400, 'Requête de connexion invalide.');
      const profile = await conf.profile(code, oauthRedirectUri(provider));
      const user = await db.transaction(async tx => {
        const [existing] = await tx.query(`SELECT * FROM users WHERE email=?${tx.lock}`, [profile.email]);
        if (existing) {
          assert(!existing.disabled, 403, 'Ce compte est désactivé.');
          // Le fournisseur a confirmé l’adresse : un compte pas encore vérifié devient vérifié.
          if (!existing.verified) { await tx.query('UPDATE users SET verified=1 WHERE id=?', [existing.id]); existing.verified = 1; }
          return existing;
        }
        const name = profile.name.trim().slice(0, 30) || profile.email.split('@')[0].slice(0, 30);
        const created = { id: randomUUID(), email: profile.email, pseudo: name.length >= 2 ? name : 'Joueur',
          role: 'player', avatar: 'indigo', verified: 1, token_version: 0 };
        await tx.query('INSERT INTO users (id,email,password_hash,pseudo,role,verified,created_at) VALUES (?,?,?,?,?,1,?)',
          [created.id, created.email, await bcrypt.hash(randomBytes(32).toString('hex'), 12), created.pseudo, created.role, Date.now()]);
        return created;
      });
      await issue(res, user);
      res.redirect(origin);
    }
  };
}
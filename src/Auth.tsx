import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowLeft, Mail, LockKeyhole, UserRound, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api, message, setToken, type PendingInvite } from './api';
import { AnimatedBanner, Modal } from './components';
import type { User } from './types';

export type AuthMode = 'login' | 'register' | 'forgot' | 'resend' | 'reset' | 'verify';

export function Auth({ initial = 'login', token, invite, close, onLogin }: {
  initial?: AuthMode; token?: string; invite?: PendingInvite | null; close: () => void; onLogin: (user: User) => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initial);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pseudo, setPseudo] = useState('');
  const [role, setRole] = useState('player');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const titles = { login: 'Ravi de vous retrouver', register: 'L’aventure commence ici', forgot: 'Mot de passe oublié', resend: 'Vérifier mon email', reset: 'Un nouveau départ', verify: 'Vérification de votre email' };
  function change(next: AuthMode) { setMode(next); setShowPassword(false); setError(''); setSuccess(''); }
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setSuccess('');
    try {
      if (mode === 'login') {
        const result = await api<{ token: string; user: User }>('/auth/login', 'POST', { email, password });
        setToken(result.token); onLogin(result.user);
      } else {
        const body = mode === 'register' ? { email, password, pseudo, role, ...(invite ? { invite: { session: invite.id, code: invite.code || undefined } } : {}) }
          : mode === 'reset' ? { token, password } : mode === 'verify' ? { token } : { email };
        const result = await api<{ message: string }>(`/auth/${mode}`, 'POST', body);
        if (mode === 'verify') { setMode('login'); setPassword(''); }
        setSuccess(result.message);
      }
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <Modal title={titles[mode]} close={close}>
    <AnimatedBanner key={mode} />
    {invite && ['login', 'register', 'verify'].includes(mode) && <div className="alert info invite-notice" role="note">
      Vous avez été invité à un quiz. {mode === 'register' ? 'Créez votre compte (ou connectez-vous si vous en avez déjà un) : vous entrerez ensuite directement dans la salle.' : 'Connectez-vous pour entrer directement dans la salle du quiz.'}</div>}
    <form onSubmit={submit} className="form">
      {mode === 'register' && <label>Votre pseudo<div className="input-wrap"><UserRound size={17} /><input required minLength={2} maxLength={30} value={pseudo} onChange={e => setPseudo(e.target.value)} placeholder="Comment vous appelle-t-on ?" autoComplete="nickname" /></div></label>}
      {!['verify', 'reset'].includes(mode) && <label>Adresse email<div className="input-wrap"><Mail size={17} /><input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@exemple.fr" autoComplete="email" /></div></label>}
      {['login', 'register', 'reset'].includes(mode) && <label>Mot de passe<div className="input-wrap"><LockKeyhole size={17} /><input className="password-input" required type={showPassword ? 'text' : 'password'} minLength={mode === 'login' ? 1 : 10} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'login' ? 'Votre mot de passe' : '10 caractères minimum'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        <button type="button" className="icon-button password-toggle" onClick={() => setShowPassword(visible => !visible)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={showPassword}>
          {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button></div></label>}
      {mode === 'register' && <label>Je souhaite<select value={role} onChange={e => setRole(e.target.value)}><option value="player">Jouer et apprendre</option><option value="creator">Créer et animer des quiz</option></select></label>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {success && <div className="alert success" role="status"><CheckCircle2 size={18} />{success}</div>}
      {mode === 'verify' && !success && <p>Confirmez votre adresse email pour activer votre compte.</p>}
      <button className="button orange full" disabled={busy || !!success && mode === 'verify'}>
        {busy ? 'Un instant…' : mode === 'login' ? 'Se connecter' : mode === 'register' ? 'Créer mon compte' : mode === 'verify' ? 'Vérifier mon email' : mode === 'reset' ? 'Modifier le mot de passe' : 'Envoyer le lien'}<ArrowRight size={17} />
      </button>
    </form>
    {mode === 'login' && <><div className="auth-links"><button onClick={() => change('forgot')}>Mot de passe oublié ?</button><button onClick={() => change('resend')}>Email non reçu ?</button></div>
      <div className="demo-box"><strong>Découvrir avec un compte de démonstration</strong><div>{[['Joueur', 'alex'], ['Créatrice', 'camille'], ['Admin', 'admin']].map(([label, name]) =>
        <button key={name} onClick={() => { setEmail(`${name}@demo.fr`); setPassword('DemoQuiz2026!'); }}>{label}</button>)}</div><small>Disponible après l’initialisation des données de démonstration.</small></div></>}
    <div className="auth-bottom">{mode === 'login' ? <>Pas encore de compte ? <button onClick={() => change('register')}>Inscrivez-vous</button></> :
      mode === 'register' && invite ? <>Déjà inscrit ? <button onClick={() => change('login')}>Connectez-vous</button></> :
      <button onClick={() => change('login')}><ArrowLeft size={14} />Retour à la connexion</button>}</div>
  </Modal>;
}
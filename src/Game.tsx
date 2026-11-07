import { useCallback, useEffect, useState, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, Radio, Clock3, CheckCircle2, Trophy, ArrowRight, Users, Copy, Wifi, WifiOff, Flag, Download } from 'lucide-react';
import { api, ApiError, getToken, message, number, sessionLink } from './api';
import { Avatar, Board, Empty } from './components';
import { downloadReport } from './report';
import { SessionPlayers, ShareButtons } from './SessionTools';
import type { GameState, User } from './types';

export function Game({ id, user, exit, complete, invitationCode }: { id: string; user: User; exit: () => void; complete: () => void; invitationCode?: string }) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [managePlayers, setManagePlayers] = useState(false);
  const [accessError, setAccessError] = useState('');
  const closePlayers = useCallback(() => setManagePlayers(false), []);
  const socket = useRef<Socket | null>(null);
  const hasCompleted = useRef(false);
  const latestServerTime = useRef(0);
  const clockOffset = useRef(0);
  const completeRef = useRef(complete);
  completeRef.current = complete;
  useEffect(() => {
    let active = true;
    let denied = false;
    setAccessError('');
    const accept = (value: GameState) => {
      if (!active || denied || value.serverTime < latestServerTime.current) return;
      latestServerTime.current = value.serverTime;
      clockOffset.current = value.serverTime - Date.now();
      setState(value);
      if (['finished', 'ended'].includes(value.state) && !hasCompleted.current) { hasCompleted.current = true; completeRef.current(); }
    };
    const refresh = async () => {
      if (denied) return;
      try { accept(await api<GameState>(`/sessions/${id}`)); if (active) setConnectionError(''); }
      catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 403) deny(e.message);
        else setConnectionError(message(e));
      }
    };
    const s = io({ autoConnect: false, auth: { token: getToken() } }); socket.current = s;
    const deny = (text: string) => {
      denied = true; setAccessError(text); setState(null); setManagePlayers(false); s.disconnect(); completeRef.current();
    };
    s.on('session:excluded', (value: { id: string; error: string }) => { if (active && value.id === id) deny(value.error); });
    s.on('connect', () => {
      setConnected(true);
      s.emit('session:join', { id }, (reply: { error?: string; code?: string }) => {
        if (!reply.error || !active) return;
        if (reply.code === 'SESSION_UNAUTHORIZED' || reply.code === 'SESSION_EXCLUDED') deny(reply.error);
        else setError(reply.error);
      });
    });
    s.on('disconnect', () => { if (active) setConnected(false); });
    s.on('connect_error', () => { if (active) setConnected(false); });
    s.on('game:error', (e: { error: string }) => { if (active) setError(e.error); });
    for (const event of ['session:join', 'game:question', 'game:question_end', 'game:end']) s.on(event, accept);
    const reconnect = () => { if (!denied) { s.auth = { token: getToken() }; s.disconnect().connect(); } };
    window.addEventListener('auth:token', reconnect);
    s.connect(); void refresh();
    const poll = setInterval(refresh, 3000);
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => { active = false; clearInterval(poll); clearInterval(timer); window.removeEventListener('auth:token', reconnect); s.disconnect(); socket.current = null; };
  }, [id]);
  async function action(path: string, body?: unknown) {
    setBusy(true); setError('');
    try { await api(`/sessions/${id}/${path}`, 'POST', body || {}); setState(await api<GameState>(`/sessions/${id}`)); }
    catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setAccessError(e.message); setState(null); setManagePlayers(false); socket.current?.disconnect(); completeRef.current();
      } else setError(message(e));
    } finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(sessionLink(id, invitationCode)); setCopied(true); }
    catch (e) { setError(`Impossible de copier le lien : ${message(e)}`); }
  }
  async function download() {
    setDownloading(true); setError('');
    try { await downloadReport(id); }
    catch (e) { setError(message(e)); }
    finally { setDownloading(false); }
  }
  if (accessError) return <><button className="text-button" onClick={exit}><ArrowLeft size={16} />Retour au tableau de bord</button><div className="alert error" role="alert">{accessError}</div></>;
  if (!state) return <><button className="text-button" onClick={exit}><ArrowLeft size={16} />Retour</button>{error || connectionError ? <div className="alert error" role="alert">{error || connectionError}</div> : <div className="loading">Connexion à la session…</div>}</>;
  const q = state.question;
  const seconds = q ? Math.max(0, Math.ceil((q.endsAt - now - clockOffset.current) / 1000)) : 0;
  const finished = ['finished', 'ended'].includes(state.state);
  const review = state.state === 'review';
  const isPlayer = state.players.some(p => p.id === user.id);
  return <div className="game-page">
    <div className="game-toolbar"><button className="text-button quit-button" onClick={exit}><ArrowLeft size={17} />Quitter la salle</button>
      <span className={`connection ${connected ? '' : 'offline'}`}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}{connected ? 'Connecté en temps réel' : 'Actualisation automatique'}</span></div>
    <div className="page-heading"><div><div className="eyebrow dark">{state.mode === 'live' ? <Radio size={15} /> : <Clock3 size={15} />}{state.mode === 'live' ? 'QUIZ EN DIRECT' : 'À VOTRE RYTHME'}</div><h1>{state.title}</h1></div>
      <button className="button secondary" onClick={() => setSharing(open => !open)} aria-expanded={sharing}><Copy size={16} />Inviter un ami</button></div>
    {sharing && <div className="panel game-share"><label>Lien d’invitation<input readOnly value={sessionLink(id, invitationCode)} onFocus={e => e.currentTarget.select()} /></label>
      <button className="text-button" onClick={copy}><Copy size={14} />{copied ? 'Lien copié' : 'Copier le lien'}</button>
      <ShareButtons link={sessionLink(id, invitationCode)} title={state.title} />
      <small>Vos amis doivent avoir un compte et l’autorisation explicite d’un administrateur pour cette salle.</small></div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {connectionError && <div className="alert error" role="alert">Connexion interrompue : {connectionError} Nouvelle tentative automatique…</div>}
    <div className="game-layout"><section className="game-panel">
      {state.state === 'waiting' ? <div className="waiting-room"><span className="waiting-icon"><Radio size={42} /></span><span className="pill">SALLE D’ATTENTE</span><h2>On se retrouve tous ici.</h2><p>{
        state.mode === 'async'
          ? isPlayer ? 'Installez-vous ! Cliquez sur « Commencez le quiz » : votre chronomètre démarre à ce moment-là.' : 'Chaque joueur lance le quiz quand il est prêt, à son rythme.'
          : state.host ? 'Vos joueurs sont prêts ? Lancez le quiz : tout le monde recevra la même question au même moment.' : 'Installez-vous ! L’animateur lancera le quiz dès que tout le monde sera prêt.'}</p>
        <div className="waiting-avatars">{state.players.filter(p => !p.excluded).slice(0, 8).map(p => <Avatar key={p.id} user={p} />)}</div><span className="small-note">{state.players.filter(p => !p.excluded).length} joueur(s) dans la salle</span>
        {state.host && state.mode === 'live' && <button className="button orange" disabled={busy} onClick={() => action('control', { action: 'start' })}>Commencez le quiz<ArrowRight size={17} /></button>}
        {state.mode === 'async' && isPlayer && <button className="button orange" disabled={busy} onClick={() => action('start')}>Commencez le quiz<ArrowRight size={17} /></button>}
      </div> : finished ? <div className="final-result"><div className="final-trophy"><Trophy size={56} /></div><span className="pill">DÉFI TERMINÉ</span><h2>{isPlayer ? 'Bien joué, ' + user.pseudo + ' !' : 'Merci pour cette belle partie !'}</h2><p>Une nouvelle étape dans votre aventure.</p>
        {isPlayer && <><div className="final-score">{number(state.score)}<span>points sur {number(1000)}</span></div><div className="result-summary"><span><Flag size={17} />{state.total} question{state.total > 1 ? 's' : ''}</span><span><Trophy size={17} />{state.players.findIndex(p => p.id === user.id) + 1}{state.players.findIndex(p => p.id === user.id) === 0 ? 'er' : 'e'} du classement</span></div></>}
        <button className="button secondary" disabled={downloading} onClick={() => void download()}><Download size={17} />{downloading ? 'Préparation du PDF…' : 'Télécharger le relevé PDF'}</button>
        <button className="button orange" onClick={exit}>Retour au tableau de bord<ArrowRight size={16} /></button></div> :
        q && <div className="question-screen"><div className="question-top"><span>QUESTION <strong>{state.index + 1}</strong> / {state.total}</span><span className={`timer ${seconds <= 5 ? 'urgent' : ''}`}><Clock3 size={18} />{review ? 'Terminé' : `${seconds} s`}</span></div>
          <div className="question-progress"><span style={{ width: `${review ? 100 : Math.min(100, (1 - seconds / q.duration) * 100)}%` }} /></div>
          <h2>{q.text}</h2><p className="question-instruction">{review ? 'Voici ce qu’il fallait retenir.' : state.answered ? 'Votre réponse est enregistrée. Attendez la fin du temps.' : isPlayer ? 'Choisissez la bonne réponse. À vous de jouer !' : 'Les joueurs répondent…'}</p>
          <div className="game-answers">{q.answers.map((a, i) => <button key={a.id} disabled={busy || state.answered || review || !isPlayer || seconds === 0}
            className={`${review && a.correct ? 'correct' : ''} ${review && a.id === q.selected && !a.correct ? 'incorrect' : ''}`}
            onClick={() => action('answer', { answerId: a.id, questionId: q.id })}><span className="answer-letter">{String.fromCharCode(65 + i)}</span><span>{a.text}</span>{review && a.correct && <CheckCircle2 size={21} />}</button>)}</div>
          {!review && state.answered && <div className="recorded"><CheckCircle2 size={18} />Réponse enregistrée. Le classement sera révélé à la fin du compte à rebours.</div>}
          {review && <><div className="explanation"><strong>{q.points ? `+${q.points} points. Bien trouvé !` : 'Chaque question est une occasion d’apprendre.'}</strong><p>{q.explanation || 'La bonne réponse est indiquée en vert.'}</p></div>
            {(state.mode === 'async' || state.host) ? <button className="button orange" disabled={busy} onClick={() => action(state.mode === 'async' ? 'next' : 'control', state.mode === 'live' ? { action: 'next' } : {})}>
              {state.index + 1 === state.total ? 'Voir les résultats' : 'Question suivante'}<ArrowRight size={17} /></button> : <p className="small-note">L’animateur prépare la question suivante…</p>}</>}
        </div>}
    </section><aside className="panel game-board"><div className="section-header"><h3><Trophy size={18} />{finished ? 'Classement final' : 'Le classement'}</h3><span className="pill subtle">{state.players.length}</span></div>
      {state.host && <button className="text-button" onClick={() => setManagePlayers(true)}><Users size={16} />Gérer les joueurs</button>}
      {state.players.length ? <Board entries={state.players} userId={user.id} /> : <Empty title="La salle vous attend" text="Partagez le lien pour inviter vos premiers joueurs." />}
      <div className="board-footnote"><Users size={15} />{state.mode === 'live' ? 'Un défi, tous ensemble.' : 'Le classement évolue à chaque résultat.'}</div></aside></div>
    {finished && state.correction && <section className="panel correction"><div className="section-header"><h2>Un peu plus de connaissances</h2><span className="small-note">Votre correction détaillée</span></div>
      {state.correction.map((c, i) => <div className="correction-row" key={i}><span className={`correction-number ${c.points ? 'good' : ''}`}>{i + 1}</span><div><h3>{c.text}</h3><p>Votre réponse : <strong>{c.selected || 'Aucune réponse'}</strong> • Bonne réponse : <strong>{c.correct}</strong></p><small>{c.explanation}</small></div><strong className={c.points ? 'text-green' : 'muted'}>+{c.points}</strong></div>)}
    </section>}
    {managePlayers && <SessionPlayers id={id} title={state.title} close={closePlayers} changed={() => completeRef.current()} administrator={user.role === 'admin'} />}
  </div>;
}
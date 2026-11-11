import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Trophy, Clock3, ArrowUpRight, Save, Medal, Target, ShieldCheck, Check, EyeOff, Download, Users, Archive } from 'lucide-react';
import { api, date, message, number } from './api';
import { Avatar, Board, Empty } from './components';
import { downloadReport } from './report';
import { SessionPlayers } from './SessionTools';
import type { User, History, BoardEntry, AdminData } from './types';

export function HistoryPage({ history, open }: { history: History[]; open: (id: string) => void }) {
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  async function download(sessionId: string) {
    setDownloading(sessionId); setError('');
    try { await downloadReport(sessionId); }
    catch (e) { setError(message(e)); }
    finally { setDownloading(''); }
  }
  return <><div className="page-heading"><div><div className="eyebrow dark">CHAQUE DÉFI COMPTE</div><h1>Votre parcours</h1><p>Vos résultats, vos découvertes et les quiz à reprendre.</p></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {!history.length ? <Empty title="Votre histoire commence maintenant" text="Jouez votre premier quiz pour retrouver ici vos résultats et votre progression." /> :
      <section className="panel table-scroll"><table><thead><tr><th>Quiz</th><th>Mode</th><th>Score</th><th>Progression</th><th>Date</th><th>Résultats</th></tr></thead><tbody>{history.map(h => <tr key={h.id}>
        <td><strong>{h.title}</strong><small className="table-small">{h.category}</small></td><td><span className="tag">{h.mode === 'live' ? 'En direct' : 'À votre rythme'}</span></td>
        <td><strong>{number(h.score)}</strong><small> / {number(1000)}</small></td><td><span className={`status ${h.status === 'finished' ? 'done' : ''}`}>{h.status === 'finished' ? 'Terminé' : 'En cours'}</span></td>
        <td>{h.finished_at ? date(h.finished_at) : '—'}</td><td>{h.excluded ? <span>Exclu — résultats conservés</span> : <div className="report-actions"><button className="text-button" onClick={() => open(h.session_id)}>{h.status === 'finished' ? 'Résultats' : 'Reprendre'}<ArrowUpRight size={16} /></button>
          {h.status === 'finished' && <button className="text-button" disabled={downloading !== ''} onClick={() => void download(h.session_id)}><Download size={16} />{downloading === h.session_id ? 'Préparation…' : 'Télécharger mes notes'}</button>}</div>}</td>
      </tr>)}</tbody></table></section>}
  </>;
}

export function LeaderboardPage({ user }: { user: User }) {
  const [entries, setEntries] = useState<BoardEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; api<BoardEntry[]>('/leaderboard').then(d => { if (active) setEntries(d); }).catch(e => { if (active) setError(message(e)); }); return () => { active = false; }; }, []);
  return <><div className="page-heading"><div><div className="eyebrow dark">LE GOÛT DU DÉFI</div><h1>Le classement général</h1><p>Des esprits curieux, de beaux défis. Trouvez votre place.</p></div><span className="large-icon"><Trophy size={32} /></span></div>
    {error && <div className="alert error">{error}</div>}{!entries && !error && <div className="loading">Chargement du classement…</div>}
    {entries && !entries.length && <Empty title="La première place est libre" text="Terminez un quiz pour entrer dans le classement général." />}
    {entries && entries.length > 0 && <><div className="podium">{entries.slice(0, 3).map((e, i) => <div key={e.id} className={`podium-card place-${i}`}><Medal size={30} /><Avatar user={e} size="lg" /><h3>{e.pseudo}</h3><span>{i + 1}{i === 0 ? 'er' : 'e'} au classement</span><strong>{number(e.score)} <small>pts</small></strong><p>{e.games} quiz terminés</p></div>)}</div><section className="panel"><div className="section-header"><h3>Tous les joueurs</h3><span className="small-note">Points cumulés des sessions terminées</span></div><Board entries={entries} userId={user.id} /></section></>}
  </>;
}
export function ProfilePage({ user, history, update }: { user: User; history: History[]; update: (u: User) => void }) {
  const [pseudo, setPseudo] = useState(user.pseudo);
  const [avatar, setAvatar] = useState(user.avatar);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const finished = history.filter(h => h.status === 'finished');
  const score = finished.reduce((n, h) => n + Number(h.score), 0);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setSuccess(false);
    try { update(await api<User>('/me', 'PUT', { pseudo, avatar })); setSuccess(true); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const badges = [{ icon: Medal, title: 'Premier pas', text: 'Terminer votre premier quiz', earned: finished.length >= 1 },
    { icon: Target, title: 'Esprit curieux', text: 'Terminer 5 quiz', earned: finished.length >= 5 },
    { icon: Trophy, title: 'En pleine forme', text: 'Accumuler 10 000 points', earned: score >= 10000 }];
  return <><div className="page-heading"><div><div className="eyebrow dark">UN PROFIL QUI VOUS RESSEMBLE</div><h1>Mon profil</h1><p>Votre identité, vos progrès et vos prochaines victoires.</p></div></div>
    <div className="profile-layout"><section className="panel"><div className="profile-header"><Avatar user={{ pseudo, avatar }} size="lg" /><div><h2>{user.pseudo}</h2><span className="tag">{user.role === 'creator' ? 'Créateur / Animateur' : user.role === 'admin' ? 'Administrateur' : 'Joueur'}</span></div></div>
      <form className="form" onSubmit={save}><label>Pseudo<input required minLength={2} maxLength={30} value={pseudo} onChange={e => setPseudo(e.target.value)} /></label>
        <label>Adresse électronique<input disabled value={user.email} /><small><ShieldCheck size={13} /> Adresse vérifiée</small></label>
        <label>Couleur de votre avatar</label><div className="avatar-picker">{[['indigo', 'indigo'], ['green', 'vert'], ['orange', 'orange'], ['pink', 'rose'], ['blue', 'bleu']].map(([c, label]) => <button key={c} type="button" aria-label={`Avatar ${label}`} aria-pressed={avatar === c} onClick={() => setAvatar(c)} className={avatar === c ? 'active' : ''}><Avatar user={{ pseudo, avatar: c }} /></button>)}</div>
        {error && <div className="alert error">{error}</div>}{success && <div className="alert success" role="status">Votre profil a été mis à jour.</div>}
        <button className="button orange" disabled={busy}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer les modifications'}</button></form>
    </section><div><div className="profile-stats"><div className="panel"><Trophy size={23} /><strong>{number(score)}</strong><span>points accumulés</span></div><div className="panel"><Clock3 size={23} /><strong>{finished.length}</strong><span>quiz terminés</span></div></div>
      <section className="panel badges"><h3>Vos petites grandes victoires</h3>{badges.map(b => <div key={b.title} className={b.earned ? 'earned' : 'locked'}><span><b.icon size={24} /></span><div><strong>{b.title}</strong><small>{b.text}</small></div>{b.earned && <Check size={18} />}</div>)}</section></div></div>
  </>;
}
export function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [players, setPlayers] = useState<{ id: string; title: string } | null>(null);
  const closePlayers = useCallback(() => setPlayers(null), []);
  async function load() { try { setData(await api<AdminData>('/admin')); } catch (e) { setError(message(e)); } }
  useEffect(() => { void load(); }, []);
  async function download(sessionId: string) {
    setDownloading(sessionId); setError('');
    try { await downloadReport(sessionId, 'collective'); }
    catch (e) { setError(message(e)); }
    finally { setDownloading(''); }
  }
  async function update(path: string, body: unknown) {
    setBusy(true); setError('');
    try { await api(path, 'PUT', body); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function archiveQuiz(quiz: { id: string; title: string }) {
    if (!window.confirm(`Supprimer « ${quiz.title} » du catalogue ? Ses sessions, résultats et historiques seront conservés.`)) return;
    setBusy(true); setError('');
    try { await api(`/admin/quizzes/${quiz.id}/archive`, 'POST'); await load(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function sessionState(session: AdminData['sessions'][number]) {
    if (session.status === 'ended' || Number(session.closes_at) <= Date.now() || session.participation_status === 'finished')
      return { label: 'Quiz terminé', done: true };
    if (Number(session.opens_at) > Date.now()) return { label: 'À venir', done: false };
    if (session.participation_status) return { label: 'Reprendre', done: false };
    if (session.mode === 'live' && session.status !== 'waiting') return { label: 'En cours', done: false };
    return { label: 'À jouer', done: false };
  }
  return <><div className="page-heading"><div><div className="eyebrow dark">ESPACE ADMINISTRATION</div><h1>Veiller sur la communauté</h1><p>Gérez les accès et gardez un espace de jeu bienveillant.</p></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}{!data && !error && <div className="loading">Chargement…</div>}
    {data && <><div className="metric-grid"><div className="metric"><span>Utilisateurs</span><strong>{data.users.length}</strong></div><div className="metric"><span>Quiz créés</span><strong>{data.totals.quizzes}</strong></div><div className="metric"><span>Sessions</span><strong>{data.totals.sessions}</strong></div><div className="metric"><span>Participations</span><strong>{data.totals.participations}</strong></div></div>
      <section className="panel table-scroll"><div className="section-header"><h3>Les utilisateurs</h3></div><table><thead><tr><th>Utilisateur</th><th>Email</th><th>Rôle</th><th>Accès</th></tr></thead><tbody>{data.users.map(u => <tr key={u.id}>
        <td><strong>{u.pseudo}</strong></td><td>{u.email}</td><td><select aria-label={`Rôle de ${u.pseudo}`} value={u.role} disabled={busy} onChange={e => update(`/admin/users/${u.id}`, { role: e.target.value, disabled: u.disabled })}><option value="player">Joueur</option><option value="creator">Créateur</option><option value="admin">Admin</option></select></td>
        <td><button className={`button compact ${u.disabled ? 'secondary' : 'danger-button'}`} disabled={busy} onClick={() => update(`/admin/users/${u.id}`, { role: u.role, disabled: !u.disabled })}>{u.disabled ? 'Réactiver' : 'Suspendre'}</button></td></tr>)}</tbody></table></section>
      <section className="panel table-scroll"><div className="section-header"><h3>Quiz publiés</h3><span className="small-note">Retirez un quiz du catalogue sans effacer ses sessions ni ses résultats.</span></div>
        {!data.quizzes.filter(quiz => quiz.published).length ? <p className="muted">Aucun quiz publié à afficher.</p> :
          <table><thead><tr><th>Quiz</th><th>Créateur</th><th>Sessions</th><th>Participations</th><th>Publication</th><th /></tr></thead><tbody>{data.quizzes.filter(quiz => quiz.published).map(quiz =>
            <tr key={quiz.id}><td><strong>{quiz.title}</strong><small className="table-small">Publié le {date(quiz.created_at)}</small></td>
              <td>{quiz.owner}</td><td>{quiz.session_count}</td><td>{quiz.player_count}</td><td><span className="status done">Publié</span></td>
              <td><button className="button danger-button compact" disabled={busy} onClick={() => void archiveQuiz(quiz)}><Archive size={15} />Supprimer du catalogue</button></td></tr>)}</tbody></table>}
      </section>
      <section className="panel table-scroll"><div className="section-header"><h3>Résultats collectifs et autorisations d’entrée</h3><span className="small-note">Ouvrez « Gérer les joueurs » pour autoriser ou refuser l’entrée dans chaque salle.</span></div>
        {!data.sessions.length ? <p className="muted">Aucune session à afficher.</p> :
          <table><thead><tr><th>Quiz</th><th>Votre état</th><th>Mode</th><th>Animateur</th><th>Joueurs</th><th>Date</th><th /></tr></thead><tbody>{data.sessions.map(session => {
            const state = sessionState(session);
            return <tr key={session.id}>
            <td><strong>{session.title}</strong></td><td><span className={`status ${state.done ? 'done' : ''}`}>{state.label}</span></td>
            <td>{session.mode === 'live' ? 'En direct' : 'À votre rythme'}</td><td>{session.owner}</td><td>{session.player_count}</td><td>{date(session.created_at)}</td>
            <td><div className="report-actions"><button className="button secondary compact" onClick={() => setPlayers({ id: session.id, title: session.title })}><Users size={15} />Gérer les joueurs</button>
              {session.pending_access_count > 0 && <span className="pill">{session.pending_access_count} demande(s) d’entrée</span>}
              <button className="button secondary compact" disabled={downloading !== ''} onClick={() => void download(session.id)}><Download size={15} />{downloading === session.id ? 'Préparation…' : 'Télécharger le relevé collectif'}</button>
              {session.published && (session.status === 'ended' || Number(session.closes_at) <= Date.now()) &&
                <button className="button danger-button compact" disabled={busy} onClick={() => void archiveQuiz({ id: session.quiz_id, title: session.title })}><Archive size={15} />Supprimer le quiz terminé</button>}</div></td>
          </tr>;
          })}</tbody></table>}
      </section>
      <section className="panel"><div className="section-header"><h3>Signalements</h3><span className="pill">{data.reports.filter(r => r.status === 'open').length} à traiter</span></div>
        {!data.reports.length && <p className="muted">Aucun signalement. Tout va bien !</p>}{data.reports.map(r => <div className="report" key={r.id}><div><h4>{r.title}</h4><p>{r.reason}</p><small>Signalé par {r.pseudo} • {r.status === 'open' ? 'À traiter' : 'Résolu'}</small></div>
          {r.status === 'open' && <div className="report-actions"><button className="button secondary compact" disabled={busy} onClick={() => update(`/admin/reports/${r.id}`, { hide: false })}><Check size={15} />Classer</button><button className="button danger-button compact" disabled={busy} onClick={() => update(`/admin/reports/${r.id}`, { hide: true })}><EyeOff size={15} />Masquer le quiz</button></div>}</div>)}
      </section>
      <section className="panel"><div className="section-header"><h3>Réclamations et signalements des joueurs</h3><span className="pill">{data.feedback.filter(item => item.status === 'open').length} à traiter</span></div>
        {!data.feedback.length ? <p className="muted">Aucune réclamation reçue.</p> : data.feedback.map(item =>
          <div className="report" key={item.id}><div><h4>{item.category} • {item.pseudo}</h4><p className="feedback-message">{item.message}</p>
            <small>Compte : {item.email} • Accusé envoyé à : {item.receipt_email} • {date(item.created_at)} • {item.status === 'open' ? 'À traiter' : 'Traitée'}</small></div>
            <button className="button secondary compact" disabled={busy}
              onClick={() => update(`/admin/feedback/${item.id}`, { status: item.status === 'open' ? 'resolved' : 'open' })}>
              <Check size={15} />{item.status === 'open' ? 'Marquer comme traitée' : 'Rouvrir'}</button>
          </div>)}
      </section></>}
    {players && <SessionPlayers id={players.id} title={players.title} close={closePlayers} changed={() => void load()} administrator />}
  </>;
}
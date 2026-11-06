import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { LayoutDashboard, Compass, Radio, FolderHeart, BarChart3, Trophy, UserRound, ShieldCheck, Plus,
  Search, ChevronDown, ArrowUpRight, ArrowRight, LogOut, Menu, X, Clock3, Zap, Target, Medal, Sparkles, Copy, CalendarDays, Pencil, Flag, Bell, Users } from 'lucide-react';
import { api, ApiError, date, message, number, parseSessionLink, readInvite, restore, saveInvite, setToken, type PendingInvite } from './api';
import { Avatar, Board, categories, CategoryIcon, Empty, Footer, Hero, Logo, Modal, QuizCover, SessionCard } from './components';
import { Auth, type AuthMode } from './Auth';
import { Editor, Schedule, Stats } from './Editor';
import { Game } from './Game';
import { SessionInvitation, SessionPlayers } from './SessionTools';
import { AdminPage, HistoryPage, LeaderboardPage, ProfilePage } from './Account';
import type { BoardEntry, History, Page, Quiz, Session, User } from './types';

const navigation = [
  { page: 'dashboard' as const, label: 'Tableau de bord', icon: LayoutDashboard },
  { page: 'catalogue' as const, label: 'Explorer les quiz', icon: Compass },
  { page: 'live' as const, label: 'Quiz en direct', icon: Radio },
  { page: 'quizzes' as const, label: 'Mes quiz', icon: FolderHeart, creator: true },
  { page: 'history' as const, label: 'Mon historique', icon: BarChart3 },
  { page: 'leaderboard' as const, label: 'Classement', icon: Trophy }
];
const pageNames: Record<Page, string> = { dashboard: 'Tableau de bord', catalogue: 'Explorer les quiz', live: 'Quiz en direct', quizzes: 'Mes quiz', history: 'Mon historique', leaderboard: 'Classement', profile: 'Mon profil', admin: 'Administration' };
type Popup = { type: 'editor'; id?: string; duplicate?: boolean } | { type: 'schedule'; quiz: Quiz } | { type: 'stats'; quiz: Quiz } | { type: 'join' } | { type: 'report'; quizId: string } | { type: 'players'; id: string; title: string };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [page, setPage] = useState<Page>('dashboard');
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [authToken, setAuthToken] = useState<string | undefined>();
  const [popup, setPopup] = useState<Popup | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Toutes');
  const [mode, setMode] = useState('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [reportReason, setReportReason] = useState('');
  const closePopup = useCallback(() => setPopup(null), []);
  const closeAuth = useCallback(() => {
    setAuthMode(null); setAuthToken(undefined);
    const params = new URLSearchParams(location.search); params.delete('verify'); params.delete('reset');
    window.history.replaceState({}, '', `${location.pathname}${params.size ? '?' + params : ''}`);
  }, []);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(location.search);
    const verifying = params.has('verify') || params.has('reset');
    if (verifying) {
      setAuthMode(params.has('verify') ? 'verify' : 'reset');
      setAuthToken(params.get('verify') || params.get('reset') || undefined);
    }
    const pending = readInvite();
    if (pending) { saveInvite(pending); setInvite(pending); }
    restore().then(({ user }) => { if (active) setUser(user); }).catch(e => {
      if (active && !(e instanceof ApiError && e.status === 401)) setError(message(e));
      // A player who already has an account logs in and lands directly in the room; newcomers switch to sign up in one click.
      if (active && pending && !verifying) setAuthMode('login');
    }).finally(() => { if (active) setInitializing(false); });
    const expired = () => { setUser(null); setGameId(null); setAuthMode('login'); setError('Votre session a expiré. Reconnectez-vous.'); };
    window.addEventListener('auth:expired', expired);
    return () => { active = false; window.removeEventListener('auth:expired', expired); };
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [s, q, h, b] = await Promise.all([api<Session[]>('/sessions'), api<Quiz[]>('/quizzes'), api<History[]>('/me/history'), api<BoardEntry[]>('/leaderboard')]);
      setSessions(s); setQuizzes(q); setHistory(h); setBoard(b);
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  }, [user?.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!user || !invite) return;
    let active = true;
    const path = `/sessions/${encodeURIComponent(invite.id)}`;
    const finish = () => {
      saveInvite(null); setInvite(null);
      const params = new URLSearchParams(location.search); params.delete('session'); params.delete('code');
      window.history.replaceState({}, '', `${location.pathname}${params.size ? '?' + params : ''}`);
    };
    setJoinBusy(true); setError('');
    // Hosts and returning players can open the room directly; everyone else joins first.
    api(path).catch(() => api(`${path}/join`, 'POST', { code: invite.code.trim() || undefined }))
      .then(() => { if (!active) return; setPopup(null); setGameCode(invite.code); setGameId(invite.id); void load(); })
      .catch(e => { if (!active) return; setJoinId(invite.id); setJoinCode(invite.code); setError(message(e)); setPopup({ type: 'join' }); })
      .finally(() => { if (active) { finish(); setJoinBusy(false); } });
    return () => { active = false; };
  }, [user?.id, invite]);
  function navigate(next: Page) { if (!user) { setAuthMode('login'); return; } setPage(next); setGameId(null); setMobileNav(false); setError(''); }
  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true); setError('');
    try {
      await api('/auth/logout', 'POST', {}); setToken(null); setUser(null); setGameId(null); setPage('dashboard');
      setSessions([]); setQuizzes([]); setHistory([]); setBoard([]);
      setPopup(null); setMobileNav(false); closeAuth();
    } catch (e) { setError(message(e)); }
    finally { setLogoutBusy(false); }
  }
  async function join(s: Session) {
    setJoinBusy(true); setError('');
    try {
      if (!(s.owner_id === user?.id && s.mode === 'live') && !s.participation_status) await api(`/sessions/${s.id}/join`, 'POST', {});
      setGameCode(''); setGameId(s.id); void load();
    } catch (e) { setError(message(e)); } finally { setJoinBusy(false); }
  }
  async function submitJoin(e: FormEvent) {
    e.preventDefault(); setJoinBusy(true); setError('');
    try {
      const link = parseSessionLink(joinId);
      const id = link.id;
      await api(`/sessions/${encodeURIComponent(id)}/join`, 'POST', { code: joinCode.trim() || link.code || undefined });
      setGameCode(joinCode.trim() || link.code); setGameId(id); setPopup(null); window.history.replaceState({}, '', location.pathname); void load();
    } catch (e) { setError(message(e)); } finally { setJoinBusy(false); }
  }
  async function report(e: FormEvent) {
    e.preventDefault();
    if (popup?.type !== 'report') return;
    setJoinBusy(true); setError('');
    try { await api(`/quizzes/${popup.quizId}/report`, 'POST', { reason: reportReason }); setPopup(null); setReportReason(''); }
    catch (e) { setError(message(e)); } finally { setJoinBusy(false); }
  }
  const creator = user?.role === 'creator' || user?.role === 'admin';
  const finished = history.filter(h => h.status === 'finished');
  const points = finished.reduce((n, h) => n + Number(h.score), 0);
  const isClosed = (s: Session) => Number(s.closes_at) <= Date.now() || s.status === 'ended';
  const openSessions = sessions.filter(s => !isClosed(s));
  const catalogueSessions = [...openSessions, ...sessions.filter(isClosed)];
  const available = useMemo(() => {
    const filtered = catalogueSessions.filter(s => (page !== 'live' || s.mode === 'live') &&
      (category === 'Toutes' || s.category === category) && (mode === 'all' || s.mode === mode) &&
      `${s.title} ${s.description} ${s.category}`.toLowerCase().includes(query.toLowerCase()));
    // The catalogue shows one card per quiz and mode, not every scheduled occurrence.
    return filtered.filter((s, i) => filtered.findIndex(other => other.quiz_id === s.quiz_id && other.mode === s.mode) === i);
  }, [catalogueSessions, page, category, mode, query]);
  const recommended = available.filter(s => !isClosed(s) && s.mode === 'async' && !s.participation_status).slice(0, 3);
  const liveSessions = openSessions.filter(s => s.mode === 'live').slice(0, 3);
  const invitations = openSessions.filter(s => s.visibility !== 'public' && s.owner_id !== user?.id && !s.participation_status);
  const ownQuizzes = quizzes.filter(q => q.owner_id === user?.id);
  const rank = board.findIndex(p => p.id === user?.id);
  const totalPossible = finished.length * 1000;
  if (initializing) return <div className="startup"><Logo /><span>Préparons vos prochains défis…</span></div>;
  return <div className="app-shell">
    {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <button className="brand" aria-label="Tufurayi — Accueil" onClick={() => user ? navigate('dashboard') : setPage('dashboard')}><Logo /></button>
      <div className="sidebar-label">VOTRE ESPACE</div>
      <nav>{navigation.filter(n => !n.creator || creator).map(n => <button key={n.page} className={page === n.page && !gameId ? 'active' : ''} onClick={() => navigate(n.page)}>
        <n.icon size={19} strokeWidth={1.8} /><span>{n.label}</span>{n.page === 'live' && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-divider" /><div className="sidebar-label">MON COMPTE</div>
      <nav><button className={page === 'profile' ? 'active' : ''} onClick={() => navigate('profile')}><UserRound size={19} />Mon profil</button>
        {user?.role === 'admin' && <button className={page === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}><ShieldCheck size={19} />Administration</button>}
        {user && <button onClick={logout} disabled={logoutBusy}><LogOut size={19} />{logoutBusy ? 'Déconnexion…' : 'Se déconnecter'}</button>}</nav>
      <div className="sidebar-bottom"><div className="creator-callout"><div className="callout-icon"><Sparkles size={21} /></div><h3>{creator ? 'À vous de créer !' : 'La curiosité se partage.'}</h3><p>{creator ? 'Transformez vos idées en défis mémorables.' : 'Jouez, apprenez et relevez de nouveaux défis.'}</p>
        <button onClick={() => creator ? setPopup({ type: 'editor' }) : user ? navigate('catalogue') : setAuthMode('register')}>{creator ? 'Créer un quiz' : user ? 'Trouver mon prochain quiz' : 'Rejoindre l’aventure'}<ArrowUpRight size={15} /></button></div>
        {user ? <div className="sidebar-user"><button onClick={() => navigate('profile')}><Avatar user={user} size="sm" /><span><strong>{user.pseudo}</strong><small>{creator ? 'Créateur de curiosité' : 'Esprit curieux'}</small></span></button></div> :
          <button className="button secondary full" onClick={() => setAuthMode('login')}>Se connecter<ArrowRight size={16} /></button>}
      </div><div className="sidebar-copyright">© {new Date().getFullYear()} Tufurayi · La curiosité nous réunit</div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="Ouvrir le menu">{mobileNav ? <X size={20} /> : <Menu size={20} />}</button><span>Mon espace</span><span className="breadcrumb-slash">/</span><strong>{gameId ? 'Salle de quiz' : user ? pageNames[page] : 'Bienvenue'}</strong></div>
      <div className="topbar-right">{user && <button className="icon-button notification-button" aria-label="Voir mes invitations" onClick={() => { navigate('dashboard'); document.getElementById('invitations')?.scrollIntoView({ behavior: 'smooth' }); }}><Bell size={19} />{invitations.length > 0 && <span />}</button>}
        <button className="join-button" onClick={() => user ? (setError(''), setPopup({ type: 'join' })) : setAuthMode('login')}><Plus size={16} />Rejoindre un quiz</button><span className="topbar-divider" />
        {user ? <button className="topbar-profile" onClick={() => navigate('profile')}><Avatar user={user} size="sm" /><ChevronDown size={14} /></button> : <button className="text-button" onClick={() => setAuthMode('login')}>Connexion<ArrowUpRight size={15} /></button>}</div></header>
      <main>{error && !popup && <div className="alert error" role="alert">{error}<button className="icon-button" aria-label="Fermer l’erreur" onClick={() => setError('')}><X size={15} /></button></div>}
        {!user ? <div className="landing"><div className="page-heading"><div><h1>BIENVENUE DANS VOTRE NOUVEL ESPACE DE JEU</h1><h2>Apprendre. Jouer. <span className="text-orange">Ensemble.</span></h2><p>Les bonnes questions rapprochent les gens. Entrez dans la partie.</p></div><span className="pill welcome-pill"><Sparkles size={14} />La curiosité est pour tous</span></div>
          <Hero onDiscover={() => setAuthMode('register')} />
          <div className="landing-features"><div><span className="feature-icon purple"><Radio size={22} /></span><h3>Un défi en direct</h3><p>Une salle, un animateur et les mêmes questions pour tous. Vivez le jeu ensemble.</p></div><div><span className="feature-icon green"><Clock3 size={22} /></span><h3>Votre temps, votre rythme</h3><p>Jouez quand vous voulez et retrouvez votre progression sur tous vos appareils.</p></div><div><span className="feature-icon peach"><Trophy size={22} /></span><h3>Chaque progrès compte</h3><p>Des scores, un historique et des classements. Faites grandir vos connaissances.</p></div></div>
          <div className="section-header"><div><h2>Votre prochain terrain de découverte</h2><p>Un monde de questions. Quelle sera votre première aventure ?</p></div><button className="text-button" onClick={() => setAuthMode('register')}>Créer mon compte<ArrowUpRight size={17} /></button></div>
          <div className="landing-categories">{categories.map((c, i) => <button key={c} onClick={() => { setCategory(c); setAuthMode('register'); }}><span className={`category-tile tile-${i}`}><CategoryIcon category={c} size={35} /></span><strong>{c}</strong><ArrowUpRight size={15} /></button>)}</div>
          <section className="landing-cta"><div><span className="eyebrow dark">POUR LES ESPRITS QUI AIMENT PARTAGER</span><h2>Vous avez les questions.<br />Nous avons le terrain de jeu.</h2><p>Créez votre quiz, invitez vos joueurs et animez votre prochaine session.</p></div><button className="button orange" onClick={() => setAuthMode('register')}>Lancer l’aventure<ArrowUpRight size={17} /></button></section>
        </div> : gameId ? <Game key={gameId} id={gameId} user={user} invitationCode={sessions.find(s => s.id === gameId)?.invitation_code || gameCode || undefined} exit={() => { setGameId(null); setPage('dashboard'); void load(); }} complete={load} /> :
        page === 'dashboard' ? <><div className="page-heading"><div><div className="eyebrow dark">UN NOUVEAU JOUR, UN NOUVEAU DÉFI</div><h1>Bonjour {user.pseudo}<span className="greeting-dot">.</span> <span className="wave">✦</span></h1><p>Un peu de jeu, un peu de savoir. Qu’allez-vous découvrir aujourd’hui ?</p></div>
          {creator && <button className="button secondary" onClick={() => setPopup({ type: 'editor' })}><Plus size={17} />Créer un quiz</button>}</div>
          <Hero onDiscover={() => { setCategory('Toutes'); setQuery(''); navigate('catalogue'); }} onCreate={() => setPopup({ type: 'editor' })} creator={creator} />
          <div className="metric-grid">
            <div className="metric"><span className="metric-icon purple"><Compass size={21} /></span><div><span>Quiz terminés</span><strong>{finished.length}<small> défis relevés</small></strong></div></div>
            <div className="metric"><span className="metric-icon peach"><Zap size={21} /></span><div><span>Points accumulés</span><strong>{number(points)}<small> pts</small></strong></div></div>
            <div className="metric"><span className="metric-icon green"><Target size={21} /></span><div><span>Score moyen</span><strong>{totalPossible ? Math.round(points / totalPossible * 100) : 0}<small> % du maximum</small></strong></div></div>
            <div className="metric"><span className="metric-icon blue"><Medal size={21} /></span><div><span>Classement général</span><strong>{rank === -1 ? '—' : `#${rank + 1}`}<small>{rank === -1 ? ' à vous de jouer' : ' gardez le cap'}</small></strong></div></div>
          </div>
          {invitations.length > 0 && <section id="invitations" className="panel invitations"><div className="section-header"><h3>Vous êtes invité !</h3><span className="pill">{invitations.length} invitation{invitations.length > 1 ? 's' : ''}</span></div>{invitations.map(s => <div className="invitation-row" key={s.id}><QuizCover quiz={s} small /><div><strong>{s.title}</strong><small>{s.owner} vous invite • {s.mode === 'live' ? 'En direct' : 'À votre rythme'}</small></div><button className="button secondary compact" onClick={() => join(s)}>Rejoindre<ArrowRight size={15} /></button></div>)}</section>}
          <div className="section-header"><div><h2>Faits pour votre curiosité <span className="title-spark">✦</span></h2><p>Choisissez un sujet, et laissez-vous surprendre.</p></div><button className="text-button" onClick={() => navigate('catalogue')}>Tous les quiz<ArrowUpRight size={17} /></button></div>
          {loading && !sessions.length ? <div className="loading">Recherche de vos prochains défis…</div> : recommended.length ? <div className="quiz-grid">{recommended.map(s => <SessionCard key={s.id} session={s} user={user} onJoin={join} />)}</div> : <Empty title="De nouveaux défis vous attendent" text="Explorez le catalogue ou invitez un créateur à publier un quiz." action={<button className="button secondary" onClick={() => navigate('catalogue')}>Explorer les quiz<ArrowRight size={16} /></button>} />}
          <div className="dashboard-bottom"><section className="panel live-panel"><div className="section-header"><h3><span className="live-dot" />À vivre ensemble</h3><button className="text-button" onClick={() => navigate('live')}>Tout voir<ArrowUpRight size={15} /></button></div>
            {liveSessions.length ? liveSessions.map(s => <div className="live-row" key={s.id}><QuizCover quiz={s} small /><div><h4>{s.title}</h4><span><Users size={13} />{s.player_count} joueurs · {Number(s.opens_at) > Date.now() ? date(s.opens_at) : s.status === 'waiting' ? 'Salle ouverte' : 'En cours'}</span></div><button className="icon-button" onClick={() => join(s)} aria-label={`Rejoindre ${s.title}`} disabled={joinBusy}><ArrowUpRight size={19} /></button></div>) : <p className="muted">Les prochaines sessions en direct apparaîtront ici.</p>}
          </section><section className="panel mini-board"><div className="section-header"><h3><Trophy size={17} />Les esprits en tête</h3><button className="text-button" onClick={() => navigate('leaderboard')} aria-label="Voir le classement général"><ArrowUpRight size={17} /></button></div>
            {board.length ? <Board entries={board.slice(0, 3)} userId={user.id} /> : <div className="mini-empty"><Trophy size={30} /><p>Le podium n’attend que vous.</p><small>Terminez un quiz pour faire votre entrée.</small></div>}
          </section></div>
        </> : page === 'catalogue' || page === 'live' ? <>
          <div className="page-heading"><div><div className="eyebrow dark">{page === 'live' ? 'PLUS FORT, ENSEMBLE' : 'SUIVEZ VOTRE CURIOSITÉ'}</div><h1>{page === 'live' ? 'Vivez le quiz en direct' : 'Un monde de quiz à explorer'}</h1><p>{page === 'live' ? 'Rejoignez une salle, retrouvez les autres joueurs et entrez dans le jeu.' : 'Un sujet vous intrigue ? C’est le début d’une belle découverte.'}</p></div></div>
          <div className="catalogue-toolbar"><div className="input-wrap search-input"><Search size={19} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un quiz, un sujet…" aria-label="Rechercher un quiz" /></div>
            {page !== 'live' && <select aria-label="Mode de jeu" value={mode} onChange={e => setMode(e.target.value)}><option value="all">Tous les modes</option><option value="async">À votre rythme</option><option value="live">En direct</option></select>}</div>
          <div className="category-filters">{['Toutes', ...categories].map(c => <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>{c !== 'Toutes' && <CategoryIcon category={c} size={15} />}{c}</button>)}</div>
          <div className="results-count"><strong>{available.length}</strong> quiz affiché{available.length > 1 ? 's' : ''}</div>
          {available.length ? <div className="quiz-grid">{available.map(s => <div className="catalogue-card-wrap" key={s.id}><SessionCard session={s} user={user} onJoin={join} /><button className="report-link" onClick={() => { setError(''); setPopup({ type: 'report', quizId: s.quiz_id }); }}><Flag size={12} />Signaler</button></div>)}</div> : <Empty title="Pas encore de quiz par ici" text="Essayez un autre sujet ou revenez bientôt pour de nouveaux défis." />}
        </> : page === 'quizzes' && creator ? <>
          <div className="page-heading"><div><div className="eyebrow dark">VOS IDÉES PRENNENT VIE</div><h1>Mes quiz</h1><p>Créez, partagez et animez vos propres aventures.</p></div><button className="button orange" onClick={() => setPopup({ type: 'editor' })}><Plus size={17} />Créer un quiz</button></div>
          {!ownQuizzes.length ? <Empty title="Votre première création vous attend" text="Une bonne idée et quelques questions suffisent pour commencer." action={<button className="button orange" onClick={() => setPopup({ type: 'editor' })}>Créer mon premier quiz<Plus size={17} /></button>} /> : <div className="quiz-grid">{ownQuizzes.map(q => <article className="quiz-card own-quiz" key={q.id}><QuizCover quiz={q} /><div className="quiz-card-body"><span className="category-label">{q.category}</span><h3>{q.title}</h3><p>{q.description}</p>
            <div className="quiz-meta"><span>{q.question_count} questions</span><span className={`status ${q.published ? 'done' : ''}`}>{q.published ? 'Publié' : 'Brouillon'}</span><span>{q.visibility === 'public' ? 'Public' : 'Privé'}</span></div>
            <div className="own-quiz-actions"><button className="button secondary compact" onClick={() => { setError(''); setPopup({ type: 'editor', id: q.id }); }}><Pencil size={14} />Modifier</button>
              <button className="icon-button" aria-label={`Dupliquer ${q.title}`} onClick={() => setPopup({ type: 'editor', id: q.id, duplicate: true })}><Copy size={17} /></button>
              <button className="icon-button" aria-label={`Statistiques de ${q.title}`} onClick={() => setPopup({ type: 'stats', quiz: q })}><BarChart3 size={17} /></button>
              <button className="button orange compact" disabled={!q.published} onClick={() => setPopup({ type: 'schedule', quiz: q })}><CalendarDays size={14} />Planifier</button></div>
          </div></article>)}</div>}
          <section className="panel creator-sessions"><div className="section-header"><h2>Mes sessions</h2><p>Partagez un lien, puis ouvrez la salle pour animer.</p></div><div className="table-scroll"><table><thead><tr><th>Quiz</th><th>Mode</th><th>Ouverture</th><th>État</th><th>Accès</th><th /></tr></thead><tbody>{sessions.filter(s => s.owner_id === user.id).map(s => <tr key={s.id}><td><strong>{s.title}</strong></td><td>{s.mode === 'live' ? 'Direct' : 'Différé'}</td><td>{date(s.opens_at)}</td><td>{s.status === 'ended' || Number(s.closes_at) <= Date.now() ? 'Terminé' : s.status === 'waiting' ? 'Ouvert / planifié' : 'En cours'}</td>
            <td><SessionInvitation session={s} /></td><td><div className="session-actions"><button className="text-button" onClick={() => s.mode === 'live' ? setGameId(s.id) : setPopup({ type: 'stats', quiz: ownQuizzes.find(q => q.id === s.quiz_id)! })}>{s.mode === 'live' ? 'Ouvrir la salle' : 'Statistiques'}<ArrowUpRight size={15} /></button>
              <button className="text-button" onClick={() => setPopup({ type: 'players', id: s.id, title: s.title })}><Users size={15} />Gérer les joueurs</button></div></td></tr>)}</tbody></table></div></section>
        </> : page === 'history' ? <HistoryPage history={history} open={id => setGameId(id)} /> : page === 'leaderboard' ? <LeaderboardPage user={user} /> :
        page === 'profile' ? <ProfilePage user={user} history={history} update={setUser} /> : page === 'admin' && user.role === 'admin' ? <AdminPage /> : null}
        <Footer />
      </main></div>
    {authMode && <Auth initial={authMode} token={authToken} invite={invite} close={closeAuth} onLogin={u => { setUser(u); closeAuth(); setError(''); }} />}
    {popup?.type === 'editor' && <Editor quizId={popup.id} duplicate={popup.duplicate} close={closePopup} saved={load} />}
    {popup?.type === 'schedule' && <Schedule quiz={popup.quiz} close={closePopup} saved={() => { void load(); }} />}
    {popup?.type === 'stats' && <Stats quiz={popup.quiz} close={closePopup} />}
    {popup?.type === 'players' && <SessionPlayers id={popup.id} title={popup.title} close={closePopup} changed={() => void load()} />}
    {popup?.type === 'join' && <Modal title="Rejoindre l’aventure" close={closePopup}><p className="modal-subtitle">Collez le lien partagé par votre animateur ou l’identifiant de la session.</p><form className="form" onSubmit={submitJoin}>
      <label>Lien ou identifiant de session<input required value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="https://…/?session=…" /></label><label>Code d’invitation (si nécessaire)<input maxLength={30} value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Le code communiqué par l’animateur" /><small>Un quiz privé est réservé aux adresses invitées. Pour un quiz sur invitation, utilisez le lien complet ou saisissez le code transmis par l’animateur.</small></label>
      {error && <div className="alert error" role="alert">{error}</div>}<button className="button orange full" disabled={joinBusy}>{joinBusy ? 'Connexion…' : 'Entrer dans la partie'}<ArrowRight size={17} /></button></form></Modal>}
    {popup?.type === 'report' && <Modal title="Signaler ce quiz" close={closePopup}><p className="modal-subtitle">Aidez-nous à garder un espace de jeu agréable pour tous.</p><form className="form" onSubmit={report}><label>Motif du signalement<textarea required minLength={10} maxLength={1000} rows={4} value={reportReason} onChange={e => setReportReason(e.target.value)} placeholder="Décrivez le contenu à vérifier…" /></label>{error && <div className="alert error" role="alert">{error}</div>}<button className="button orange full" disabled={joinBusy}>Envoyer le signalement<Flag size={16} /></button></form></Modal>}
  </div>;
}
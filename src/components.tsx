import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, ArrowUpRight, Clock3, Users, Radio, Globe2, Atom, Landmark, Code2, Trophy, Sparkles, Shapes, MessageSquareWarning, Send } from 'lucide-react';
import type { Session, User, Quiz, BoardEntry } from './types';
import { api, date, message, number } from './api';
import { PrizeShowcase } from './PrizeShowcase';
import logo from './assets/tufurayi-logo.png';
import gmailIcon from './assets/contact-gmail.jpg';
import whatsappIcon from './assets/contact-whatsapp.jpg';

export function Logo() {
  return <img className="tufurayi-logo" src={logo} alt="Tufurayi" width={1096} height={450} />;
}
export function Footer({ user, onLogin }: { user?: User | null; onLogin?: () => void } = {}) {
  const whatsapp = '+243 85 425 64 90';
  const email = 'jeanpytufurayi9@gmail.com';
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [category, setCategory] = useState('Réclamation');
  const [receiptEmail, setReceiptEmail] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submitComplaint(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/feedback', 'POST', { email: receiptEmail, category, message: details });
      setSuccess(true); setDetails('');
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  return <footer className="main-footer contact-footer" role="contentinfo" aria-label="Informations et contacts">
    <div className="contact-footer-main">
      <div className="contact-footer-intro">
        <div className="contact-footer-logo"><Logo /></div>
        <p>Un espace pour apprendre, jouer et partager de nouveaux défis ensemble.</p>
      </div>
      <div className="contact-footer-details">
        <span className="contact-footer-eyebrow">Nous sommes là pour vous</span>
        <h2>Restons en contact.</h2>
        <p>Une question, une réclamation ou une idée ? Nous sommes à votre écoute.</p>
        <button className="button orange footer-complaint-button" onClick={() => { setComplaintOpen(true); setError(''); setSuccess(false); setReceiptEmail(user?.email || ''); }}>
          <MessageSquareWarning size={17} />Faire une réclamation ou un signalement
        </button>
        <div className="contact-footer-links">
          <a className="contact-footer-link" href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
            target="_blank" rel="noopener noreferrer" aria-label={`Écrire sur WhatsApp au ${whatsapp} (nouvel onglet)`}>
            <span className="contact-footer-icon whatsapp"><img src={whatsappIcon} alt="" width={38} height={38} /></span>
            <span className="contact-footer-link-text"><strong>WhatsApp</strong><small>{whatsapp}</small></span>
            <ArrowUpRight className="contact-footer-arrow" size={17} aria-hidden="true" />
          </a>
          <a className="contact-footer-link" href={`mailto:${email}`} aria-label={`Envoyer un e-mail à ${email}`}>
            <span className="contact-footer-icon email"><img src={gmailIcon} alt="" width={38} height={38} /></span>
            <span className="contact-footer-link-text"><strong>Gmail</strong><small>{email}</small></span>
            <ArrowUpRight className="contact-footer-arrow" size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
    <div className="contact-footer-bottom">
      <div className="contact-footer-taglines">
        <span>Un peu plus curieux qu’hier.</span>
        <span>Fait pour apprendre. Pensé pour partager. <span className="text-orange">✦</span></span>
      </div>
      <div className="contact-footer-copyright">© {new Date().getFullYear()} Tufurayi. Tous droits réservés.</div>
    </div>
    {complaintOpen && <Modal title="Réclamation et signalement" close={() => setComplaintOpen(false)}>
      {!user ? <div className="form"><p>Connectez-vous à votre compte joueur pour transmettre une réclamation ou un signalement à l’administration.</p>
        <button className="button orange full" onClick={() => { setComplaintOpen(false); onLogin?.(); }}>Se connecter<ArrowUpRight size={16} /></button></div> :
        success ? <div className="form"><div className="alert success" role="status">Votre message a été transmis à l’administration. Merci de nous en avoir informés.</div>
          <button className="button secondary full" onClick={() => { setSuccess(false); setComplaintOpen(false); }}>Fermer</button></div> :
          <form className="form" onSubmit={submitComplaint}>
            <p className="modal-subtitle">Votre message sera transmis à l’administration avec votre compte joueur.</p>
            <label>Adresse e-mail pour recevoir l’accusé de réception<input required type="email" maxLength={254} autoComplete="email"
              value={receiptEmail} onChange={event => setReceiptEmail(event.target.value)} placeholder="vous@exemple.fr" /></label>
            <label>Type de demande<select value={category} onChange={event => setCategory(event.target.value)}>
              <option>Réclamation</option><option>Fraude</option><option>Favoritisme</option><option>Insatisfaction</option><option>Autre</option>
            </select></label>
            <label>Décrivez la situation<textarea required minLength={10} maxLength={2000} rows={5} value={details}
              onChange={event => setDetails(event.target.value)} placeholder="Expliquez votre réclamation, le signalement ou ce qui vous mécontente…" /></label>
            {error && <div className="alert error" role="alert">{error}</div>}
            <button className="button orange full" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer à l’administration'}<Send size={16} /></button>
          </form>}
    </Modal>}
  </footer>;
}
export const categories = ['Culture générale', 'Sciences', 'Technologie', 'Histoire', 'Géographie', 'Sport'];
export function CategoryIcon({ category, size = 26 }: { category: string; size?: number }) {
  const Icon = category === 'Sciences' ? Atom : category === 'Géographie' ? Globe2 : category === 'Histoire' ? Landmark :
    category === 'Technologie' ? Code2 : category === 'Sport' ? Trophy : Shapes;
  return <Icon size={size} strokeWidth={1.6} />;
}
export function Avatar({ user, size = '' }: { user: Pick<User, 'pseudo' | 'avatar'>; size?: string }) {
  return <span className={`avatar ${user.avatar} ${size}`}>{user.pseudo.slice(0, 2).toUpperCase()}</span>;
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Sparkles size={30} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('.modal button:not(:disabled), .modal input, .modal select, .modal textarea, .modal a[href]'));
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    document.querySelector<HTMLElement>('.modal button')?.focus();
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = ''; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
    <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Fermer"><X size={21} /></button></header>{children}
    </section>
  </div>;
}
export function QuizCover({ quiz, small = false }: { quiz: Pick<Quiz, 'category' | 'cover'>; small?: boolean }) {
  return <div className={`quiz-cover ${quiz.cover} ${small ? 'small' : ''}`}><span className="cover-circle c1" /><span className="cover-circle c2" />
    <span className="cover-grid" /><div className="cover-symbol"><CategoryIcon category={quiz.category} size={small ? 32 : 65} /></div>
    {!small && <><span className="cover-star star1">✦</span><span className="cover-star star2">✧</span><span className="cover-label">{quiz.category.toUpperCase()}</span></>}
  </div>;
}
export function SessionCard({ session: s, onJoin, user }: { session: Session; onJoin: (s: Session) => void; user: User }) {
  const owner = s.owner_id === user.id && (user.role === 'creator' || user.role === 'admin');
  const closed = Number(s.closes_at) <= Date.now() || s.status === 'ended';
  const upcoming = Number(s.opens_at) > Date.now();
  const completed = s.participation_status === 'finished';
  const canViewResults = completed || closed && Boolean(s.participation_status);
  return <article className="quiz-card">
    <div className="cover-container"><QuizCover quiz={s} /><span className={`mode-label ${s.mode === 'live' ? 'live' : ''}`}>
      {s.mode === 'live' ? <Radio size={13} /> : <Clock3 size={13} />}{s.mode === 'live' ? 'En direct' : 'À votre rythme'}</span></div>
    <div className="quiz-card-body"><span className={`category-label text-${s.cover}`}>{s.category}</span><h3>{s.title}</h3>
      <p>{s.description}</p><div className="quiz-meta"><span><Shapes size={14} />{s.question_count} questions</span><span><Users size={14} />{s.player_count} joueur{s.player_count > 1 ? 's' : ''}</span></div>
      <div className="card-footer"><span><Avatar user={{ pseudo: s.owner, avatar: 'pink' }} size="xs" />{s.owner}</span>
        <button className="card-play" onClick={() => onJoin(s)} disabled={closed && !s.participation_status || upcoming && !owner}
          aria-label={`${canViewResults ? 'Résultats de' : closed ? 'Quiz terminé :' : 'Rejoindre'} ${s.title}`}>
          {canViewResults ? 'Résultats' : closed ? 'Terminé' : upcoming ? 'Bientôt' : owner && s.mode === 'live' ? 'Animer' : s.participation_status ? 'Reprendre' : 'Jouer'}<ArrowUpRight size={16} />
        </button></div>{closed || completed ? <span className="status done">{closed ? 'Quiz terminé' : 'Vous avez terminé ce quiz'}</span> : upcoming && <div className="small-note">Ouverture le {date(s.opens_at)}</div>}
    </div>
  </article>;
}
export function Board({ entries, userId }: { entries: BoardEntry[]; userId: string }) {
  return <div className="board">{entries.map((entry, i) => <div key={entry.id} className={`board-row ${entry.id === userId ? 'you' : ''}`}>
    <span className={`rank rank-${i}`}>{i < 3 ? <Trophy size={17} /> : i + 1}</span><Avatar user={entry} size="sm" />
    <span className="board-name">{entry.pseudo}{entry.id === userId && <small>Vous</small>}{entry.excluded && <small>Exclu — résultats conservés</small>}</span>
    <strong>{number(entry.score)} <small>pts</small></strong>
  </div>)}</div>;
}
export function AnimatedBanner({ hero = false, children }: { hero?: boolean; children?: ReactNode }) {
  const banner = useRef<HTMLElement>(null);
  function replay() {
    for (const animation of banner.current?.getAnimations({ subtree: true }) || []) {
      if (animation instanceof CSSAnimation) {
        animation.cancel();
        animation.play();
      }
    }
  }
  const Heading = hero ? 'h2' : 'h3';
  return <section ref={banner} className={`auth-banner${hero ? ' challenge-hero' : ''}`} aria-label="Bienvenue dans Tufurayi">
    <span className="auth-banner-glow" aria-hidden="true" />
    <span className="auth-banner-particles" aria-hidden="true">{Array.from({ length: 28 }, (_, i) =>
      <span key={i} style={{ left: `${i * 37 % 100}%`, width: `${2 + i % 3}px`, height: `${2 + i % 3}px`, animationDuration: `${6 + i % 5}s`, animationDelay: `${-(i % 12)}s` }} />
    )}</span>
    <div className="auth-banner-content">
      <div className="auth-banner-brand">
        <Logo />
      </div>
      <p className="auth-banner-eyebrow">Le rendez-vous du dépassement de soi</p>
      <Heading className="auth-banner-title">Bienvenue dans<br /><span>Challenge Tufurayi</span></Heading>
      <span className="auth-banner-line" aria-hidden="true" />
      <p className="auth-banner-tagline">Relève le défi, découvre de nouveaux quiz et fais grandir tes connaissances. Chaque partie est une nouvelle occasion d’apprendre et de briller.</p>
      {children}
      <button className="auth-banner-replay" type="button" onClick={replay}>↻ Revoir l’animation</button>
    </div>
  </section>;
}
export function Hero({ onDiscover, onCreate, creator = false }: { onDiscover: () => void; onCreate?: () => void; creator?: boolean }) {
  return <>
    <AnimatedBanner hero>
      <div className="challenge-hero-actions">
        <button className="button orange" onClick={onDiscover}>Explorer les quiz<ArrowUpRight size={17} /></button>
        {creator && onCreate && <button className="button secondary" onClick={onCreate}>Créer un quiz<ArrowUpRight size={17} /></button>}
      </div>
    </AnimatedBanner>
    <PrizeShowcase onPlay={onDiscover} />
  </>;
}
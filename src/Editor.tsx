import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2, Check, Save, Radio, Clock3, ArrowRight, Copy } from 'lucide-react';
import { api, date, message, uploadMedia } from './api';
import { categories, Modal, QuizCover } from './components';
import type { Quiz, QuizDraft, QuestionInput, Statistics } from './types';
import { validateQuiz, type QuizIssue } from './quizValidation';

const blankQuestion = (): QuestionInput => ({ text: '', explanation: '', duration: 20,
  answers: [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }] });
const parseVisibility = (value: string): Quiz['visibility'] =>
  value === 'private' || value === 'invitation' ? value : 'public';
export function Editor({ quizId, duplicate = false, close, saved }: { quizId?: string; duplicate?: boolean; close: () => void; saved: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [cover, setCover] = useState('violet');
  const [visibility, setVisibility] = useState<Quiz['visibility']>('public');
  const [published, setPublished] = useState(true);
  const [questions, setQuestions] = useState<QuestionInput[]>([blankQuestion()]);
  const [drafts, setDrafts] = useState<QuizDraft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  const [sourceQuizId, setSourceQuizId] = useState<string | null>(quizId && !duplicate ? quizId : null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(!!quizId);
  const [busy, setBusy] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<QuizIssue[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const draftIdRef = useRef<string | null>(null);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!issues.length) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [issues]);
  function restoreDraft(draft: QuizDraft) {
    const value = draft.payload;
    setTitle(value.title); setDescription(value.description); setCategory(value.category); setCover(value.cover);
    setVisibility(value.visibility); setPublished(value.published);
    setQuestions(value.questions.map(q => ({ ...q, answers: q.answers.map(a => ({ ...a })) })));
    setSourceQuizId(value.quizId || null); setDraftId(draft.id); draftIdRef.current = draft.id;
    setHasEdited(false); setDraftStatus('Brouillon repris');
  }
  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const savedDrafts = await api<QuizDraft[]>('/drafts');
        if (cancelled) return;
        setDrafts(savedDrafts);
        const matchingDraft = quizId && !duplicate ? savedDrafts.find(draft => draft.payload.quizId === quizId) : undefined;
        if (matchingDraft) {
          restoreDraft(matchingDraft);
          return;
        }
        if (quizId) {
          const q = await api<Quiz>(`/quizzes/${quizId}`);
          if (cancelled) return;
          setTitle(q.title + (duplicate ? ' (copie)' : '')); setDescription(q.description); setCategory(q.category); setCover(q.cover);
          setVisibility(q.visibility); setPublished(Boolean(q.published)); setSourceQuizId(duplicate ? null : q.id);
          setQuestions((q.questions || []).map(q => ({ ...q, answers: q.answers.map(a => ({ ...a, correct: Boolean(a.correct) })) })));
        }
      } catch (e) { if (!cancelled) setError(message(e)); }
      finally { if (!cancelled) { setLoading(false); setDraftReady(true); } }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [quizId, duplicate]);
  useEffect(() => {
    if (!draftReady || !hasEdited) return;
    draftTimer.current = setTimeout(() => {
      const payload = { quizId: sourceQuizId, title, description, category, cover, visibility, published, questions };
      setDraftStatus('Sauvegarde en cours…');
      draftQueue.current = draftQueue.current.then(async () => {
        const currentId = draftIdRef.current;
        const result = await api<{ id: string; updatedAt: number }>(currentId ? `/drafts/${currentId}` : '/drafts',
          currentId ? 'PUT' : 'POST', payload);
        if (!currentId) { draftIdRef.current = result.id; setDraftId(result.id); }
        setDrafts(current => [{ id: result.id, title: payload.title, updated_at: result.updatedAt, payload },
          ...current.filter(draft => draft.id !== result.id)]);
        setDraftStatus('Brouillon enregistré automatiquement'); setError('');
      }).catch(e => { setDraftStatus(''); setError(message(e)); });
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); draftTimer.current = null; };
  }, [draftReady, hasEdited, sourceQuizId, title, description, category, cover, visibility, published, questions]);
  const question = questions[active];
  function update(patch: Partial<QuestionInput>) { setQuestions(current => current.map((q, i) => i === active ? { ...q, ...patch } : q)); }
  async function addMedia(file?: File) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError('Le fichier ne doit pas dépasser 25 Mo.'); return; }
    const questionIndex = active;
    setError(''); setUploadingMedia(true);
    try {
      const media = await uploadMedia(file);
      setQuestions(current => current.map((q, i) => i === questionIndex ? { ...q, mediaUrl: media.url, mediaType: media.type } : q));
    } catch (e) { setError(message(e)); }
    finally { setUploadingMedia(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    const invalid = validateQuiz(title, questions);
    setIssues(invalid);
    if (invalid.length) {
      setActive(invalid[0].question ?? active);
      return;
    }
    setBusy(true);
    try {
      if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
      await draftQueue.current;
      let savedDraftId = draftIdRef.current;
      if (hasEdited) {
        const payload = { quizId: sourceQuizId, title, description, category, cover, visibility, published, questions };
        const result = await api<{ id: string; updatedAt: number }>(savedDraftId ? `/drafts/${savedDraftId}` : '/drafts',
          savedDraftId ? 'PUT' : 'POST', payload);
        savedDraftId = result.id;
        draftIdRef.current = result.id;
      }
      await api(sourceQuizId ? `/quizzes/${sourceQuizId}` : '/quizzes', sourceQuizId ? 'PUT' : 'POST',
        { title, description, category, cover, visibility, published, questions, ...(savedDraftId ? { draftId: savedDraftId } : {}) });
      saved(); close();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const fieldInvalid = (field: string, index?: number) => issues.some(issue => issue.field === field && issue.question === index);
  const resumableDrafts = drafts.filter(draft => quizId && !duplicate
    ? draft.payload.quizId === quizId : !draft.payload.quizId);
  return <Modal title={duplicate ? 'Dupliquer un quiz' : quizId ? 'Modifier le quiz' : 'Créer un quiz'} close={close} wide>
    {loading ? <div className="loading">Chargement du quiz…</div> : <form ref={form} noValidate onSubmit={submit} onChange={() => setHasEdited(true)} onClickCapture={() => setHasEdited(true)} className="form editor-form">
      {!draftId && !hasEdited && resumableDrafts.length > 0 && <section className="panel editor-drafts"><h3>Reprendre un brouillon</h3>
        <p>Vos modifications sont sauvegardées automatiquement et restent accessibles sur votre compte.</p>
        {resumableDrafts.map(draft => <button type="button" className="text-button" key={draft.id} onClick={() => restoreDraft(draft)}>
          <Clock3 size={15} />{draft.title || 'Quiz sans titre'} · {date(draft.updated_at)}
        </button>)}
      </section>}
      {issues.length > 0 && <div className="alert error" role="alert"><div><strong>Le quiz n’a pas été enregistré. Complétez les champs suivants :</strong><ul>{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div></div>}
      <div className="editor-top"><div><label>Titre du quiz<input aria-invalid={fieldInvalid('quiz-title')} required minLength={3} maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="Un titre qui donne envie de jouer" /></label>
        <label>Description<textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Présentez votre défi en quelques mots…" rows={2} /></label></div>
        <QuizCover quiz={{ category, cover }} small /></div>
      <div className="form-grid"><label>Catégorie<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Visibilité<select value={visibility} onChange={e => setVisibility(parseVisibility(e.target.value))}><option value="public">Public</option><option value="private">Invités uniquement</option><option value="invitation">Code ou invitation</option></select></label>
        <label>Couleur<select value={cover} onChange={e => setCover(e.target.value)}>{[['violet', 'Violet'], ['blue', 'Bleu'], ['green', 'Vert'], ['orange', 'Orange'], ['pink', 'Rose'], ['navy', 'Nuit']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
      <div className="editor-question-tabs">{questions.map((_q, i) => <button type="button" key={i} disabled={uploadingMedia} className={active === i ? 'active' : ''} onClick={() => setActive(i)}>Question {i + 1}{issues.some(issue => issue.question === i) ? ' (à compléter)' : ''}</button>)}
        <button type="button" disabled={questions.length >= 50 || uploadingMedia} onClick={() => { setQuestions([...questions, blankQuestion()]); setActive(questions.length); }}><Plus size={16} />Ajouter</button></div>
      {question && <section className="question-editor"><div className="section-header"><h3>Question {active + 1}</h3><button type="button" className="icon-button danger" aria-label="Supprimer la question" disabled={questions.length === 1 || uploadingMedia} onClick={() => { setQuestions(questions.filter((_q, i) => i !== active)); setActive(Math.max(0, active - 1)); }}><Trash2 size={17} /></button></div>
        <label>Votre question<textarea aria-invalid={fieldInvalid('question-text', active)} required minLength={3} maxLength={1000} rows={2} value={question.text} onChange={e => update({ text: e.target.value })} placeholder="Quelle question allez-vous poser ?" /></label>
        <div className="question-media">
          <label>Ajouter une image, une vidéo ou un audio<input type="file" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/aac" disabled={uploadingMedia}
            onChange={e => { void addMedia(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
          <small role="status">{uploadingMedia ? 'Importation du média…' : 'Formats image, vidéo ou audio • 25 Mo maximum'}</small>
          {question.mediaUrl && question.mediaType === 'image' && <img className="question-media-preview" src={question.mediaUrl} alt="Aperçu du média de la question" />}
          {question.mediaUrl && question.mediaType === 'video' && <video className="question-media-preview" src={question.mediaUrl} controls />}
          {question.mediaUrl && question.mediaType === 'audio' && <audio className="question-media-preview" src={question.mediaUrl} controls />}
          {question.mediaUrl && <button type="button" className="text-button" onClick={() => update({ mediaUrl: null, mediaType: null })}>Retirer le média</button>}
        </div>
        <p className="small-note">Cliquez sur la coche pour sélectionner l’unique bonne réponse.</p>
        <div className="answer-editor">{question.answers.map((a, i) => <div key={i} className={a.correct ? 'is-correct' : ''}>
          <button type="button" onClick={() => update({ answers: question.answers.map((a, j) => ({ ...a, correct: i === j })) })} aria-label={`Définir la réponse ${i + 1} comme correcte`} aria-pressed={a.correct}><Check size={18} /></button>
          <input aria-label={`Réponse ${i + 1}`} aria-invalid={fieldInvalid(`answer-${i}`, active)} required maxLength={500} value={a.text} placeholder={`Réponse ${i + 1}`} onChange={e => update({ answers: question.answers.map((a, j) => j === i ? { ...a, text: e.target.value } : a) })} />
          {question.answers.length > 2 && <button type="button" className="icon-button" aria-label={`Supprimer la réponse ${i + 1}`} onClick={() => {
            const answers = question.answers.filter((_a, j) => j !== i);
            if (a.correct) answers[0] = { ...answers[0], correct: true };
            update({ answers });
          }}><Trash2 size={14} /></button>}</div>)}</div>
        {question.answers.length < 6 && <button type="button" className="text-button" onClick={() => update({ answers: [...question.answers, { text: '', correct: false }] })}><Plus size={14} />Ajouter une réponse</button>}
        <div className="form-grid"><label>Temps de réponse (secondes)<input aria-invalid={fieldInvalid('question-duration', active)} type="number" required min={5} max={120} value={question.duration} onChange={e => update({ duration: Number(e.target.value) })} /></label>
          <label>Explication de la réponse<input aria-invalid={fieldInvalid('question-explanation', active)} maxLength={2000} value={question.explanation} onChange={e => update({ explanation: e.target.value })} placeholder="Pour apprendre de ses erreurs" /></label></div>
      </section>}
      <label className="checkbox-label"><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />Publier le quiz (sinon, enregistrer comme brouillon)</label>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="modal-actions"><span className="small-note" role="status">{draftStatus || `${questions.length} question${questions.length > 1 ? 's' : ''} • Une bonne réponse par question`}</span><button className="button orange" disabled={busy || uploadingMedia}><Save size={17} />{busy ? 'Enregistrement…' : 'Enregistrer le quiz'}</button></div>
    </form>}
  </Modal>;
}

const localDate = (ms: number) => {
  const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function Schedule({ quiz, close, saved }: { quiz: Quiz; close: () => void; saved: (id: string) => void }) {
  const [mode, setMode] = useState('live');
  const [opens, setOpens] = useState(localDate(Date.now()));
  const [closes, setCloses] = useState(localDate(Date.now() + 86400000));
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [createdId, setCreatedId] = useState('');
  const [notifications, setNotifications] = useState({ sent: 0, failed: 0 });
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { id, notifications: result } = await api<{ id: string; notifications: { sent: number; failed: number } }>('/sessions', 'POST', { quizId: quiz.id, mode,
        opensAt: new Date(opens).getTime(), closesAt: new Date(closes).getTime(), emails: emails.split(/[\s,;]+/).filter(Boolean) });
      setCreatedId(id); setNotifications(result); saved(id);
      if (!result.failed) close();
      else setError(`La session est créée, mais ${result.failed} invitation(s) n’ont pas pu être envoyées.`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function resend() {
    if (!createdId) return;
    setResending(true); setError('');
    try {
      const result = await api<{ sent: number; failed: number }>(`/sessions/${createdId}/invitations/resend`, 'POST', {});
      setNotifications(current => ({ sent: current.sent + result.sent, failed: result.failed }));
      if (!result.failed) close();
      else setError(`${result.failed} invitation(s) restent à envoyer. Vérifiez la configuration du service email.`);
    } catch (e) { setError(message(e)); }
    finally { setResending(false); }
  }
  return <Modal title="Planifier une session" close={close}><p className="modal-subtitle">{quiz.title}</p>
    <form className="form" onSubmit={submit}><div className="mode-picker">{[
      { value: 'live', icon: Radio, label: 'En direct', text: 'Tous ensemble, au même moment' },
      { value: 'async', icon: Clock3, label: 'À votre rythme', text: 'Chacun joue quand il veut' }
    ].map(item => <button type="button" key={item.value} className={mode === item.value ? 'active' : ''} onClick={() => setMode(item.value)}><item.icon size={23} /><strong>{item.label}</strong><small>{item.text}</small></button>)}</div>
      <label>Ouverture<input type="datetime-local" required value={opens} onChange={e => setOpens(e.target.value)} /></label>
      <label>Fermeture<input type="datetime-local" required value={closes} onChange={e => setCloses(e.target.value)} /></label>
      <label>Inviter des joueurs (adresses électroniques)<textarea rows={3} value={emails} onChange={e => setEmails(e.target.value)} placeholder="alex@exemple.fr, lea@exemple.fr" /><small>Un email d’invitation leur sera envoyé et la session apparaîtra dans leur tableau de bord. L’autorisation explicite d’un administrateur reste obligatoire.</small></label>
      {quiz.visibility === 'invitation' && <div className="alert info"><Copy size={17} />Code du quiz : <strong>{quiz.invitation_code}</strong></div>}
      {createdId && <div className="alert success" role="status">{notifications.sent} invitation(s) envoyée(s).</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {createdId ? notifications.failed > 0 ? <button type="button" className="button orange full" disabled={resending} onClick={() => void resend()}>
        {resending ? 'Nouvel essai…' : 'Renvoyer les invitations en échec'}<ArrowRight size={17} />
      </button> : <button type="button" className="button secondary full" onClick={close}>Fermer</button> :
        <button className="button orange full" disabled={busy}>{busy ? 'Planification…' : 'Créer la session'}<ArrowRight size={17} /></button>}
    </form>
  </Modal>;
}
export function Stats({ quiz, close }: { quiz: Quiz; close: () => void }) {
  const [data, setData] = useState<Statistics | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let cancelled = false; api<Statistics>(`/quizzes/${quiz.id}/stats`).then(d => { if (!cancelled) setData(d); }).catch(e => { if (!cancelled) setError(message(e)); }); return () => { cancelled = true; }; }, [quiz.id]);
  return <Modal title="Statistiques du quiz" close={close} wide><p className="modal-subtitle">{quiz.title}</p>
    {error && <div className="alert error">{error}</div>}{!data && !error && <div className="loading">Chargement…</div>}
    {data && <><h3 className="subheading">Réussite par question</h3><div className="stats-questions">{data.questions.map((q, i) => <div key={q.id}>
      <div><span>{i + 1}. {q.text}</span><strong>{Number(q.responses) ? Math.round(Number(q.correct) / Number(q.responses) * 100) : 0}%</strong></div>
      <div className="progress"><span style={{ width: `${Number(q.responses) ? Number(q.correct) / Number(q.responses) * 100 : 0}%` }} /></div>
      <small>{q.responses} réponses • {(Number(q.average_ms) / 1000).toFixed(1)} s en moyenne</small></div>)}</div>
      <h3 className="subheading">Résultats des joueurs</h3><div className="table-scroll"><table><thead><tr><th>Joueur</th><th>Mode</th><th>Score</th><th>État</th></tr></thead><tbody>{data.players.map((p, i) => <tr key={i}><td>{p.pseudo}</td><td>{p.mode === 'live' ? 'Direct' : 'Différé'}</td><td>{p.score} pts</td><td>{p.status === 'finished' ? 'Terminé' : 'En cours'}</td></tr>)}</tbody></table>{!data.players.length && <p className="small-note">Les statistiques apparaîtront après les premières participations.</p>}</div>
    </>}
  </Modal>;
}
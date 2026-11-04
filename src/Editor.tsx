import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2, Check, Save, Radio, Clock3, ArrowRight, Copy } from 'lucide-react';
import { api, message } from './api';
import { categories, Modal, QuizCover } from './components';
import type { Quiz, QuestionInput, Statistics } from './types';
import { validateQuiz, type QuizIssue } from './quizValidation';

const blankQuestion = (): QuestionInput => ({ text: '', explanation: '', duration: 20,
  answers: [{ text: '', correct: true }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }] });
export function Editor({ quizId, duplicate = false, close, saved }: { quizId?: string; duplicate?: boolean; close: () => void; saved: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [cover, setCover] = useState('violet');
  const [visibility, setVisibility] = useState('public');
  const [published, setPublished] = useState(true);
  const [questions, setQuestions] = useState<QuestionInput[]>([blankQuestion()]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(!!quizId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<QuizIssue[]>([]);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!issues.length) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [issues]);
  useEffect(() => {
    if (!quizId) return;
    let cancelled = false;
    api<Quiz>(`/quizzes/${quizId}`).then(q => {
      if (cancelled) return;
      setTitle(q.title + (duplicate ? ' (copie)' : '')); setDescription(q.description); setCategory(q.category); setCover(q.cover);
      setVisibility(q.visibility); setPublished(Boolean(q.published));
      setQuestions((q.questions || []).map(q => ({ ...q, answers: q.answers.map(a => ({ ...a, correct: Boolean(a.correct) })) })));
    }).catch(e => { if (!cancelled) setError(message(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [quizId, duplicate]);
  const question = questions[active];
  function update(patch: Partial<QuestionInput>) { setQuestions(current => current.map((q, i) => i === active ? { ...q, ...patch } : q)); }
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
      await api(quizId && !duplicate ? `/quizzes/${quizId}` : '/quizzes', quizId && !duplicate ? 'PUT' : 'POST',
        { title, description, category, cover, visibility, published, questions });
      saved(); close();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const fieldInvalid = (field: string, index?: number) => issues.some(issue => issue.field === field && issue.question === index);
  return <Modal title={duplicate ? 'Dupliquer un quiz' : quizId ? 'Modifier le quiz' : 'Créer un quiz'} close={close} wide>
    {loading ? <div className="loading">Chargement du quiz…</div> : <form ref={form} noValidate onSubmit={submit} className="form editor-form">
      {issues.length > 0 && <div className="alert error" role="alert"><div><strong>Le quiz n’a pas été enregistré. Complétez les champs suivants :</strong><ul>{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div></div>}
      <div className="editor-top"><div><label>Titre du quiz<input aria-invalid={fieldInvalid('quiz-title')} required minLength={3} maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="Un titre qui donne envie de jouer" /></label>
        <label>Description<textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Présentez votre défi en quelques mots…" rows={2} /></label></div>
        <QuizCover quiz={{ category, cover }} small /></div>
      <div className="form-grid"><label>Catégorie<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Visibilité<select value={visibility} onChange={e => setVisibility(e.target.value)}><option value="public">Public</option><option value="private">Invités uniquement</option><option value="invitation">Code ou invitation</option></select></label>
        <label>Couleur<select value={cover} onChange={e => setCover(e.target.value)}>{[['violet', 'Violet'], ['blue', 'Bleu'], ['green', 'Vert'], ['orange', 'Orange'], ['pink', 'Rose'], ['navy', 'Nuit']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label></div>
      <div className="editor-question-tabs">{questions.map((_q, i) => <button type="button" key={i} className={active === i ? 'active' : ''} onClick={() => setActive(i)}>Question {i + 1}{issues.some(issue => issue.question === i) ? ' (à compléter)' : ''}</button>)}
        <button type="button" disabled={questions.length >= 50} onClick={() => { setQuestions([...questions, blankQuestion()]); setActive(questions.length); }}><Plus size={16} />Ajouter</button></div>
      {question && <section className="question-editor"><div className="section-header"><h3>Question {active + 1}</h3><button type="button" className="icon-button danger" aria-label="Supprimer la question" disabled={questions.length === 1} onClick={() => { setQuestions(questions.filter((_q, i) => i !== active)); setActive(Math.max(0, active - 1)); }}><Trash2 size={17} /></button></div>
        <label>Votre question<textarea aria-invalid={fieldInvalid('question-text', active)} required minLength={3} maxLength={1000} rows={2} value={question.text} onChange={e => update({ text: e.target.value })} placeholder="Quelle question allez-vous poser ?" /></label>
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
      <div className="modal-actions"><span className="small-note">{questions.length} question{questions.length > 1 ? 's' : ''} • Une bonne réponse par question</span><button className="button orange" disabled={busy}><Save size={17} />{busy ? 'Enregistrement…' : 'Enregistrer le quiz'}</button></div>
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
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { id } = await api<{ id: string }>('/sessions', 'POST', { quizId: quiz.id, mode,
        opensAt: new Date(opens).getTime(), closesAt: new Date(closes).getTime(), emails: emails.split(/[\s,;]+/).filter(Boolean) });
      saved(id); close();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Modal title="Planifier une session" close={close}><p className="modal-subtitle">{quiz.title}</p>
    <form className="form" onSubmit={submit}><div className="mode-picker">{[
      { value: 'live', icon: Radio, label: 'En direct', text: 'Tous ensemble, au même moment' },
      { value: 'async', icon: Clock3, label: 'À votre rythme', text: 'Chacun joue quand il veut' }
    ].map(item => <button type="button" key={item.value} className={mode === item.value ? 'active' : ''} onClick={() => setMode(item.value)}><item.icon size={23} /><strong>{item.label}</strong><small>{item.text}</small></button>)}</div>
      <label>Ouverture<input type="datetime-local" required value={opens} onChange={e => setOpens(e.target.value)} /></label>
      <label>Fermeture<input type="datetime-local" required value={closes} onChange={e => setCloses(e.target.value)} /></label>
      <label>Inviter des joueurs (adresses électroniques)<textarea rows={3} value={emails} onChange={e => setEmails(e.target.value)} placeholder="alex@exemple.fr, lea@exemple.fr" /><small>Les invitations apparaîtront dans leur tableau de bord. Une participation par compte.</small></label>
      {quiz.visibility === 'invitation' && <div className="alert info"><Copy size={17} />Code du quiz : <strong>{quiz.invitation_code}</strong></div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="button orange full" disabled={busy}>{busy ? 'Planification…' : 'Créer la session'}<ArrowRight size={17} /></button>
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
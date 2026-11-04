import { useEffect, useState } from 'react';
import { Copy, Users, UserMinus, Share2, Trash2 } from 'lucide-react';
import { api, message, number, sessionLink, shareTargets } from './api';
import { Avatar, Modal } from './components';
import type { BoardEntry, Session } from './types';

export function ShareButtons({ link, title }: { link: string; title?: string }) {
  const [error, setError] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function nativeShare() {
    setError('');
    try { await navigator.share({ title: 'Invitation Tufurayi', text: `Rejoins-moi sur Tufurayi pour jouer à ${title || 'un quiz'} !`, url: link }); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError('Partage impossible. Copiez le lien et collez-le dans votre application.'); }
  }
  return <div className="share-buttons" role="group" aria-label="Partager l’invitation">
    {shareTargets(link, title ? `« ${title} »` : undefined).map(t =>
      <a key={t.name} className={`share-link share-${t.name.toLowerCase()}`} href={t.url} target="_blank" rel="noopener noreferrer">{t.name}</a>)}
    {canShare && <button type="button" className="share-link" onClick={() => void nativeShare()}><Share2 size={13} />Autres applications</button>}
    {error && <span className="alert error" role="alert">{error}</span>}
  </div>;
}

export function SessionInvitation({ session }: { session: Pick<Session, 'id' | 'visibility' | 'invitation_code'> & { title?: string } }) {
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const code = session.invitation_code;
  const link = sessionLink(session.id, session.visibility === 'invitation' ? code : undefined);
  async function copy(value: string, label: string) {
    setError(''); setCopied('');
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch (e) { setError(`Copie impossible : ${message(e)} Vous pouvez sélectionner le texte ci-dessus.`); }
  }
  return <div className="session-invitation">
    <label>Lien d’invitation<input readOnly value={link} onFocus={e => e.currentTarget.select()} /></label>
    <button className="text-button" onClick={() => void copy(link, 'Lien copié')}><Copy size={14} />Copier le lien</button>
    <ShareButtons link={link} title={session.title} />
    {session.visibility === 'invitation' ? code ? <>
      <label>Code d’invitation<input readOnly value={code} onFocus={e => e.currentTarget.select()} /></label>
      <button className="text-button" onClick={() => void copy(code, 'Code copié')}><Copy size={14} />Copier le code</button>
      <small>Le lien contient déjà le code : un clic suffit pour entrer dans la salle.</small>
    </> : <span role="alert">Code indisponible. Actualisez la liste des sessions.</span> :
      <small>{session.visibility === 'public' ? 'Quiz public : aucun code nécessaire.' : 'Quiz privé : accès réservé aux adresses électroniques invitées, sans code.'}</small>}
    {copied && <span role="status">{copied}</span>}
    {error && <span className="alert error" role="alert">{error}</span>}
  </div>;
}

type ManagedPlayer = BoardEntry & { excluded: boolean; can_exclude: boolean; can_remove?: boolean };

export function SessionPlayers({ id, title, close, changed }: { id: string; title: string; close: () => void; changed: () => void }) {
  const [players, setPlayers] = useState<ManagedPlayer[] | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [target, setTarget] = useState<{ player: ManagedPlayer; action: 'exclude' | 'remove' } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<ManagedPlayer[]>(`/sessions/${id}/players`).then(value => { if (active) setPlayers(value); })
      .catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [id]);
  async function refresh() {
    setBusy(true); setError('');
    try { setPlayers(await api<ManagedPlayer[]>(`/sessions/${id}/players`)); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!target) return;
    const { player, action } = target;
    setBusy(true); setError(''); setSuccess('');
    try {
      await api(`/sessions/${id}/players/${player.id}/${action}`, 'POST', {});
      setSuccess(action === 'remove' ? `${player.pseudo} a été supprimé de cette session. Son score et ses réponses ont été effacés et il ne pourra plus revenir.`
        : `${player.pseudo} a été exclu de cette session. Ses résultats sont conservés.`);
      setTarget(null);
      setPlayers(await api<ManagedPlayer[]>(`/sessions/${id}/players`));
      changed();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <Modal title={`Joueurs — ${title}`} close={close} wide>
    <p>Excluez un joueur de cette session, avant, pendant ou après le quiz. Son retour sera bloqué ; son score, ses réponses et ses résultats seront conservés.</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {success && <div className="alert success" role="status">{success}</div>}
    <button className="text-button" disabled={busy} onClick={() => void refresh()}><Users size={16} />Actualiser les joueurs</button>
    {target && <div className="exclusion-confirm">
      {target.action === 'remove' ? <p>Supprimer définitivement <strong>{target.player.pseudo}</strong> de cette session ? Son score et ses réponses seront effacés, il disparaîtra du classement de ce quiz et ne pourra plus revenir.</p>
        : <p>Exclure <strong>{target.player.pseudo}</strong> de cette session ? Cette exclusion bloque son retour et conserve ses résultats.</p>}
      <div className="report-actions"><button className="button danger-button" disabled={busy} onClick={() => void confirm()}>{target.action === 'remove' ? 'Confirmer la suppression' : 'Confirmer l’exclusion'}</button>
        <button className="button secondary" disabled={busy} onClick={() => setTarget(null)}>Annuler</button></div>
    </div>}
    {!players && !error && <div className="loading">Chargement des joueurs…</div>}
    {players && <div className="table-scroll"><table><thead><tr><th>Joueur</th><th>ID du joueur</th><th>Score / 1 000</th><th>État</th><th>Action</th></tr></thead>
      <tbody>{players.map(player => <tr key={player.id}><td><Avatar user={player} size="xs" /> {player.pseudo}</td><td>{player.id}</td>
        <td>{number(player.score)}</td><td>{player.excluded ? 'Exclu — résultats conservés' : player.status === 'finished' ? 'Terminé' : 'En cours'}</td>
        <td><div className="report-actions">{player.can_exclude && <button className="text-button danger" disabled={busy} onClick={() => { setTarget({ player, action: 'exclude' }); setSuccess(''); }}><UserMinus size={15} />Exclure {player.pseudo}</button>}
          {player.can_remove && <button className="text-button danger" disabled={busy} onClick={() => { setTarget({ player, action: 'remove' }); setSuccess(''); }}><Trash2 size={15} />Supprimer {player.pseudo}</button>}</div></td></tr>)}</tbody></table>
      {!players.length && <p>Aucun joueur n’a encore rejoint cette session.</p>}
    </div>}
  </Modal>;
}

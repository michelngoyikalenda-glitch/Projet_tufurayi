import type { User } from './types';

let accessToken: string | null = null;
let refreshing: Promise<{ token: string; user: User }> | null = null;
export const getToken = () => accessToken;
export function sessionLink(id: string, code?: string) {
  const url = new URL(`/?session=${encodeURIComponent(id)}`, location.origin);
  if (code) url.searchParams.set('code', code);
  return url.toString();
}
export function parseSessionLink(value: string) {
  const input = value.trim();
  if (!/^https?:\/\//i.test(input)) return { id: input, code: '' };
  const url = new URL(input);
  return { id: url.searchParams.get('session') || '', code: url.searchParams.get('code') || '' };
}
export type PendingInvite = { id: string; code: string };
const inviteKey = 'tufurayi:invitation';
// Kept in localStorage so the invitation survives registration, email verification (new tab) and login.
export function readInvite(search = location.search): PendingInvite | null {
  const params = new URLSearchParams(search);
  const id = params.get('session');
  if (id) return { id, code: params.get('code') || '' };
  try {
    const saved = JSON.parse(localStorage.getItem(inviteKey) || 'null');
    if (!saved || typeof saved.id !== 'string' || !(Date.now() - Number(saved.at) < 7 * 86400000)) return null;
    return { id: saved.id, code: typeof saved.code === 'string' ? saved.code : '' };
  } catch { return null; }
}
export function saveInvite(invite: PendingInvite | null) {
  try { invite ? localStorage.setItem(inviteKey, JSON.stringify({ ...invite, at: Date.now() })) : localStorage.removeItem(inviteKey); } catch { /* stockage indisponible */ }
}
export function shareTargets(link: string, title = 'un quiz') {
  const text = `Rejoins-moi sur Tufurayi pour jouer à ${title} ! L’entrée nécessite l’autorisation d’un administrateur. Voici le lien de la salle :`;
  const full = `${text} ${link}`;
  return [
    { name: 'WhatsApp', url: `https://wa.me/?text=${encodeURIComponent(full)}` },
    { name: 'Telegram', url: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}` },
    { name: 'Gmail', url: `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent('Invitation à un quiz Tufurayi')}&body=${encodeURIComponent(full)}` },
    { name: 'Email', url: `mailto:?subject=${encodeURIComponent('Invitation à un quiz Tufurayi')}&body=${encodeURIComponent(full)}` },
    { name: 'SMS', url: `sms:?&body=${encodeURIComponent(full)}` }
  ];
}
export function setToken(value: string | null) {
  accessToken = value;
  window.dispatchEvent(new Event('auth:token'));
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
async function decode<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error || 'Une erreur est survenue.', response.status, body.code);
  return body;
}
export async function restore() {
  if (!refreshing) refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(decode<{ token: string; user: User }>).then(result => { setToken(result.token); return result; })
    .finally(() => { refreshing = null; });
  return refreshing;
}
export async function api<T>(path: string, method = 'GET', body?: unknown, retry = true): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    try { await restore(); }
    catch (error) { setToken(null); window.dispatchEvent(new Event('auth:expired')); throw error; }
    return api<T>(path, method, body, false);
  }
  return decode<T>(response);
}
export const message = (error: unknown) => {
  if (error instanceof ApiError) return error.message;
  console.error(error);
  return 'Une erreur inattendue est survenue. Vérifiez votre connexion et réessayez.';
};
export const date = (value: number | string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(Number(value)));
export const number = (value: number | string) => new Intl.NumberFormat('fr-FR').format(Number(value));
/**
 * Cuenta en la nube (Supabase, plan gratis) con usuario y contraseña, sin correo. Opcional: sin `VITE_SUPABASE_URL` y
 * `VITE_SUPABASE_ANON_KEY` al compilar queda inactiva y el simulador sigue 100 % local
 * (docs/cuentas.md). El cliente se baja bajo demanda para no pesar en la carga inicial.
 * La anon key es pública por diseño; los datos los protege RLS (docs/cuentas.sql).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const KEY_ = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const cloudEnabled = URL_ !== '' && KEY_ !== '';

export interface CloudUser {
  id: string;
  email: string;
  name: string;
}

let client: Promise<SupabaseClient> | null = null;

function getClient(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_, KEY_, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } }),
  );
  return client;
}

/** Datos mínimos que mostramos de la sesión (puro, con pruebas). */
export function toCloudUser(u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): CloudUser | null {
  if (!u) return null;
  const meta = u.user_metadata ?? {};
  const raw = meta.username;
  const email = u.email ?? '';
  return { id: u.id, email, name: typeof raw === 'string' && raw ? raw : email.split('@')[0] || 'LamBot' };
}

/** Usuarios: 3–20 letras minúsculas, números, punto, guion o guion bajo (se guardan en minúsculas). */
export const USERNAME_RE = /^[a-z0-9._-]{3,20}$/;
export const MIN_PASSWORD = 6;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Supabase Auth exige un correo, y aquí las personas no dan ninguno: se inventa uno estable a partir
 * del usuario (nunca se le manda nada; en Supabase hay que desactivar "Confirm email").
 */
export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_DOMAIN}`;
}

export const AUTH_DOMAIN = 'users.labbot-sim.app';

/** Mensaje de error de validación (clave de i18n) o null si el par usuario/contraseña es válido. */
export function validateCredentials(username: string, password: string): 'acct_badUser' | 'acct_badPass' | null {
  if (!USERNAME_RE.test(normalizeUsername(username))) return 'acct_badUser';
  if (password.length < MIN_PASSWORD) return 'acct_badPass';
  return null;
}

export async function currentUser(): Promise<CloudUser | null> {
  if (!cloudEnabled) return null;
  const { data } = await (await getClient()).auth.getSession();
  return toCloudUser(data.session?.user);
}

export async function onUserChange(cb: (u: CloudUser | null) => void): Promise<void> {
  if (!cloudEnabled) return;
  (await getClient()).auth.onAuthStateChange((_e, s) => cb(toCloudUser(s?.user)));
}

/** El mensaje de Supabase indica que el servidor quiere mandar correos (Confirm email activo). */
export function isEmailSetupError(msg: string): boolean {
  return /rate limit|confirm|sending .*email|smtp/i.test(msg);
}

/** Crea la cuenta y entra. Devuelve el mensaje de error, o null si salió bien. */
export async function signUp(username: string, password: string): Promise<string | null> {
  const name = normalizeUsername(username);
  const { data, error } = await (await getClient()).auth.signUp({
    email: usernameToEmail(name),
    password,
    options: { data: { username: name } },
  });
  // "email rate limit exceeded" = Supabase intentó mandar el correo de confirmación (la opción
  // "Confirm email" sigue activa): se trata igual que si no hubiera sesión.
  if (error) return isEmailSetupError(error.message) ? 'confirm-email-on' : error.message;
  // Con "Confirm email" activado no hay sesión: la cuenta no serviría, se avisa al administrador.
  return data.session ? null : 'confirm-email-on';
}

export async function signIn(username: string, password: string): Promise<string | null> {
  const { error } = await (await getClient()).auth.signInWithPassword({ email: usernameToEmail(username), password });
  return error?.message ?? null;
}

export async function signOut(): Promise<void> {
  await (await getClient()).auth.signOut();
}

/** Pantalla de cuenta: iniciar/cerrar sesión (Supabase, `net/cloud.ts`). Opcional. */
import { cloudEnabled, currentUser, signIn, signOut, signUp, validateCredentials, type CloudUser } from '../net/cloud';
import { backBtn, brandbar } from './chrome';
import { t } from './i18n';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class AccountScreen {
  constructor(
    private root: HTMLElement,
    private back: () => void,
  ) {}

  show(): void {
    this.render(null, '', true);
    if (cloudEnabled)
      void currentUser().then((u) => this.render(u, ''));
  }

  private render(user: CloudUser | null, msg: string, loading = false): void {
    let body: string;
    if (!cloudEnabled) body = `<p class="sub">${t('acct_off')}</p>`;
    else if (loading) body = '';
    else if (user)
      body = `<p class="sub"><b>${t('acct_in', { name: esc(user.name) })}</b></p>
        <p class="sub">${t('acct_note')}</p>
        <div class="actionbar"><button class="btn" data-act="out"><span>${t('acct_out')}</span></button></div>`;
    else
      body = `<form class="acct-form" autocomplete="on">
        <label><small>${t('acct_user')}</small><input name="username" autocomplete="username" autocapitalize="none" maxlength="20" data-user></label>
        <label><small>${t('acct_pass')}</small><input type="password" name="password" autocomplete="current-password" data-pass></label>
        <p class="sub">${t('acct_noRecover')}</p>
        <div class="actionbar"><button type="button" class="btn primary" data-act="in"><span>${t('acct_login')}</span></button>
        <button type="button" class="btn" data-act="up"><span>${t('acct_create')}</span></button></div></form>`;
    this.root.className = 'screen solid';
    this.root.innerHTML = `<div class="inner">
      ${brandbar(t('acct_title'))}
      <h1>${t('acct_title')}</h1>
      <p class="sub">${t('acct_sub')}</p>
      ${body}
      <p class="sub" data-msg>${esc(msg)}</p>
      <div class="actionbar">${backBtn('data-act="back"')}</div>
    </div>`;
    this.root.style.display = '';
    this.root.scrollTop = 0;
    const on = (sel: string, fn: () => void) => this.root.querySelector(sel)?.addEventListener('click', fn);
    on('[data-act="back"]', () => this.back());
    on('[data-act="out"]', () => void signOut().then(() => this.render(null, '')));
    const val = (sel: string) => this.root.querySelector<HTMLInputElement>(sel)?.value ?? '';
    const go = (create: boolean) => {
      const [u, p] = [val('[data-user]'), val('[data-pass]')];
      const bad = validateCredentials(u, p);
      if (bad) return this.render(null, t(bad));
      void (create ? signUp(u, p) : signIn(u, p)).then(async (e) => {
        if (e === 'confirm-email-on') return this.render(null, t('acct_confirmOn'));
        if (e) return this.render(null, t('acct_error', { msg: e }));
        this.render(await currentUser(), '');
      });
    };
    on('[data-act="in"]', () => go(false));
    on('[data-act="up"]', () => go(true));
  }
}

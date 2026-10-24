/** Menú principal, ajustes, pausa y resultados (DOM). */
import { AUTO_ROUTINES } from '../auto/AutoRoutine';
import { DEFAULT_SETTINGS, SETTINGS_RANGE, type Settings } from '../config/settings';
import { RULES } from '../core/fouls';
import type { Match } from '../core/match';
import { ALLIANCES, type Alliance } from '../core/types';
import { getLang, setLang, t, type Key } from './i18n';

export interface MenuChoice {
  mode: 'match' | 'practice';
  player: number;
}

const ROBOTS = [0, 1, 2, 3];

export class Menu {
  readonly root: HTMLElement;
  player = 0;

  constructor(
    host: HTMLElement,
    private onStart: (c: MenuChoice) => void,
    private settings: Settings,
    private onSettings: (s: Settings) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    host.appendChild(this.root);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  private open(html: string): void {
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    this.root.style.display = '';
  }

  main(): void {
    const robots = ROBOTS.map((i) => {
      const a: Alliance = i < 2 ? 'red' : 'blue';
      return `<button class="slot ${a} ${i === this.player ? 'sel' : ''}" data-slot="${i}">${t(a)} ${(i % 2) + 1}</button>`;
    }).join('');
    this.open(`
      <h1>${t('title')}</h1>
      <p class="sub">${t('subtitle')}</p>
      <div class="row"><span class="lbl">${t('yourRobot')}</span>${robots}</div>
      <div class="row">
        <button class="primary" data-act="match">${t('match')}</button>
        <button data-act="practice">${t('practice')}</button>
      </div>
      <div class="row"><button data-act="settings">${t('settings')}</button></div>
      <details><summary>${t('controls')}</summary><p class="help">${t('help')}</p><p class="help">${t('helpPad')}</p></details>
      <button class="link" data-act="lang">${t('language')}</button>`);
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        this.player = Number(b.dataset.slot);
        this.main();
      }),
    );
    this.root.querySelector('[data-act="match"]')!.addEventListener('click', () => this.onStart({ mode: 'match', player: this.player }));
    this.root.querySelector('[data-act="practice"]')!.addEventListener('click', () => this.onStart({ mode: 'practice', player: this.player }));
    this.root.querySelector('[data-act="settings"]')!.addEventListener('click', () => this.settingsPanel());
    this.root.querySelector('[data-act="lang"]')!.addEventListener('click', () => {
      setLang(getLang() === 'es' ? 'en' : 'es');
      location.reload();
    });
  }

  /** Ajustes: IA, rutinas de AUTO, tu robot y Human Player. Se guardan al volver. */
  settingsPanel(): void {
    const s = this.settings;
    const autoOpts = (sel: string) => AUTO_ROUTINES.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${t(`auto_${r.id}` as Key)}</option>`).join('');
    const range = (k: keyof typeof SETTINGS_RANGE, unit: string) => {
      const r = SETTINGS_RANGE[k];
      return `<input type="range" data-k="${k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${s[k]}"><output data-unit="${unit}">${s[k]} ${unit}</output>`;
    };
    this.open(`
      <h2>${t('settings')}</h2>
      <div class="form">
        <label><input type="checkbox" data-k="ai" ${s.ai ? 'checked' : ''}> ${t('setAi')}</label>
        <label>${t('setPlayerAuto')} <select data-k="playerAuto">${autoOpts(s.playerAuto)}</select></label>
        <label>${t('setBotAuto')} <select data-k="botAuto">${autoOpts(s.botAuto)}</select></label>
        <label>${t('setSpeed')} ${range('maxSpeed', 'm/s')}</label>
        <label>${t('setCapacity')} ${range('capacity', '')}</label>
        <label><input type="checkbox" data-k="hpEnabled" ${s.hpEnabled ? 'checked' : ''}> ${t('setHp')}</label>
        <label>${t('setHpInterval')} ${range('hpInterval', 's')}</label>
      </div>
      <p class="help">${t('settingsNote')}</p>
      <div class="row">
        <button class="primary" data-act="back">${t('save')}</button>
        <button data-act="defaults">${t('defaults')}</button>
      </div>`);
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((el) => {
      const k = el.dataset.k as keyof Settings;
      el.addEventListener('input', () => {
        const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
        (s as unknown as Record<string, unknown>)[k] = v;
        const out = el.nextElementSibling;
        if (out instanceof HTMLOutputElement) out.textContent = `${v} ${out.dataset.unit ?? ''}`;
      });
    });
    this.root.querySelector('[data-act="back"]')!.addEventListener('click', () => {
      this.onSettings(s);
      this.main();
    });
    this.root.querySelector('[data-act="defaults"]')!.addEventListener('click', () => {
      Object.assign(s, DEFAULT_SETTINGS);
      this.settingsPanel();
    });
  }

  pause(onResume: () => void, onRestart: () => void, onMenu: () => void): void {
    this.open(`
      <h2>${t('paused')}</h2>
      <div class="col">
        <button class="primary" data-act="resume">${t('resume')}</button>
        <button data-act="restart">${t('restart')}</button>
        <button data-act="menu">${t('backToMenu')}</button>
      </div>
      <p class="help">${t('help')}</p>`);
    this.root.querySelector('[data-act="resume"]')!.addEventListener('click', onResume);
    this.root.querySelector('[data-act="restart"]')!.addEventListener('click', onRestart);
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu);
  }

  results(m: Match, onRestart: () => void, onMenu: () => void, onDownload: () => void): void {
    const b = { red: m.breakdown('red'), blue: m.breakdown('blue') };
    const rp = { red: m.rankingPoints('red'), blue: m.rankingPoints('blue') };
    const row = (label: string, f: (a: Alliance) => string | number) => `<tr><th>${label}</th>${ALLIANCES.map((a) => `<td class="${a}">${f(a)}</td>`).join('')}</tr>`;
    const yes = (v: boolean) => (v ? '✓' : '–');
    const winner = b.red.total === b.blue.total ? t('tie') : `${t('winner')}: ${t(b.red.total > b.blue.total ? 'red' : 'blue')}`;
    const fouls = m.fouls.length
      ? m.fouls
          .map((f) => `<li>${Math.max(0, Math.floor(f.time))} s · ${f.kind === 'TECH' ? 'Tech Foul' : 'Foul'} · ${t(f.offender)} ${f.robot + 1}: ${RULES[f.rule].es} (${RULES[f.rule].section})</li>`)
          .join('')
      : `<li>${t('noFouls')}</li>`;
    this.open(`
      <h2>${t('results')} · ${winner}</h2>
      <table class="results">
        <tr><th></th><th class="red">${t('red')}</th><th class="blue">${t('blue')}</th></tr>
        ${row(t('autoLine'), (a) => b[a].autoLine)}
        ${row(t('samplesAuto'), (a) => b[a].samplesAuto)}
        ${row(t('samplesTeleop'), (a) => b[a].samplesTeleop)}
        ${row(t('platform'), (a) => b[a].platform)}
        ${row(t('criticalSample'), (a) => b[a].critical)}
        ${row(t('penalties'), (a) => b[a].penalties)}
        ${ALLIANCES.some((a) => b[a].redCard) ? row(t('redCard'), (a) => yes(b[a].redCard)) : ''}
        ${row(`<b>${t('total')}</b>`, (a) => `<b>${b[a].total}</b>`)}
        <tr><th colspan="3" class="sep">${t('rp')}</th></tr>
        ${row(t('rpWin'), (a) => rp[a].win)}
        ${row(t('rpAuto'), (a) => yes(rp[a].autoLine))}
        ${row(t('rpCritical'), (a) => yes(rp[a].critical))}
        ${row(t('rpDominance'), (a) => `${yes(rp[a].dominance)} (${m.samplesIn(a)})`)}
        ${row(`<b>${t('rp')}</b>`, (a) => `<b>${rp[a].total}</b>`)}
      </table>
      <h3>${t('fouls')}</h3><ul class="fouls">${fouls}</ul>
      <div class="row">
        <button class="primary" data-act="restart">${t('restart')}</button>
        <button data-act="menu">${t('backToMenu')}</button>
        <button data-act="log">${t('downloadLog')}</button>
      </div>`);
    this.root.querySelector('[data-act="restart"]')!.addEventListener('click', onRestart);
    this.root.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu);
    this.root.querySelector('[data-act="log"]')!.addEventListener('click', onDownload);
  }
}

/**
 * AgentReady — inspector UI.
 * A small shadow-DOM panel: tool count badge, live agent activity feed,
 * target highlighting, and the human confirmation dialog used by the
 * safety gate. No dependencies, no framework.
 */

import type { Activity, ConfirmRequest } from './env.js';

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: #101828; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgba(16,24,40,.25); border: 1px solid #344054; user-select: none; }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #12b76a; }
  .badge .dot.busy { background: #f79009; animation: pulse 1s infinite; }
  @keyframes pulse { 50% { opacity: .4; } }
  .panel { width: 300px; max-height: 320px; overflow: auto; background: #fff; color: #101828; border-radius: 12px; box-shadow: 0 12px 40px rgba(16,24,40,.24); border: 1px solid #eaecf0; font-size: 12px; display: none; }
  .panel.open { display: block; }
  .panel header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #eaecf0; font-weight: 700; }
  .panel header span { font-weight: 400; color: #475467; }
  .feed { padding: 6px 12px 10px; display: flex; flex-direction: column; gap: 6px; }
  .item { display: flex; gap: 8px; align-items: baseline; }
  .item .icon { width: 14px; flex: none; text-align: center; }
  .item .name { font-weight: 600; }
  .item .args { color: #475467; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
  .item.err .name { color: #d92d20; }
  .empty { color: #98a2b3; padding: 8px 0; }
  .confirm { width: 320px; background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(16,24,40,.35); border: 1px solid #eaecf0; padding: 14px; display: none; }
  .confirm.open { display: block; }
  .confirm h4 { margin: 0 0 4px; font-size: 14px; }
  .confirm p { margin: 0 0 10px; font-size: 12px; color: #475467; }
  .confirm .row { display: flex; gap: 8px; justify-content: flex-end; }
  button.btn { padding: 6px 14px; border-radius: 8px; border: 1px solid #d0d5dd; background: #fff; font-weight: 600; font-size: 12px; cursor: pointer; }
  button.btn.primary { background: #12b76a; border-color: #12b76a; color: #fff; }
  .highlight { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px solid #7f56d9; border-radius: 6px; box-shadow: 0 0 0 4px rgba(127,86,217,.25); transition: all .2s ease; display: none; }
`;

interface HighlightOptions {
  sticky?: boolean;
}

export class Inspector {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly badge: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly confirmBox: HTMLElement;
  private readonly highlightBox: HTMLElement;
  private _hlTimer: ReturnType<typeof setTimeout> | undefined;

  constructor({ siteLabel }: { siteLabel?: string } = {}) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-agentready-ui', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.shadow.appendChild(style);
    this.shadow.innerHTML += `
      <div class="root">
        <div class="highlight"></div>
        <div class="confirm" role="alertdialog" aria-modal="false">
          <h4></h4><p></p>
          <div class="row">
            <button class="btn cancel">Decline</button>
            <button class="btn primary">Approve</button>
          </div>
        </div>
        <div class="panel">
          <header>AgentReady <span class="count"></span></header>
          <div class="feed"><div class="empty">Waiting for agent activity…</div></div>
        </div>
        <div class="badge" role="button" tabindex="0">
          <span class="dot"></span><span class="label">AgentReady</span><span class="badge-count"></span>
        </div>
      </div>`;
    document.documentElement.appendChild(this.host);
    this.badge = this.shadow.querySelector('.badge') as HTMLElement;
    this.dot = this.shadow.querySelector('.dot') as HTMLElement;
    this.panel = this.shadow.querySelector('.panel') as HTMLElement;
    this.feed = this.shadow.querySelector('.feed') as HTMLElement;
    this.countEl = this.shadow.querySelector('.badge-count') as HTMLElement;
    this.confirmBox = this.shadow.querySelector('.confirm') as HTMLElement;
    this.highlightBox = this.shadow.querySelector('.highlight') as HTMLElement;
    this.badge.addEventListener('click', () => this.panel.classList.toggle('open'));
    this.setLabel(siteLabel ?? 'AgentReady');
  }

  setLabel(siteLabel: string): void {
    (this.shadow.querySelector('.label') as HTMLElement).textContent = siteLabel;
  }

  setToolCount(n: number): void {
    this.countEl.textContent = `${n} tool${n === 1 ? '' : 's'}`;
    this.badge.title = `${n} WebMCP tools available to agents`;
  }

  setBusy(busy: boolean): void {
    this.dot.classList.toggle('busy', busy);
  }

  logActivity(a: Activity): void {
    this.feed.querySelector('.empty')?.remove();
    const icons: Record<Activity['phase'], string> = { start: '→', done: '✓', error: '✗', submitted: '⏎' };
    const item = document.createElement('div');
    item.className = 'item' + (a.phase === 'error' ? ' err' : '');
    const argStr = summarizeArgs(a.args);
    item.innerHTML = '<span class="icon"></span><span><span class="name"></span> <span class="args"></span></span>';
    (item.querySelector('.icon') as HTMLElement).textContent = icons[a.phase] ?? '·';
    (item.querySelector('.name') as HTMLElement).textContent = a.tool;
    (item.querySelector('.args') as HTMLElement).textContent =
      a.phase === 'error' ? `${argStr} — ${a.error ?? ''}` : `${argStr}${a.ms != null ? ` (${a.ms}ms)` : ''}`;
    this.feed.prepend(item);
    while (this.feed.children.length > 12) this.feed.lastChild?.remove();
  }

  /** Flash the on-page outline over an element. */
  highlight(el: Element | null, { sticky = false }: HighlightOptions = {}): void {
    if (!el?.getBoundingClientRect) return;
    const move = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      Object.assign(this.highlightBox.style, {
        display: 'block',
        left: `${r.left - 4}px`,
        top: `${r.top - 4}px`,
        width: `${r.width + 8}px`,
        height: `${r.height + 8}px`,
      });
    };
    move();
    if (!sticky) {
      clearTimeout(this._hlTimer);
      this._hlTimer = setTimeout(() => {
        this.highlightBox.style.display = 'none';
      }, 1600);
    }
  }

  /** Human-in-the-loop gate. "allow" passes without a dialog. */
  confirmGate({ title, detail, level = 'confirm', el, timeoutMs = 30000 }: ConfirmRequest & { timeoutMs?: number }): Promise<boolean> {
    if (level === 'allow') return Promise.resolve(true);
    return new Promise((resolve) => {
      this.setBusy(true);
      (el as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      (this.confirmBox.querySelector('h4') as HTMLElement).textContent = title;
      (this.confirmBox.querySelector('p') as HTMLElement).textContent = detail ?? '';
      this.confirmBox.style.display = 'block';
      const btnYes = this.confirmBox.querySelector('.primary') as HTMLButtonElement;
      const btnNo = this.confirmBox.querySelector('.cancel') as HTMLButtonElement;
      const done = (ok: boolean): void => {
        this.confirmBox.style.display = 'none';
        this.setBusy(false);
        clearTimeout(timer);
        btnYes.removeEventListener('click', yes);
        btnNo.removeEventListener('click', no);
        resolve(ok);
      };
      const yes = (): void => done(true);
      const no = (): void => done(false);
      btnYes.addEventListener('click', yes);
      btnNo.addEventListener('click', no);
      const timer = setTimeout(() => done(false), timeoutMs);
    });
  }

  destroy(): void {
    this.host.remove();
  }
}

function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)?.slice(0, 40)}`)
    .join(', ');
}
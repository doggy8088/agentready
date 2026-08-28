/**
 * AgentReady — low-level control value setting with proper event dispatch.
 * Shared by set_field, fill_form, and synthesized form tools.
 */

import type { FormControl } from '../policy.js';

export function setControlValue(el: FormControl, value: string | number | boolean): boolean {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (tag === 'input' && type === 'checkbox') {
    (el as HTMLInputElement).checked = /true|yes|on|1/i.test(String(value));
  } else if (tag === 'input' && type === 'radio') {
    const input = el as HTMLInputElement;
    if (input.value === String(value) || radioLabel(input) === String(value)) input.checked = true;
    else return false;
  } else if (tag === 'select') {
    const select = el as HTMLSelectElement;
    const norm = String(value).trim().toLowerCase();
    const opt = Array.from(select.options).find(
      (o) => o.value === String(value) || o.textContent.trim().toLowerCase() === norm
    );
    if (!opt) return false;
    select.value = opt.value;
  } else if (tag === 'input' && type === 'range') {
    (el as HTMLInputElement).value = String(Number(value));
  } else {
    (el as HTMLInputElement | HTMLTextAreaElement).value = String(value);
  }
  const Ev = el.ownerDocument.defaultView?.Event ?? Event;
  el.dispatchEvent(new Ev('input', { bubbles: true }));
  el.dispatchEvent(new Ev('change', { bubbles: true }));
  return true;
}

function radioLabel(el: HTMLInputElement): string {
  return el.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
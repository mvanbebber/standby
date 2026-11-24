// Dialogs ("sheets") and toasts.
import { esc } from './store.js';

const $ = s => document.querySelector(s);
let current = null;

export function openSheet(html, { onClose, wide } = {}) {
  if (current) current.close(true);
  const wrap = $('#sheetWrap'), el = $('#sheet');
  el.innerHTML = html;
  el.style.width = wide ? 'min(680px, 100%)' : '';
  wrap.hidden = false;
  const s = {
    el,
    close(replaced) {
      if (current !== s) return;
      current = null;
      if (!replaced) { wrap.hidden = true; el.innerHTML = ''; }
      onClose?.();
    },
  };
  current = s;
  return s;
}
export const sheetOpen = () => !!current;
export function closeSheet() { current?.close(); }

$('#sheetWrap').addEventListener('pointerdown', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) { e.stopImmediatePropagation(); closeSheet(); } }, true);

export function ask(title, value = '', placeholder = '', ok = 'Save') {
  return new Promise(res => {
    let result = null;
    const s = openSheet(`<h2>${esc(title)}</h2>
      <form><label class="fld"><input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" enterkeyhint="done"></label>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn accent">${esc(ok)}</button></div></form>`,
      { onClose: () => res(result) });
    const inp = s.el.querySelector('input');
    s.el.querySelector('[data-x]').onclick = () => s.close();
    s.el.querySelector('form').onsubmit = e => { e.preventDefault(); result = inp.value.trim() || null; s.close(); };
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

export function confirmDlg(title, msg, ok = 'OK', danger = false) {
  return new Promise(res => {
    let result = false;
    const s = openSheet(`<h2>${esc(title)}</h2>${msg ? `<p>${esc(msg)}</p>` : ''}
      <div class="sheet-actions"><button class="btn ghost" data-x>Cancel</button><button class="btn ${danger ? 'danger' : 'accent'}" data-ok>${esc(ok)}</button></div>`,
      { onClose: () => res(result) });
    s.el.querySelector('[data-x]').onclick = () => s.close();
    s.el.querySelector('[data-ok]').onclick = () => { result = true; s.close(); };
  });
}

// options: [{label, value, sub, danger, picked}]
export function choose(title, options, extraHtml = '') {
  return new Promise(res => {
    let result = null;
    const s = openSheet(`<h2>${esc(title)}</h2>${extraHtml}<div class="choices">${options.map((o, i) =>
      `<button class="choice${o.danger ? ' danger' : ''}${o.picked ? ' picked' : ''}" data-i="${i}">${o.icon ? `<svg><use href="#${o.icon}"/></svg>` : ''}<span>${esc(o.label)}</span>${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}</button>`).join('')}</div>
      <div class="sheet-actions"><button class="btn ghost" data-x>Cancel</button></div>`, { onClose: () => res(result) });
    s.el.querySelector('[data-x]').onclick = () => s.close();
    s.el.querySelector('.choices').onclick = e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      result = options[+b.dataset.i].value; s.close();
    };
  });
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// 右上の「共有」：公開しているページ（GitHub Pages）の QR コードを大きく出す。スマホのカメラで読むと同じ地図が開く。
// 下に URL と「URLをコピー」（スマホでは、ほかのアプリで送るボタンも）。窓の外を押すか、Esc・×で閉じる。
// QR は tools/build_qr.py で作った assets/qr_pages.svg（URL が変わったら作り直す）
import { h, svg, reducedMotion } from '../util.js';

export const PAGES_URL = 'https://uniunigoduni.github.io/kitakyushu-kanko-mvp/';
const SHARE = 'M12 15V4M8 8l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7';
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const DONE_MS = 1800; // 「コピーしました」を出しておく時間

function icon(d) {
  const s = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
  s.append(svg('path', { d }));
  return s;
}

export function createShare(app, world) {
  const appRoot = document.getElementById('app');
  const btn = h('button', { class: 'hdr-btn share-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': '共有（QRコードを出す）', onclick: () => open() },
    icon(SHARE), h('span', { class: 'hdr-btn-text', text: '共有' }));
  document.querySelector('#title .title-actions').append(btn);
  let view = null;

  function open() {
    if (view) return;
    const opener = document.activeElement;
    const rm = reducedMotion();
    const t = h('h2', { class: 'acct-title', id: 'share-title', tabindex: -1, text: 'この地図を共有' });
    const copy = h('button', { class: 'btn-primary share-copy', type: 'button', onclick: () => copyUrl() }, h('span', { text: 'URLをコピー' }));
    // スマホなど、ほかのアプリへ送れる端末だけ
    const send = navigator.share && h('button', { class: 'acct-text-btn', type: 'button', onclick: () => navigator.share({ title: document.title, url: PAGES_URL }).catch(() => {}), text: 'ほかのアプリで送る' });
    const card = h('section', { class: 'acct-card share-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'share-title', 'aria-describedby': 'share-lead' },
      h('div', { class: 'acct-head' }, t, h('button', { class: 'acct-close', type: 'button', 'aria-label': '閉じる', onclick: () => close() }, '×')),
      h('p', { class: 'share-lead', id: 'share-lead', text: 'スマホのカメラで読み取ると、この地図が開きます' }),
      h('div', { class: 'share-qr' }, h('img', { src: 'assets/qr_pages.svg', width: 41, height: 41, alt: `QRコード（${PAGES_URL}）`, decoding: 'async' })),
      h('p', { class: 'share-url' }, h('a', { href: PAGES_URL, target: '_blank', rel: 'noopener', text: PAGES_URL.replace(/^https:\/\//, '').replace(/\/$/, '') })),
      copy, send);
    const el = h('div', { class: 'acct share' }, h('div', { class: 'acct-main' }, card));
    document.body.append(el);

    let closed = false, timer = 0;
    const entry = { close };
    app.overlays.push(entry);
    appRoot.inert = true;
    world.pause(true);
    // 窓の外の暗いところで押して離したら閉じる（窓の中で押して外で離したときは閉じない）
    let downOutside = false;
    el.addEventListener('pointerdown', (e) => { downOutside = !card.contains(e.target); });
    el.addEventListener('click', (e) => { if (downOutside && !card.contains(e.target)) close(); downOutside = false; });
    t.focus({ preventScroll: true });

    // コピーできたことは、ボタンの文字で知らせる（知らせの帯は窓の下に隠れるので使わない）
    function copyUrl() {
      const done = (ok) => {
        clearTimeout(timer);
        copy.classList.toggle('is-done', ok);
        copy.replaceChildren(...(ok ? [icon(CHECK), h('span', { text: 'コピーしました' })] : [h('span', { text: 'コピーできませんでした。URLを長押ししてコピーしてください' })]));
        timer = setTimeout(() => { copy.classList.remove('is-done'); copy.replaceChildren(h('span', { text: 'URLをコピー' })); }, ok ? DONE_MS : DONE_MS * 2);
      };
      if (!navigator.clipboard?.writeText) { done(false); return; }
      navigator.clipboard.writeText(PAGES_URL).then(() => done(true), () => done(false));
    }

    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      const i = app.overlays.indexOf(entry);
      if (i >= 0) app.overlays.splice(i, 1);
      appRoot.inert = false;
      world.pause(false);
      (opener?.isConnected ? opener : btn).focus({ preventScroll: true });
      const end = () => { el.remove(); view = null; };
      if (rm) end();
      else el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease', fill: 'forwards' }).finished.then(end, end);
    }
    view = { close };
  }

  return { open, get isOpen() { return !!view; } };
}

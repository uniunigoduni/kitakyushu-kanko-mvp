// 史跡の吹き出し。ピンを隠さない側に出し（ピンが画面の下の方なら上）、しっぽはピンを指したまま地図に付いていく。
// 別のピンを選ぶと、前の吹き出しは消して新しい中身に入れ替える。
import { clamp, h, isPaid, paidUntil } from '../util.js';
import { HEAD, STEM } from './pins.js';

const M = 8;     // 地図の窓の縁からの余白
const GAP = 14;  // ピンと吹き出しの間（しっぽの分）
const TAIL = 22; // しっぽを角から離す距離
const MIN_H = 160;

export function createPopup(app, world, pins) {
  const map = world.renderer.domElement.parentElement;
  const tail = h('i', { class: 'popup-tail' });
  const close = h('button', { class: 'popup-close', type: 'button', 'aria-label': '閉じる', text: '×', onclick: () => app.deselect() });
  const scroll = h('div', { class: 'popup-scroll thin-scroll' });
  const foot = h('div', { class: 'popup-foot' });
  const el = h('div', { class: 'popup', role: 'dialog', 'aria-labelledby': 'popup-name', hidden: true }, tail, close, scroll, foot);
  map.append(el);

  let cur = null, hideTimer = 0, paidTimer = 0;
  let side = '', w = 0, natH = 0, shrink = 0, cramped = false;
  const P = {};
  const last = { x: NaN, y: NaN, W: 0, H: 0 };
  const box = [0, 0, 0, 0]; // 置いた四角 [x0, y0, x1, y1]（地図の窓の中の px）

  function fill(s) {
    el.classList.toggle('no-ar', !s.pano);
    const ar = s.pano && h('button', { class: 'popup-ar', type: 'button', onclick: (e) => app.openAR(s, e.currentTarget.querySelector('img')) },
      h('img', { src: `assets/pano/${s.pano}_thumb.jpg`, alt: '', decoding: 'async' }),
      h('span', { text: 'ARで探検' }));
    const text = h('div', { class: 'popup-text' },
      h('p', { class: 'popup-year', text: s.yearLabel }),
      h('h2', { class: 'popup-name', id: 'popup-name', text: s.name }),
      s.summary ? h('p', { class: 'popup-summary', text: s.summary }) : null,
      s.body?.length > 0 ? h('div', { class: 'popup-body' }, s.body.map((t) => h('p', { text: t }))) : null,
      s.disputed ? h('p', { class: 'popup-note', text: s.disputed }) : null,
      s.sources?.length > 0 ? h('ul', { class: 'popup-sources' }, s.sources.map((r) =>
        h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener', text: r.title }) : r.title))) : null);
    scroll.replaceChildren(...[ar, text].filter(Boolean));
    scroll.scrollTop = 0;
    fillFoot(s);
  }
  function fillFoot(s) {
    clearTimeout(paidTimer);
    if (s.level < 2) { foot.hidden = true; foot.replaceChildren(); return; }
    const paid = isPaid(s.id);
    const focused = foot.contains(document.activeElement);
    const btn = h('button', { class: 'btn-primary' + (paid ? ' is-paid' : ''), type: 'button', onclick: () => app.openPay(s), text: paid ? '決済完了済み　電話番号を表示' : 'ガイドとつながる' });
    foot.hidden = false;
    if (paid) foot.replaceChildren(btn);
    else foot.replaceChildren(btn, h('p', { class: 'popup-guide-note', text: '地元の方が電話で案内します（1時間 1,000円）' }));
    if (focused) btn.focus({ preventScroll: true });
    // 決済から1時間たったら、ボタンを「ガイドとつながる」に戻す
    if (paid) paidTimer = setTimeout(() => { if (cur === s) { fillFoot(s); measure(); place(); } }, paidUntil(s.id) - Date.now() + 50);
  }

  // 縮めない大きさを測っておく（中身・窓の大きさが変わったときだけ）
  function measure() {
    if (el.hidden) return;
    el.style.maxHeight = '';
    shrink = 0;
    w = el.offsetWidth;
    natH = el.offsetHeight;
    last.x = NaN;
  }

  function place() {
    if (!cur || el.hidden) return;
    const p = pins.pins.get(cur.id);
    world.project(p.obj.position, P);
    const { W, H } = world.size;
    if (P.x === last.x && P.y === last.y && W === last.W && H === last.H) return;
    Object.assign(last, { x: P.x, y: P.y, W, H });
    const r = HEAD[cur.level] / 2;
    const hx = P.x, hy = P.y - STEM[cur.level];
    const away = !P.visible || hx < 0 || hx > W || hy < 0 || P.y > H;
    el.classList.toggle('is-away', away);
    if (away) return;

    const top = hy - r, bottom = Math.max(hy + r, P.y + 4);
    const room = { above: top - GAP - M, below: H - M - bottom - GAP, right: W - M - (hx + r + GAP), left: hx - r - GAP - M };
    const vertical = (sd) => sd === 'above' || sd === 'below';
    const fits = (sd) => (vertical(sd) ? room[sd] >= natH && W - 2 * M >= w : room[sd] >= w && H - 2 * M >= natH);
    const order = hy > H / 2 ? ['above', 'below', 'right', 'left'] : ['below', 'above', 'right', 'left'];
    let sd = fits(side) ? side : order.find(fits);
    let maxH = 0;
    cramped = !sd;
    if (!sd) {
      // どこにも収まらないときは、上下の広い方へ縮めて出す（中は流して読む）
      sd = room.above > room.below ? 'above' : 'below';
      maxH = Math.max(MIN_H, Math.floor(room[sd] / 8) * 8);
    }
    if (maxH !== shrink) { shrink = maxH; el.style.maxHeight = maxH ? `${maxH}px` : ''; }
    const ph = maxH ? Math.min(natH, maxH) : natH;
    if (sd !== side) { side = sd; el.dataset.side = sd; }

    let x, y;
    if (vertical(sd)) {
      x = clamp(hx - w / 2, M, W - M - w);
      y = sd === 'above' ? top - GAP - ph : bottom + GAP;
      tail.style.left = `${Math.round(clamp(hx - x, TAIL, w - TAIL) - 7)}px`;
      tail.style.top = '';
    } else {
      x = sd === 'right' ? hx + r + GAP : hx - r - GAP - w;
      y = clamp(hy - ph / 2, M, H - M - ph);
      tail.style.top = `${Math.round(clamp(hy - y, TAIL, ph - TAIL) - 7)}px`;
      tail.style.left = '';
    }
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    box[0] = x; box[1] = y; box[2] = x + w; box[3] = y + ph;
  }

  function open(s) {
    clearTimeout(hideTimer);
    cur = s;
    fill(s);
    el.hidden = false;
    el.classList.remove('is-open', 'is-away');
    side = '';
    measure();
    place();
    void el.offsetWidth;
    el.classList.add('is-open');
  }
  function hide() {
    if (!cur) return;
    cur = null;
    clearTimeout(paidTimer);
    el.classList.remove('is-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.hidden = true; scroll.replaceChildren(); }, 160);
  }

  app.on('select', open);
  app.on('deselect', hide);
  // 時代を動かして、その史跡がない時代に入ったら閉じる
  app.on('era', (era) => { if (cur && !cur.eras.includes(era.id)) app.deselect(); });
  app.on('paid', (s) => { if (cur === s) { fillFoot(s); measure(); place(); } });
  world.onFrame(place);
  new ResizeObserver(() => { measure(); place(); }).observe(map);
  document.fonts?.ready.then(() => { measure(); place(); });

  return {
    get site() { return cur; },
    // 今の視点では、縮めずに出せる場所がない
    get cramped() { return cramped; },
    // 出ている吹き出しの四角（出ていない・ピンが画面の外のときは null）
    get rect() { return cur && !el.classList.contains('is-away') ? box : null; },
  };
}

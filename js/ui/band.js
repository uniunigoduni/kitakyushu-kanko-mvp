// 下の史跡帯：左が縄文、右が現代。スライダーに合わせて横に流れ、いまの時代の史跡を真ん中に寄せる。
import { ERAS, yearToT } from '../eras.js';
import { h } from '../util.js';

// 「1914年（大正3年）2月」→「1914年」のように、括弧の中を落とした短い年
export const shortYear = (label) => label.replace(/（[^）]*）/g, '').replace(/\s+/g, '');

export function createBand(app, sites) {
  const scroller = document.querySelector('#band .band-scroll');
  const list = scroller.querySelector('.band-list');
  const cards = new Map();
  const eraEls = new Map();
  const anchors = []; // スライダーの位置 t と、帯の上の x の対応（t の小さい順）

  const byEra = new Map(ERAS.map((e) => [e.id, []]));
  for (const s of sites) byEra.get(s.eras[0])?.push(s);

  for (const e of ERAS) {
    const group = byEra.get(e.id).sort((a, b) => a.year - b.year);
    const div = h('li', { class: 'band-era', 'aria-hidden': 'true', text: e.name });
    list.append(div);
    eraEls.set(e.id, div);
    anchors.push({ t: e.t0, el: div, at: 'left' });
    // 時代の中の並びは年の順。帯の位置が時代の外へはみ出さないように、時代の幅の内側へ寄せる
    const pad = (e.t1 - e.t0) * 0.12;
    let prevT = e.t0;
    for (const s of group) {
      const btn = h('button', { class: 'band-card', type: 'button', dataset: { id: s.id }, onclick: () => app.selectSite(s.id) },
        h('span', { class: 'bc-text' },
          h('span', { class: 'bc-year', text: shortYear(s.yearLabel ?? '') }),
          h('span', { class: 'bc-name', text: s.name }),
          s.level >= 2 && h('span', { class: 'bc-meta', text: 'ガイドあり' })),
        s.pano && h('img', { class: 'bc-thumb', src: `assets/pano/${s.pano}_thumb.jpg`, alt: '', loading: 'lazy', decoding: 'async' }));
      const li = h('li', {}, btn);
      list.append(li);
      cards.set(s.id, { s, btn, era: e });
      const t = Math.max(prevT + 1e-4, Math.min(Math.max(yearToT(s.year), e.t0 + pad), e.t1 - pad));
      prevT = t;
      anchors.push({ t, el: li, at: 'center' });
    }
  }
  if (!sites.length) list.append(h('li', { class: 'band-empty', text: '史跡のデータを読み込めませんでした' }));
  anchors.push({ t: 1, el: list.lastElementChild, at: 'right' });

  // t の位置に対応する帯の x（折れ線でつなぐ）
  let xs = [];
  function measure() {
    xs = anchors.map((a) => {
      const el = a.el;
      return a.at === 'left' ? el.offsetLeft : a.at === 'right' ? el.offsetLeft + el.offsetWidth : el.offsetLeft + el.offsetWidth / 2;
    });
  }
  function xAt(t) {
    for (let i = 1; i < anchors.length; i++) {
      if (t <= anchors[i].t) {
        const a = anchors[i - 1], b = anchors[i];
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        return xs[i - 1] + (xs[i] - xs[i - 1]) * Math.min(1, Math.max(0, k));
      }
    }
    return xs[xs.length - 1];
  }
  function follow() {
    if (!xs.length) return;
    scroller.scrollLeft = xAt(app.t) - scroller.clientWidth / 2;
  }

  // 縦のホイールでも横に流す
  scroller.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    scroller.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  }, { passive: false });

  app.on('t', follow);
  app.on('era', (era, prev) => {
    if (prev) eraEls.get(prev.id)?.classList.remove('is-now');
    eraEls.get(era.id)?.classList.add('is-now');
    for (const c of cards.values()) c.btn.classList.toggle('is-now', c.s.eras.includes(era.id));
  });
  app.on('select', (s) => { for (const c of cards.values()) c.btn.classList.toggle('is-selected', c.s === s); });
  app.on('deselect', () => { for (const c of cards.values()) c.btn.classList.remove('is-selected'); });

  const ro = new ResizeObserver(() => { measure(); follow(); });
  ro.observe(scroller);
  ro.observe(list);
  measure();
  return { follow };
}

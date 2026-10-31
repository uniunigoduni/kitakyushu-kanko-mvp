// 左の年表：縦のスライダー（上が現代・下が縄文）、時代名、主なできごと（引き出し線つき）。
// 主なできごとに乗ると、スライダーの右に「門司のくわしい年表」の小窓を出す。
import { ERAS, ERA_BY_ID, eraAtYear, yearToT, tToYear, formatYear } from '../eras.js';
import { clamp, h, svg } from '../util.js';

const OPEN_DELAY = 500;  // はじめて乗ったときの待ち
const CLOSE_DELAY = 300; // 離れてから閉じるまで
const AIM_DELAY = 200;   // 小窓へ斜めに向かっている間は、行の切り替えを待つ
const EVENT_GAP = 20;    // 主なできごとの行どうしの最小間隔
const ERA_GAP = 15;      // 時代名どうしの最小間隔

export function createTimeline(app, { major = [], detail = [] }) {
  const nav = document.getElementById('timeline');
  const slider = nav.querySelector('.tl-slider');
  const span = nav.querySelector('.tl-span');
  const ticks = nav.querySelector('.tl-ticks');
  const eraList = nav.querySelector('.tl-eras');
  const knob = nav.querySelector('.tl-knob');
  const majorList = nav.querySelector('.tl-major');
  const leaders = nav.querySelector('.tl-leaders');
  const box = document.getElementById('detail');
  const scroll = box.querySelector('.detail-scroll');
  const narrow = matchMedia('(max-width: 760px)');

  // ---------- 寸法（CSS の変数から読む） ----------
  let padTop = 18, padBottom = 28, axisX = 214, height = 600, trackH = 500;
  const yOf = (t) => padTop + (1 - t) * trackH;
  const tOf = (y) => clamp(1 - (y - padTop) / trackH, 0, 1);
  const rows = [];     // くわしい年表の行
  const eraHeads = []; // くわしい年表の時代の見出し

  // ---------- 時代名 ----------
  const eraItems = ERAS.map((e) => {
    const li = h('li', { dataset: { id: e.id } });
    eraList.append(li);
    return { e, li };
  });
  const setEraNames = () => { for (const { e, li } of eraItems) li.textContent = narrow.matches ? e.short ?? e.name : e.name; };
  setEraNames();
  narrow.addEventListener('change', () => { setEraNames(); layout(); });

  // ---------- 主なできごと ----------
  const events = major
    .filter((ev) => Number.isFinite(ev.year))
    .sort((a, b) => b.year - a.year)
    .map((ev) => {
      const li = h('li', { title: `${ev.label}（${formatYear(ev.year)}年）` },
        h('span', { class: 'ev-label', text: ev.label }),
        h('span', { class: 'ev-year', text: formatYear(ev.year) }));
      const path = svg('path');
      const tick = h('i', { class: 'ev' });
      const item = { ev, li, path, tick, t: yearToT(ev.year), era: eraAtYear(ev.year) };
      li.addEventListener('click', () => app.animateT(item.t));
      li.addEventListener('pointerenter', () => { li.classList.add('is-hot'); path.classList.add('is-hot'); });
      li.addEventListener('pointerleave', () => { li.classList.remove('is-hot'); path.classList.remove('is-hot'); });
      majorList.append(li);
      leaders.append(path);
      return item;
    });

  // ---------- 並べ直し ----------
  function layout() {
    const cs = getComputedStyle(nav);
    padTop = parseFloat(cs.getPropertyValue('--pad-top')) || 18;
    padBottom = parseFloat(cs.getPropertyValue('--pad-bottom')) || 28;
    axisX = parseFloat(cs.getPropertyValue('--axis-x')) || 214;
    height = nav.clientHeight;
    trackH = Math.max(40, height - padTop - padBottom);

    for (const { e, li } of eraItems) li.style.top = `${yOf(e.tc)}px`;
    ticks.replaceChildren(
      ...ERAS.map((e) => h('i', { style: { top: `${yOf(e.t0)}px` } })),
      h('i', { style: { top: `${yOf(1)}px` } }),
      ...events.map((it) => { it.tick.style.top = `${yOf(it.t)}px`; return it.tick; }),
    );
    layoutEvents();
    shownEra = null;
    update();
  }

  // 主なできごと：本当の位置に近い所へ、重ならないように上から詰める。入りきらない分は門司に関わらないものから外す
  function layoutEvents() {
    if (!events.length) return;
    const top = 10, bottom = height - 10;
    const cap = Math.max(1, Math.floor((bottom - top) / EVENT_GAP) + 1);
    let shown = events;
    if (events.length > cap) {
      const keep = new Set([...events].sort((a, b) => (b.ev.moji ? 1 : 0) - (a.ev.moji ? 1 : 0)).slice(0, cap));
      shown = events.filter((it) => keep.has(it));
    }
    for (const it of events) { const on = shown.includes(it); it.li.hidden = !on; it.path.style.display = on ? '' : 'none'; }
    let prev = -Infinity;
    for (const it of shown) { it.y = yOf(it.t); it.ly = Math.max(it.y, prev + EVENT_GAP, top); prev = it.ly; }
    let next = Infinity;
    for (let i = shown.length - 1; i >= 0; i--) { const it = shown[i]; it.ly = Math.min(it.ly, next - EVENT_GAP, bottom); next = it.ly; }
    const x0 = axisX - 32, x1 = axisX - 4;
    for (const it of shown) {
      it.li.style.top = `${it.ly}px`;
      it.path.setAttribute('d', `M${x0} ${it.ly}C${x0 + 9} ${it.ly} ${x1 - 9} ${it.y} ${x1} ${it.y}`);
    }
  }

  // 時代名が詰まるときは、いまの時代を残し、長い時代から順に間隔の空く分だけ出す
  function declutterEras() {
    const placed = [];
    const order = [...eraItems].sort((a, b) => (a.e === app.era ? -1 : b.e === app.era ? 1 : b.e.w - a.e.w));
    for (const it of order) {
      const y = yOf(it.e.tc);
      const ok = placed.every((p) => Math.abs(p - y) >= ERA_GAP);
      it.li.hidden = !ok;
      if (ok) placed.push(y);
    }
  }

  // ---------- いまの位置を描く ----------
  let shownEra = null;
  function update() {
    const t = app.t, era = app.era;
    if (!era) return;
    knob.style.transform = `translateY(${yOf(t).toFixed(1)}px)`;
    if (era !== shownEra) {
      shownEra = era;
      span.style.top = `${yOf(era.t1) - padTop}px`;
      span.style.height = `${(era.t1 - era.t0) * trackH}px`;
      for (const { e, li } of eraItems) li.classList.toggle('is-now', e === era);
      for (const it of events) it.li.classList.toggle('is-now', it.era === era);
      for (const el of eraHeads) el.classList.toggle('is-now', el.dataset.id === era.id);
      declutterEras();
    }
    slider.setAttribute('aria-valuenow', String(Math.round(t * 1000)));
    slider.setAttribute('aria-valuetext', `${era.name} ${formatYear(app.year)}年`);
  }
  app.on('t', update);

  // ---------- スライダーの操作 ----------
  const localY = (e) => e.clientY - slider.getBoundingClientRect().top;
  let drag = null;
  slider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    slider.focus({ preventScroll: true });
    slider.setPointerCapture(e.pointerId);
    const li = e.target.closest('.tl-eras li');
    drag = { id: e.pointerId, y0: e.clientY, moved: false, li };
    if (li) return; // 時代名は、動かさずに離したら「その時代へ」
    drag.moved = true;
    slider.classList.add('is-dragging');
    const t = tOf(localY(e));
    if (Math.abs(t - app.t) > 0.03) app.animateT(t, 260); else app.setT(t);
  });
  slider.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.y0) < 5) return;
      drag.moved = true;
      slider.classList.add('is-dragging');
    }
    app.setT(tOf(localY(e)));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && drag.li && e.type === 'pointerup') app.animateT(ERA_BY_ID[drag.li.dataset.id].tc);
    slider.classList.remove('is-dragging');
    drag = null;
  };
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    app.setT(app.t - d * 0.00045);
  }, { passive: false });
  slider.addEventListener('keydown', (e) => {
    const i = ERAS.indexOf(app.era);
    const step = { ArrowUp: 0.005, ArrowRight: 0.005, ArrowDown: -0.005, ArrowLeft: -0.005 }[e.key];
    if (step) { e.preventDefault(); app.setT(app.t + step); return; }
    const to = {
      PageUp: () => ERAS[Math.min(ERAS.length - 1, i + 1)].tc,
      PageDown: () => ERAS[Math.max(0, i - 1)].tc,
      Home: () => 0,
      End: () => app.tNow,
    }[e.key];
    if (!to) return;
    e.preventDefault();
    app.animateT(to());
  });

  // ---------- 門司のくわしい年表（小窓） ----------
  let lastEra = null;
  for (const d of [...detail].filter((d) => Number.isFinite(d.year)).sort((a, b) => a.year - b.year)) {
    const e = ERA_BY_ID[d.era] ?? eraAtYear(d.year);
    if (e !== lastEra) {
      lastEra = e;
      const head = h('div', { class: 'dt-era', dataset: { id: e.id }, text: e.name });
      eraHeads.push(head);
      scroll.append(head);
    }
    const row = h('button', { class: 'dt-item' + (d.siteId ? ' has-site' : ''), type: 'button', tabindex: -1 },
      h('span', { class: 'dt-year', text: formatYear(d.year) }),
      h('span', { class: 'dt-text', text: d.text }));
    row.addEventListener('click', () => {
      if (d.siteId && app.byId.has(d.siteId)) app.selectSite(d.siteId);
      else app.animateT(yearToT(d.year));
    });
    scroll.append(row);
    rows.push({ d, row });
  }

  let open = false, openTimer = 0, closeTimer = 0, aimTimer = 0, pendingY = 0, pendingYear = null, prevPt = null, hotRow = null;
  const setOpen = (v) => { open = v; box.classList.toggle('is-open', v); };
  // 指している年の行を、ポインターと同じ高さへ
  function focusYear(year, clientY, smooth) {
    if (!rows.length) return;
    let best = rows[0];
    for (const r of rows) { if (r.d.year <= year + 0.5) best = r; else break; }
    if (hotRow !== best.row) { hotRow?.classList.remove('is-hot'); hotRow = best.row; hotRow.classList.add('is-hot'); }
    const top = best.row.offsetTop + best.row.offsetHeight / 2 - (clientY - scroll.getBoundingClientRect().top);
    scroll.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'instant' });
  }
  const yearAt = (e) => {
    const li = e.target.closest('.tl-major li');
    const it = li && events.find((x) => x.li === li);
    return it ? it.ev.year : tToYear(tOf(e.clientY - nav.getBoundingClientRect().top));
  };
  // 前の位置から小窓の左端の上下の角へ引いた三角形の中を、右へ進んでいるか
  function aimingAtBox(p) {
    const q = prevPt;
    prevPt = p;
    if (!q || p.x <= q.x || !open) return false;
    const r = box.getBoundingClientRect();
    const dx = r.left - q.x;
    if (dx <= 0) return false;
    const s = (p.y - q.y) / (p.x - q.x);
    return s >= (r.top - q.y) / dx && s <= (r.bottom - q.y) / dx;
  }

  majorList.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !rows.length) return;
    clearTimeout(closeTimer);
    const year = yearAt(e), y = e.clientY;
    if (!open) {
      pendingYear = year; pendingY = y;
      if (!openTimer) openTimer = setTimeout(() => { openTimer = 0; setOpen(true); focusYear(pendingYear, pendingY, false); }, OPEN_DELAY);
      return;
    }
    clearTimeout(aimTimer);
    if (aimingAtBox({ x: e.clientX, y })) aimTimer = setTimeout(() => focusYear(year, y, true), AIM_DELAY);
    else focusYear(year, y, true);
  });
  const stay = () => clearTimeout(closeTimer);
  const leave = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      clearTimeout(openTimer); openTimer = 0; clearTimeout(aimTimer);
      setOpen(false); prevPt = null;
    }, CLOSE_DELAY);
  };
  majorList.addEventListener('pointerleave', () => { if (!open) { clearTimeout(openTimer); openTimer = 0; } });
  for (const el of [nav, box]) { el.addEventListener('pointerenter', stay); el.addEventListener('pointerleave', leave); }

  new ResizeObserver(() => layout()).observe(nav);
  layout();
  return { layout, close: () => setOpen(false) };
}

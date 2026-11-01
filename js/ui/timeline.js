// 左の年表：縦のスライダー（上が現代・下が縄文）、時代名、主なできごと（引き出し線つき）。
// 主なできごとに乗ると、スライダーの右に「門司のくわしい年表」の小窓を出す。
import { ERAS, ERA_BY_ID, eraAtYear, yearToT, formatYear } from '../eras.js';
import { clamp, h, svg } from '../util.js';

const CLOSE_DELAY = 300; // 離れてから閉じるまで
const EVENT_GAP = 20;    // 主なできごとの行どうしの最小間隔
const ERA_GAP = 15;      // 時代名どうしの最小間隔
const DETAIL_HEAD = 30;  // くわしい年表の上に貼りつく時代名の高さ（行をこの下に出す）

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
  let positionsDirty = true;

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
    positionsDirty = true;
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

  // ---------- 門司のくわしい年表（小窓）：左の年表と同じく上が新しい。同じ年はデータの順（古い順）を逆にする ----------
  let lastEra = null;
  for (const d of [...detail].filter((d) => Number.isFinite(d.year)).sort((a, b) => a.year - b.year).reverse()) {
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
  let closeTimer = 0, moveFrame = 0, pendingY = 0, positions = [];
  const setOpen = (v) => { box.classList.toggle('is-open', v); };
  // 左右の同じ年を結び、その間も連続して対応させる。同じ年の行はひとまとまりとして扱う。
  function measurePositions() {
    positionsDirty = false;
    const years = [];
    for (const { d, row } of rows) {
      let group = years.at(-1);
      if (!group || group.year !== d.year) years.push(group = { year: d.year, sum: 0, count: 0 });
      group.sum += row.offsetTop + row.offsetHeight / 2;
      group.count++;
    }
    const detailY = (year) => {
      const index = years.findIndex((group) => group.year <= year);
      if (index < 0) return years.at(-1).sum / years.at(-1).count;
      if (index === 0) return years[0].sum / years[0].count;
      const newer = years[index - 1], older = years[index];
      const t = (yearToT(year) - yearToT(older.year)) / (yearToT(newer.year) - yearToT(older.year));
      return older.sum / older.count + (newer.sum / newer.count - older.sum / older.count) * t;
    };
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const offset = nav.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    const groups = [];
    for (const it of events) {
      if (it.li.hidden) continue;
      let group = groups.at(-1);
      if (!group || group.year !== it.ev.year) groups.push(group = { year: it.ev.year, sum: 0, count: 0 });
      group.sum += it.ly;
      group.count++;
    }
    positions = [{ y: 0, top: 0 }];
    for (const group of groups) {
      const y = group.sum / group.count;
      const visibleY = clamp(y + offset, DETAIL_HEAD, scroll.clientHeight - 8);
      // 行の密度が低い場所でも、マウスと逆方向には動かないようにする。
      const top = clamp(detailY(group.year) - visibleY, positions.at(-1).top, maxScroll);
      positions.push({ y, top });
    }
    positions.push({ y: height, top: maxScroll });
  }

  function moveTo(clientY) {
    if (positionsDirty) measurePositions();
    const y = clamp(clientY - nav.getBoundingClientRect().top, 0, height);
    let index = positions.findIndex((position) => position.y >= y);
    if (index <= 0) index = 1;
    const before = positions[index - 1], after = positions[index];
    const t = (y - before.y) / (after.y - before.y);
    scroll.scrollTo({ top: before.top + (after.top - before.top) * t, behavior: 'instant' });
  }
  majorList.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !rows.length) return;
    clearTimeout(closeTimer);
    pendingY = e.clientY;
    if (!moveFrame) moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      moveTo(pendingY);
      setOpen(true);
    });
  });
  const stay = () => clearTimeout(closeTimer);
  const leave = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY);
  };
  majorList.addEventListener('pointerleave', () => {
    cancelAnimationFrame(moveFrame);
    moveFrame = 0;
  });
  for (const el of [nav, box]) { el.addEventListener('pointerenter', stay); el.addEventListener('pointerleave', leave); }

  new ResizeObserver(() => layout()).observe(nav);
  new ResizeObserver(() => { positionsDirty = true; }).observe(scroll);
  document.fonts?.addEventListener('loadingdone', () => { positionsDirty = true; });
  layout();
  return { layout, close: () => setOpen(false) };
}

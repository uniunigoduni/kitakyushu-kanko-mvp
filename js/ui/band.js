// 下の史跡帯：左が縄文、右が現代。スライダーに合わせて横に流れ、いまの時代の史跡を真ん中に寄せる。
// 史跡を選んだら（カード・ピン・年表・吹き出しの前後の番号・リンクのどれからでも）、そのカードを滑らかに真ん中へ寄せ、
// 年を手で動かすか帯を手で流すまでそこに置く。
// 現代の欄の終わりには、現代の地図に載せた観光地を、観光モデルルートの説明のカードに続けて番号の順に並べる
import { ERAS, yearToT } from '../eras.js';
import { clamp, easeInOut, h, historicalName, reducedMotion, svg } from '../util.js';

// 「1914年（大正3年）2月」→「1914年」のように、括弧の中を落とした短い年
export const shortYear = (label) => label.replace(/（[^）]*）/g, '').replace(/\s+/g, '');

// 観光モデルルートの印：出発と到着の点を、曲がった点線でつなぐ
function routeIcon() {
  const icon = svg('svg', { class: 'br-icon', viewBox: '0 0 26 26', 'aria-hidden': 'true' });
  icon.append(
    svg('path', { d: 'M6 20.5C6 13 20 13.5 20 6', fill: 'none', 'stroke-dasharray': '2.6 2.4' }),
    svg('circle', { cx: 6, cy: 20.5, r: 3.2 }),
    svg('circle', { cx: 20, cy: 5.5, r: 3.2 }));
  return icon;
}

export function createBand(app, sites) {
  const scroller = document.querySelector('#band .band-scroll');
  const list = scroller.querySelector('.band-list');
  const cards = new Map();
  const eraEls = new Map();
  const anchors = []; // スライダーの位置 t と、帯の上の x の対応（t の小さい順）
  // hold：選んだ史跡。選んだあとに年が動いても（その史跡の年へ移る・特別な場面の年へ合わせる）、帯はそのカードから動かさない
  let hold = null, centerAnimation = null;
  let route = null; // 観光モデルルートの説明のカード（その時代の欄）

  const byEra = new Map(ERAS.map((e) => [e.id, []]));
  // どの時代にも出る史跡（巌流島）は bandEra の時代の欄に置く
  for (const s of sites) byEra.get(s.bandEra ?? s.eras[0])?.push(s);

  for (const e of ERAS) {
    const group = byEra.get(e.id).sort((a, b) => a.year - b.year || (a.n ?? 0) - (b.n ?? 0));
    const div = h('li', { class: 'band-era', 'aria-hidden': 'true', text: e.name });
    list.append(div);
    eraEls.set(e.id, div);
    anchors.push({ t: e.t0, el: div, at: 'left' });
    // 時代の中の並びは年の順。帯の位置が時代の外へはみ出さないように、時代の幅の内側へ寄せる
    const pad = (e.t1 - e.t0) * 0.12;
    let prevT = e.t0, spots = 0;
    for (const s of group) {
      // 観光地の前に、番号の順が観光モデルルートだと分かる説明のカード。最初の画面（今の年）ではこれを真ん中に置き、押すと 1 番を開く
      if (s.spot && !spots++) {
        const total = group.filter((x) => x.spot).length;
        const btn = h('button', { class: 'band-card band-route', type: 'button', 'aria-label': `観光モデルルート。${s.name}から和布刈まで、番号の順にめぐる${total}か所の一例。押すと1番を開きます`, onclick: () => app.selectSite(s.id) },
          routeIcon(),
          h('span', { class: 'bc-text' },
            h('span', { class: 'bc-year', text: '観光モデルルート' }),
            h('span', { class: 'bc-name', text: `${s.name}から和布刈まで${total}か所` }),
            h('span', { class: 'bc-meta', text: '番号の順にめぐる一例' })));
        const li = h('li', {}, btn);
        list.append(li);
        route = { btn, era: e };
        prevT = Math.max(prevT + 1e-4, app.tNow);
        anchors.push({ t: prevT, el: li, at: 'center' });
      }
      const thumb = s.pano && h('img', { class: 'bc-thumb', src: `assets/pano/${s.pano}_thumb.jpg`, alt: '', loading: 'lazy', decoding: 'async' });
      // 観光地のカードは、ピンと同じ番号・種類・行き方
      const btn = s.spot
        ? h('button', { class: 'band-card is-spot', type: 'button', dataset: { id: s.id }, 'aria-label': `${s.n}. ${s.name}`, onclick: () => app.selectSite(s.id) },
          h('span', { class: 'bc-num', 'aria-hidden': 'true', text: String(s.n) }),
          h('span', { class: 'bc-text' },
            h('span', { class: 'bc-year', text: s.kind }),
            h('span', { class: 'bc-name', text: s.name }),
            s.access && h('span', { class: 'bc-meta', text: s.access })))
        : h('button', { class: 'band-card', type: 'button', dataset: { id: s.id }, onclick: () => app.selectSite(s.id) },
          h('span', { class: 'bc-text' },
            h('span', { class: 'bc-year', text: shortYear(s.yearLabel ?? '') }),
            h('span', { class: 'bc-name', text: historicalName(s) }),
            s.level >= 2 && h('span', { class: 'bc-meta', text: 'ガイドあり' })),
          thumb);
      const li = h('li', {}, btn);
      list.append(li);
      cards.set(s.id, { s, btn, li, thumb, era: e });
      // 観光地は今年の場所なので、年の位置は持たず、説明のカードから帯の終わりまでの間に流す
      if (s.spot) continue;
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
  function cardPosition(s) {
    const btn = cards.get(s.id)?.btn;
    if (!btn) return scroller.scrollLeft;
    const cardRect = btn.getBoundingClientRect(), viewRect = scroller.getBoundingClientRect();
    return clamp(scroller.scrollLeft + cardRect.left + cardRect.width / 2 - (viewRect.left + viewRect.width / 2), 0, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
  }
  function stopCenter() {
    if (!centerAnimation) return;
    cancelAnimationFrame(centerAnimation.raf);
    centerAnimation = null;
  }
  function centerCard(s) {
    stopCenter();
    const from = scroller.scrollLeft, to = cardPosition(s);
    if (reducedMotion() || Math.abs(to - from) < 1) { scroller.scrollLeft = to; return; }
    const ms = clamp(Math.abs(to - from) / scroller.clientWidth * 700, 280, 720);
    const animation = { site: s, raf: 0 }, start = performance.now();
    centerAnimation = animation;
    const step = (now) => {
      if (centerAnimation !== animation) return;
      const k = Math.min(1, (now - start) / ms);
      scroller.scrollLeft = from + (cardPosition(s) - from) * easeInOut(k);
      if (k < 1) animation.raf = requestAnimationFrame(step);
      else centerAnimation = null;
    };
    animation.raf = requestAnimationFrame(step);
  }
  function follow() {
    if (hold || !xs.length) return;
    scroller.scrollLeft = xAt(app.t) - scroller.clientWidth / 2;
  }

  // 手で帯を流し始めたら、カードに止めるのをやめる（帯は手で動かした位置のまま。次に年が動いたら流れる）
  const takeControl = () => { hold = null; stopCenter(); };
  scroller.addEventListener('pointerdown', takeControl);
  // 縦のホイールでも横に流す
  scroller.addEventListener('wheel', (e) => {
    takeControl();
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    scroller.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  }, { passive: false });

  app.on('t', follow);
  // 史跡を選んだら、そのカードを滑らかに真ん中へ（一覧にない広告は、年に合わせて流す）
  app.on('choose', (s) => {
    hold = cards.has(s.id) ? s : null;
    if (hold) centerCard(s);
    else stopCenter();
  });
  app.on('scrub', () => { hold = null; stopCenter(); }); // スライダー・年表を手で動かしたら、また年に合わせて流す
  app.on('era', (era, prev) => {
    if (prev) eraEls.get(prev.id)?.classList.remove('is-now');
    eraEls.get(era.id)?.classList.add('is-now');
    for (const c of cards.values()) c.btn.classList.toggle('is-now', c.s.eras.includes(era.id));
    route?.btn.classList.toggle('is-now', route.era === era);
  });
  app.on('select', (s) => { for (const c of cards.values()) c.btn.classList.toggle('is-selected', c.s === s); });
  app.on('scene', (s) => { const c = cards.get(s.id); if (c?.thumb) c.thumb.src = `assets/pano/${s.pano}_thumb.jpg`; });
  app.on('deselect', (s) => {
    for (const c of cards.values()) c.btn.classList.remove('is-selected');
    if (hold === s) { hold = null; stopCenter(); } // 閉じたら止めるのをやめる（帯はそのまま。次に年が動いたら流れる）
  });

  const ro = new ResizeObserver(() => {
    measure();
    if (!hold) follow();
    else if (!centerAnimation) scroller.scrollLeft = cardPosition(hold);
  });
  ro.observe(scroller);
  ro.observe(list);
  measure();
  return { follow };
}

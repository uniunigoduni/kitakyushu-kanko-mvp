// 史跡の吹き出し。ピンを隠さない側に出し（ピンが画面の下の方なら上）、しっぽはピンを指したまま地図に付いていく。
// 別のピンを選ぶと、前の吹き出しは消して新しい中身に入れ替える。
// 特別な場面の「解説を読む」では、しっぽを付けずに地図の窓の端に寄せて出す（dock）。
import { clamp, h, historicalName, isPaid, paidUntil } from '../util.js';
import { pinLabel, yearTag } from './pins.js';
import { adCard } from './ads.js';

const M = 8;     // 地図の窓の縁からの余白
const GAP = 14;  // ピンと吹き出しの間（しっぽの分）
const TAIL = 22; // しっぽを角から離す距離
const MIN_H = 160;
const ROUTE_OUTSET = 52; // 吹き出しの左右のボタンと間隔

export function createPopup(app, world, pins) {
  const map = world.renderer.domElement.parentElement;
  const tail = h('i', { class: 'popup-tail' });
  const close = h('button', { class: 'popup-close', type: 'button', 'aria-label': '閉じる', text: '×', onclick: () => (onClose ? onClose() : app.deselect()) });
  const scroll = h('div', { class: 'popup-scroll thin-scroll' });
  const foot = h('div', { class: 'popup-foot' });
  const route = app.sites.filter((s) => s.spot && Number.isFinite(s.n)).sort((a, b) => a.n - b.n);
  const routeButtons = [-1, 1].map((direction) => h('button', {
    class: `popup-route ${direction < 0 ? 'is-prev' : 'is-next'}`, type: 'button', hidden: true,
    onclick: () => {
      const i = route.indexOf(cur), target = i < 0 ? null : route[i + direction];
      if (target) app.selectSite(target.id);
    },
  }, h('i', { class: 'pin-shadow', 'aria-hidden': 'true' }),
  h('i', { class: 'pin-stem', 'aria-hidden': 'true' }),
  h('span', { class: 'pin-head', 'aria-hidden': 'true' }, h('span', { class: 'pin-num' }))));
  const el = h('div', { class: 'popup', role: 'dialog', 'aria-labelledby': 'popup-name', hidden: true }, tail, close, scroll, foot, routeButtons);
  map.append(el);

  let cur = null, hideTimer = 0, paidTimer = 0, dock = false, onClose = null;
  let side = '', w = 0, natH = 0, shrink = 0, cramped = false;
  const P = {};
  const last = { x: NaN, y: NaN, W: 0, H: 0 };
  const box = [0, 0, 0, 0]; // 置いた四角 [x0, y0, x1, y1]（地図の窓の中の px）

  function fill(s) {
    el.classList.toggle('is-ad', !!s.ad);
    el.classList.toggle('is-spot', !!s.spot);
    const routeIndex = route.indexOf(s);
    routeButtons.forEach((button, i) => {
      const target = routeIndex < 0 ? null : route[routeIndex + (i === 0 ? -1 : 1)];
      button.hidden = !target;
      button.disabled = !target;
      button.querySelector('.pin-num').textContent = target ? String(target.n) : '';
      button.setAttribute('aria-label', target ? `${i === 0 ? '前' : '次'}の観光地 ${target.n} ${target.name}` : `${i === 0 ? '前' : '次'}の観光地はありません`);
      button.title = target ? `${target.n}. ${target.name}` : '';
    });
    if (s.spot) {
      // 観光地（現代の地図）：番号と名前、種類と行き方、紹介文。昔の史跡がある場所は「この場所の歴史」から、その史跡の年へ移って開く
      const site = s.site ? app.byId.get(s.site) : null;
      clearTimeout(paidTimer);
      scroll.replaceChildren(...[
        h('div', { class: 'spot-head' },
          h('span', { class: 'spot-tile', 'aria-hidden': 'true', text: String(s.n) }),
          h('div', { class: 'spot-title' },
            // 番号は観光モデルルートの順（下の帯の先頭に説明のカード）
            h('p', { class: 'spot-route' }, '観光モデルルート', h('span', { class: 'spot-route-n', text: `${s.n}／${route.length}` })),
            h('p', { class: 'spot-meta' }, [s.kind, s.access].filter(Boolean).flatMap((t, i) => [i ? ' · ' : null, h('span', { class: 'spot-meta-part', text: t })])),
            h('h2', { class: 'spot-name', id: 'popup-name', text: s.name }))),
        s.summary ? h('p', { class: 'popup-summary', text: s.summary }) : null,
        site ? h('button', { class: 'spot-history', type: 'button', onclick: () => app.selectSite(site.id) },
          h('span', { class: 'spot-history-text' },
            h('span', { class: 'spot-history-tag', text: 'この場所の歴史' }),
            h('span', { class: 'spot-history-name' }, h('span', { class: 'spot-history-year', text: yearTag(site) }), pinLabel(historicalName(site))))) : null,
        s.sources?.length > 0 ? h('ul', { class: 'popup-sources' }, s.sources.map((r) =>
          h('li', {}, r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener', text: r.title }) : r.title))) : null,
      ].filter(Boolean));
      scroll.scrollTop = 0;
      foot.classList.remove('ad-foot');
      foot.hidden = true;
      foot.replaceChildren();
      return;
    }
    if (s.ad) {
      // 広告：お店の名前とボタン、紹介文、特典と営業時間。下の帯は、架空のお店であること（自分の見本なら掲載前であること）と、お店の方への入口
      const card = adCard(app, s);
      clearTimeout(paidTimer);
      scroll.replaceChildren(card.body);
      scroll.scrollTop = 0;
      foot.classList.add('ad-foot');
      foot.hidden = false;
      foot.replaceChildren(...card.foot);
      return;
    }
    foot.classList.remove('ad-foot');
    el.classList.toggle('no-ar', !s.pano);
    const ar = s.pano && h('button', { class: 'popup-ar', type: 'button', onclick: (e) => app.openAR(s, e.currentTarget.querySelector('img')) },
      h('img', { src: `assets/pano/${s.pano}_thumb.jpg`, alt: '', decoding: 'async' }),
      h('span', { text: 'ARで探検' }));
    const text = h('div', { class: 'popup-text' },
      h('p', { class: 'popup-year', text: s.yearLabel }),
      h('h2', { class: 'popup-name', id: 'popup-name', text: historicalName(s) }),
      s.summary ? h('p', { class: 'popup-summary', text: s.summary }) : null,
      // 一押しの史跡は、いまの姿と、現代の地図へ戻るボタン
      s.pick ? h('div', { class: 'popup-now' },
        h('p', { class: 'popup-now-text' },
          h('span', { class: 'popup-now-tag', text: 'いま' }),
          h('span', { class: 'popup-now-name', text: s.nowName ?? pinLabel(s.name) }),
          s.nowNote ? h('span', { class: 'popup-now-note', text: s.nowNote }) : null),
        h('button', { class: 'popup-now-back', type: 'button', onclick: () => app.backToNow(s), text: '現代へ戻る' })) : null,
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
    if (dock) {
      // 端に寄せたときは CSS の置き場所のまま
      box[0] = el.offsetLeft; box[1] = el.offsetTop; box[2] = box[0] + el.offsetWidth; box[3] = box[1] + el.offsetHeight;
      cramped = false;
      return;
    }
    const p = pins.pins.get(cur.id);
    world.project(p.obj.position, P);
    const { W, H } = world.size;
    if (P.x === last.x && P.y === last.y && W === last.W && H === last.H) return;
    Object.assign(last, { x: P.x, y: P.y, W, H });
    const g = p.g; // 現代の地図に出した一押しの史跡は、中のピンの大きさ
    const rx = g.w / 2, ry = g.h / 2;
    const hx = P.x, hy = P.y - g.stem;
    const away = !P.visible || hx < 0 || hx > W || hy < 0 || P.y > H;
    el.classList.toggle('is-away', away);
    if (away) return;

    const top = hy - ry, bottom = Math.max(hy + ry, P.y + 4);
    const outset = cur.spot && matchMedia('(min-width: 761px)').matches ? ROUTE_OUTSET : 0;
    const room = { above: top - GAP - M, below: H - M - bottom - GAP, right: W - M - (hx + rx + GAP), left: hx - rx - GAP - M };
    const vertical = (sd) => sd === 'above' || sd === 'below';
    const fits = (sd) => (vertical(sd) ? room[sd] >= natH && W - 2 * M >= w + 2 * outset : room[sd] >= w + 2 * outset && H - 2 * M >= natH);
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
      x = clamp(hx - w / 2, M + outset, W - M - outset - w);
      y = sd === 'above' ? top - GAP - ph : bottom + GAP;
      tail.style.left = `${Math.round(clamp(hx - x, TAIL, w - TAIL) - 7)}px`;
      tail.style.top = '';
    } else {
      x = sd === 'right' ? hx + rx + GAP + outset : hx - rx - GAP - outset - w;
      y = clamp(hy - ph / 2, M, H - M - ph);
      tail.style.top = `${Math.round(clamp(hy - y, TAIL, ph - TAIL) - 7)}px`;
      tail.style.left = '';
    }
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    box[0] = x - outset; box[1] = y; box[2] = x + w + outset; box[3] = y + ph;
  }

  // opts.dock：しっぽなしで窓の端に寄せる。opts.onClose：× を押したとき（なければ史跡の選択を外す）
  function open(s, opts = {}) {
    clearTimeout(hideTimer);
    cur = s;
    dock = !!opts.dock;
    onClose = opts.onClose ?? null;
    el.classList.toggle('is-docked', dock);
    fill(s);
    el.hidden = false;
    el.classList.remove('is-open', 'is-away');
    side = '';
    if (dock) { el.style.transform = ''; delete el.dataset.side; }
    measure();
    place();
    void el.offsetWidth;
    el.classList.add('is-open');
  }
  function hide() {
    if (!cur) return;
    cur = null;
    onClose = null;
    clearTimeout(paidTimer);
    el.classList.remove('is-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.hidden = true; scroll.replaceChildren(); el.classList.remove('is-docked'); dock = false; }, 160);
  }

  // 特別な場面のある史跡は、場面の札を出す（吹き出しは「解説を読む」で開く）
  app.on('select', (s) => { if (!app.stage?.owns(s)) open(s); });
  app.on('deselect', hide);
  // 時代を動かして、その史跡がない時代に入ったら閉じる
  app.on('era', (era) => { if (cur && !cur.eras.includes(era.id)) app.deselect(); });
  app.on('paid', (s) => { if (cur === s) { fillFoot(s); measure(); place(); } });
  // 広告の下の帯は、お店として登録しているかで入口が変わる
  app.on('user', () => { if (cur?.ad) { fill(cur); measure(); place(); } });
  // 時代ごとの場面がある史跡は、年を動かしたら AR の切り抜きもその場面にする
  app.on('scene', (s) => {
    const img = cur === s && scroll.querySelector('.popup-ar img');
    if (img) img.src = `assets/pano/${s.pano}_thumb.jpg`;
  });
  world.onFrame(place);
  new ResizeObserver(() => { measure(); place(); }).observe(map);
  document.fonts?.ready.then(() => { measure(); place(); });

  return {
    open, hide,
    get site() { return cur; },
    // 今の視点では、縮めずに出せる場所がない
    get cramped() { return cramped; },
    // 出ている吹き出しの四角（出ていない・ピンが画面の外のときは null）
    get rect() { return cur && !el.classList.contains('is-away') ? box : null; },
  };
}

// 地図の外の「時代の絵」。タイトルの右の空き（地図の窓のすぐ上）に、時代に合わせた絵を出す。
// 平安〜安土桃山は屏風の金雲、江戸は浮世絵の雲、幕末・明治はゆかりの人物の写真、大正・昭和初期は機関車とその煙、
// 戦時中は戦艦と煙、高度経済成長期・昭和後期は工場の煙突と関門橋（年に合わせて塔が立ち、開通する）。
// 絵は地図にかぶせない。動きは CSS のアニメーションだけで作る（AR・決済の画面を開いている間は CSS で止める）。

const H = 76; // 絵を描く高さ（パソコンのタイトルの帯の高さ）。スマホでは帯の高さに合わせて縮める

const tpl = document.createElement('template');
const art = (markup) => { tpl.innerHTML = markup.trim(); return tpl.content.firstElementChild; };
const px = (v) => `${v}px`;

function node(tag, cls, css = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(css)) e.style.setProperty(k, String(v));
  return e;
}
// 煙の出どころ（大きさのない点）。煙の玉はここから出る
function source(css, ...children) {
  const e = node('div', 'fl-src', css);
  e.append(...children.flat());
  return e;
}
// 煙。同じ動きの玉を時間をずらして n 個出し、切れ目のない煙にする（横は一定の速さ、縦はふわっと上がる）。
// 玉ごとに広がり方と流れ方を少しずつ変えて、数珠つなぎに見えないようにする
function smoke(n, { life, dx, dy, s0 = 0.35, s1 = 2.4, o = 0.5, size = 14, cls = '', seed = 1 }) {
  let r = 7919 * seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return Array.from({ length: n }, (_, i) => node('i', cls ? `fl-puff ${cls}` : 'fl-puff', {
    '--life': `${life}s`, '--delay': `${(-(life * i) / n).toFixed(2)}s`,
    '--dx': px((dx * (1 + 0.12 * rnd())).toFixed(1)), '--dy': px((dy * (1 + 0.22 * rnd())).toFixed(1)),
    '--s0': s0, '--s1': (s1 * (1 + 0.3 * rnd())).toFixed(2), '--o': o, '--size': px(size),
  }));
}
function restart(e) { e.style.animationName = 'none'; void e.offsetWidth; e.style.animationName = ''; }

function scene(cls) {
  const el = node('div', `fl ${cls}`);
  const stage = node('div', 'fl-scene');
  el.append(stage);
  el.hidden = true;
  return { el, stage };
}

// ---------- 平安〜江戸：雲 ----------
const seeded = (seed) => { let r = seed; return () => ((r = (r * 16807) % 2147483647) / 2147483647); };
const f1 = (v) => v.toFixed(1);
// 長さ span を、幅 min〜max のふくらみに分ける
function lobes(span, min, max, rnd) {
  const ws = [];
  for (let sum = 0; sum < span;) { const w = min + rnd() * (max - min); ws.push(w); sum += w; }
  const k = span / ws.reduce((a, b) => a + b, 0);
  return ws.map((w) => w * k);
}
// 屏風の金雲。上の縁は小さなふくらみの連なり、下の縁はゆるい波、両端は丸い。まわりに砂子と切箔を散らす
function goldCloud(len, hgt, seed) {
  const rnd = seeded(seed);
  const r = hgt / 2, span = len - hgt;
  let d = `M${r} ${hgt}`, x = r, drop = 0, lift = 0;
  for (const w of lobes(span, 26, 46, rnd)) {
    const ry = hgt * (0.1 + rnd() * 0.12);
    drop = Math.max(drop, ry);
    x += w; d += `A${f1(w / 2)} ${f1(ry)} 0 0 0 ${f1(x)} ${hgt}`;
  }
  d += `A${r} ${r} 0 0 0 ${f1(len - r)} 0`;
  x = len - r;
  for (const w of lobes(span, 13, 24, rnd)) {
    const ry = Math.min(w / 2, hgt * (0.36 + rnd() * 0.3));
    lift = Math.max(lift, ry);
    x -= w; d += `A${f1(w / 2)} ${f1(ry)} 0 0 0 ${f1(x)} 0`;
  }
  d += `A${r} ${r} 0 0 0 ${r} ${hgt}Z`;
  const dust = Array.from({ length: Math.round(len / 9) }, (_, i) => {
    const out = i % 4 === 0; // 4つに1つは雲の外にこぼす
    const y = out ? (rnd() < 0.5 ? -lift - 1 - rnd() * 4 : hgt + drop + 1 + rnd() * 4) : 1 + rnd() * (hgt - 2);
    return `<circle cx="${f1(r + rnd() * span)}" cy="${f1(y)}" r="${(0.4 + rnd() * 0.7).toFixed(2)}"/>`;
  }).join('');
  const leaf = Array.from({ length: 3 }, () => {
    const cx = r + rnd() * span, cy = rnd() < 0.5 ? -lift - 2 - rnd() * 3 : hgt + drop + 2 + rnd() * 3, a = 1 + rnd() * 1.2;
    return `<rect x="${f1(cx - a / 2)}" y="${f1(cy - a / 2)}" width="${f1(a)}" height="${f1(a)}" transform="rotate(${Math.round(rnd() * 90)} ${f1(cx)} ${f1(cy)})"/>`;
  }).join('');
  const y0 = -lift - 7, vh = hgt + lift + drop + 14;
  return art(`<svg class="fl-band" viewBox="0 ${f1(y0)} ${len} ${f1(vh)}" width="${len}" height="${f1(vh)}" style="margin-top:${f1(y0)}px">
    <path class="fl-band-body" d="${d}"/><g class="fl-dust">${dust}${leaf}</g></svg>`);
}
// 浮世絵の霞（すやり霞）。細い帯を少しずつずらして重ね、下ほど濃くぼかす
function kasumi(rows) {
  const len = Math.max(...rows.map(([x, , w]) => x + w)), hgt = Math.max(...rows.map(([, y, , h]) => y + h));
  return art(`<svg class="fl-band" viewBox="0 0 ${len} ${hgt}" width="${len}" height="${hgt}">
    ${rows.map(([x, y, w, h]) => `<rect class="fl-band-body" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`).join('')}</svg>`);
}
// 金の色と、江戸の霞の色（時代の差し色で、下ほど濃い）
const CLOUD_DEFS = `<svg class="fl-defs" width="0" height="0" aria-hidden="true"><defs>
  <linearGradient id="fl-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ead08a"/><stop offset=".55" stop-color="#d2a95c"/><stop offset="1" stop-color="#b58845"/></linearGradient>
  <linearGradient id="fl-mist" x1="0" y1="0" x2="0" y2="1"><stop class="fl-mist-0" offset="0"/><stop class="fl-mist-1" offset=".85"/></linearGradient>
</defs></svg>`;
const GOLD = [
  // right, top, 長さ, 高さ, 揺れ幅, 周期（秒）
  [26, 16, 260, 15, 12, 26],
  [222, 44, 300, 15, 16, 31],
  [470, 12, 210, 13, 10, 23],
  [626, 46, 250, 13, 14, 29],
  [800, 22, 200, 12, 10, 27],
];
const MIST = [
  // right, top, 帯 [x, y, 幅, 高さ]…, 揺れ幅, 周期（秒）
  [20, 30, [[0, 6, 300, 8], [60, 0, 170, 8]], 12, 28],
  [300, 50, [[0, 5, 280, 7], [120, 0, 120, 7]], 16, 33],
  [560, 24, [[30, 0, 160, 7], [0, 5, 250, 8]], 10, 25],
];
function cloudScene() {
  const s = scene('fl-clouds');
  const place = (b, right, top, amp, dur, i) => {
    for (const [k, v] of Object.entries({ right: px(right), top: px(top), '--amp': px(amp), '--dur': `${dur}s`, '--delay': `${-dur * (i % 3) / 3}s` })) b.style.setProperty(k, v);
    return b;
  };
  const gold = node('div', 'fl-gold');
  gold.append(...GOLD.map(([right, top, len, hgt, amp, dur], i) => place(goldCloud(len, hgt, 17 + i * 31), right, top, amp, dur, i)));
  const mist = node('div', 'fl-mist');
  mist.append(...MIST.map(([right, top, rows, amp, dur], i) => place(kasumi(rows), right, top, amp, dur, i)));
  s.stage.append(art(CLOUD_DEFS), node('div', 'fl-sky'), gold, mist);
  return {
    ...s,
    // 平安〜安土桃山は屏風の金雲、江戸は浮世絵の霞（上に藍の一文字ぼかし）
    update(era) { s.el.classList.toggle('is-ukiyoe', era.id === 'edo'); },
  };
}

// ---------- 大正・昭和初期：機関車と煙 ----------
// 大正の 8620 形のような 2-6-0 の機関車に、炭水車と、明かり取りの屋根の客車を2両。左へ走る
const TRAIN_W = 344;
const TRAIN_V = 62; // 進む速さ（px/秒）
const LIFE = 2.6;   // 煙の玉が消えるまで（秒）
const coach = (x) => `<g transform="translate(${x} 0)">
  <path d="M158 40V16Q158 13 162 12.5L168 12V9H238V12L244 12.5Q248 13 248 16V40Z"/>
  <rect x="158" y="39" width="90" height="2"/><rect x="152" y="36" width="6" height="2"/>
  ${[170, 180, 226, 236].map((cx) => `<circle cx="${cx}" cy="42" r="4"/>`).join('')}
  ${Array.from({ length: 8 }, (_, i) => `<rect class="win" x="${166 + 10 * i}" y="18" width="6" height="7"/>`).join('')}</g>`;
const TRAIN_SVG = `<svg class="fl-art" viewBox="0 0 ${TRAIN_W} 48" width="${TRAIN_W}" height="48">
  <path d="M1 45L6 38H12V45Z"/><rect x="4" y="34" width="6" height="5"/><rect x="12" y="32" width="16" height="9" rx="2"/>
  <rect x="9" y="18" width="70" height="16" rx="3"/>
  <path d="M16 18V8H14.5V5.5H25.5V8H24V18Z"/>
  <path d="M38 18V15Q38 11 43 11Q48 11 48 15V18Z"/><path d="M55 18V16Q55 13 59 13Q63 13 63 16V18Z"/><rect x="68" y="14" width="2" height="4"/>
  <path d="M78 36V12H76V9.5H103V12H101V36Z"/><rect class="win" x="83" y="15" width="12" height="8"/>
  <rect x="7" y="33" width="96" height="4"/><rect x="80" y="36" width="18" height="4"/>
  <circle cx="16" cy="42" r="4"/><circle cx="37" cy="39" r="7"/><circle cx="55" cy="39" r="7"/><circle cx="73" cy="39" r="7"/>
  <rect x="24" y="38" width="50" height="2"/>
  <path d="M106 38V18H109V15Q129 11 149 15V18H152V38Z"/><rect x="104" y="37" width="50" height="3"/><rect x="102" y="35" width="6" height="2"/>
  <circle cx="115" cy="42" r="4"/><circle cx="129" cy="42" r="4"/><circle cx="143" cy="42" r="4"/>
  ${coach(0)}${coach(96)}</svg>`;
function trainScene() {
  const s = scene('fl-train');
  const run = node('div', 'fl-run');
  // 煙は機関車といっしょに動く箱の中にあるので、進む速さぶん後ろへ流して、空気の中に残るように見せる
  run.append(art(TRAIN_SVG), source({ left: '20px', top: '6px' }, smoke(16, { life: LIFE, dx: (TRAIN_V + 12) * LIFE, dy: -24, s0: 0.34, s1: 2.7, o: 0.6, seed: 3 })));
  s.stage.append(node('div', 'fl-glow'), node('div', 'fl-rail'), run);
  let latest = 0, planned = -1;
  // 走る道のり：右の外から、左の外へ。左端は少し余らせ、題字の幅が少し変わっても途中で消えて見えないようにする
  function plan(w) {
    planned = w;
    const x0 = TRAIN_W + 16, x1 = -(w + 140);
    const dur = (x0 - x1) / TRAIN_V / 0.88; // 残りの 12% は画面の外で待つ
    run.style.setProperty('--x0', px(x0));
    run.style.setProperty('--x1', px(x1.toFixed(1)));
    run.style.setProperty('--run', `${dur.toFixed(2)}s`);
    // 出てきたときは、機関車の先頭が帯の右から 4 割ほどのところを走っているところから始める
    run.style.setProperty('--delay', `${(-(16 + 0.38 * w) / TRAIN_V).toFixed(2)}s`);
    restart(run);
  }
  return {
    ...s,
    layout(w) {
      latest = w;
      // 画面の大きさが大きく変わったときだけ走り直す（題字が変わるたびに機関車が飛ばないように）
      if (!s.el.hidden && Math.abs(w - planned) > 120) plan(w);
    },
    enter() { plan(latest); },
  };
}

// ---------- 戦時中：戦艦と煙 ----------
const BATTLESHIP = `<svg class="fl-art" viewBox="0 0 220 56" width="220" height="56">
  <path d="M2 41L20 43.5L199 45.5L216 44.5L213 50L205 56H11Z"/>
  <rect x="52" y="38" width="12" height="6"/><rect x="150" y="38" width="12" height="6"/>
  <rect x="30" y="38" width="17" height="6" rx="1.5"/><rect x="16" y="39.6" width="16" height="1.6"/>
  <rect x="49" y="33" width="17" height="6" rx="1.5"/><rect x="34" y="34.6" width="17" height="1.6"/>
  <path d="M70 44V30H72V22H74V15H76V9H79V2H80.4V9H84V15H86V22H88V30H90V44Z"/>
  <rect x="67" y="29" width="26" height="1.4"/><rect x="70" y="21" width="20" height="1.4"/><rect x="73" y="14.4" width="14" height="1.2"/>
  <path d="M99 44L101 22H112L113 44Z"/><rect x="100.5" y="20.6" width="12" height="2"/>
  <rect x="118" y="35" width="22" height="9"/><path d="M126.5 35L129.5 13H131.5L134.5 35Z"/><rect x="124" y="19" width="14" height="1.2"/>
  <rect x="147" y="33" width="17" height="6" rx="1.5"/><rect x="162" y="34.6" width="17" height="1.6"/>
  <rect x="168" y="38" width="17" height="6" rx="1.5"/><rect x="183" y="39.6" width="16" height="1.6"/></svg>`;
const DESTROYER = `<svg class="fl-art" viewBox="0 0 120 34" width="120" height="34">
  <path d="M0 23L12 25.5L108 27.5L119 27L116 31L111 34H7Z"/>
  <rect x="6" y="20" width="8" height="6" rx="1"/><rect x="0" y="21.6" width="8" height="1.2"/>
  <rect x="20" y="15" width="13" height="11"/><rect x="26" y="3" width="1.2" height="12"/><rect x="22" y="7" width="9" height="1"/>
  <path d="M42 26L43.5 13H51L52 26Z"/><path d="M57 26L58.5 14H66L67 26Z"/>
  <rect x="74" y="21" width="16" height="6"/><rect x="96" y="21" width="8" height="6" rx="1"/><rect x="103" y="22.6" width="8" height="1.2"/></svg>`;
function warScene() {
  const s = scene('fl-war');
  // 水平線の向こうから上がる黒い煙。根もとは火の明かりでゆらぎ、上は風で右へ流れる
  const column = (right, k, seed) => source({ right: px(right), bottom: '0px' }, node('i', 'fl-fire', { '--delay': `${-seed * 0.7}s`, '--k': k }),
    smoke(18, { life: 8 * k, dx: 92 * k, dy: -82 * k, s0: 0.75, s1: 3.8, o: 0.9, size: 20 * k, seed }));
  // 艦の煙突から流れる煙
  const ship = (markup, w, hgt, right, scale, funnels, seed) => {
    const e = node('div', 'fl-ship', { right: px(right), bottom: '0px', width: px(w), height: px(hgt), scale });
    e.append(art(markup), ...funnels.map(([x, y], i) => source({ left: px(x), top: px(y) },
      smoke(8, { life: 4.4, dx: 54, dy: -14, s0: 0.3, s1: 2.2, o: 0.62, size: 10, cls: 'is-light', seed: seed + i }))));
    return e;
  };
  // 艦と艦のすき間に煙の柱を立てる（艦の真後ろに立てると、艦から光が出ているように見える）
  s.stage.append(
    node('div', 'fl-glow'),
    column(290, 1, 5), column(520, 1.12, 7), column(790, 0.72, 11),
    ship(BATTLESHIP, 220, 56, 560, 0.62, [[106.5, 20]], 13),
    ship(DESTROYER, 120, 34, 330, 0.9, [[47, 13], [62, 14]], 17),
    ship(BATTLESHIP, 220, 56, 40, 0.86, [[106.5, 20]], 23),
  );
  return s;
}

// ---------- 高度経済成長期・昭和後期：工場の煙突と関門橋 ----------
// 関門橋：1968年3月に着工、1973年11月14日に開通
const BRIDGE_START = 1968 + 2 / 12;
const BRIDGE_OPEN = 1973 + (10 + 13 / 30) / 12;
const CHIMNEYS = [[40, 12], [92, 4], [136, 20], [218, 10]]; // 煙突の x と、てっぺんの y
const FACTORY_SVG = `<svg class="fl-art" viewBox="0 0 240 70" width="240" height="70">
  ${CHIMNEYS.map(([x, y]) => `<path d="M${x - 4} 70L${x - 2.4} ${y}H${x + 2.4}L${x + 4} 70Z"/><rect x="${x - 3.2}" y="${y}" width="6.4" height="2"/>`).join('')}
  <path d="M0 70V50${Array.from({ length: 10 }, (_, i) => `L${20 * (i + 1)} 58${i < 9 ? 'V50' : ''}`).join('')}V70Z"/>
  <rect x="200" y="44" width="36" height="26"/></svg>`;
// 遠くの工場街（低い建物の並びに、細い煙突とガスタンク）。関門橋より奥にあるので、色を薄くする
const FAR_CHIMNEYS = [[130, 6], [370, 10], [540, 3]];
function farSvg() {
  let r = 41;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  let d = 'M0 40', x = 0;
  while (x < 600) {
    const w = 10 + Math.round(rnd() * 24);
    d += `V${(40 - (rnd() < 0.15 ? 2 : 4 + Math.round(rnd() * 9))).toFixed(0)}H${Math.min(600, x + w)}`;
    x += w;
  }
  d += 'V40Z';
  return `<svg class="fl-art" viewBox="0 0 600 40" width="600" height="40"><path d="${d}"/>
    ${FAR_CHIMNEYS.map(([cx, y]) => `<path d="M${cx - 1.8} 40L${cx - 1.1} ${y}H${cx + 1.1}L${cx + 1.8} 40Z"/>`).join('')}
    <path d="M400 40V25Q413 20 426 25V40Z"/><circle cx="196" cy="27" r="7.5"/><rect x="190" y="30" width="12" height="10"/></svg>`;
}
function bridgeSvg() {
  // 中央の径間 712m・側径間 178m・塔の高さ 141m の比をおおよそ保つ
  const W = 400, deck = 41, top = 8, t1 = 70, t2 = 330, sag = 38, a1 = 5, a2 = 395, end = 39;
  const c = 2 * sag - top; // 2次ベジェの制御点。塔と塔の真ん中にあるので、x と曲線の進み具合が比例する
  const yMain = (x) => { const t = (x - t1) / (t2 - t1); return (1 - t) ** 2 * top + 2 * t * (1 - t) * c + t * t * top; };
  const cs = (top + end) / 2 + 7; // 側径間のケーブルのたるみ
  const ySide = (x) => { const t = (x - a1) / (t1 - a1); return (1 - t) ** 2 * end + 2 * t * (1 - t) * cs + t * t * top; };
  const hangers = [];
  for (let x = t1 + 8; x < t2 - 4; x += 8) hangers.push(`M${x} ${yMain(x).toFixed(1)}V${deck}`);
  for (let x = a1 + 8; x < t1 - 3; x += 8) hangers.push(`M${x} ${ySide(x).toFixed(1)}V${deck}`, `M${W - x} ${ySide(x).toFixed(1)}V${deck}`);
  return `<svg class="fl-art" viewBox="0 0 ${W} 66" width="${W}" height="66">
    <g class="br-tower"><rect x="${t1 - 2.5}" y="${top - 2}" width="5" height="${66 - top + 2}"/><rect x="${t2 - 2.5}" y="${top - 2}" width="5" height="${66 - top + 2}"/>
      <rect x="${t1 - 5}" y="58" width="10" height="8"/><rect x="${t2 - 5}" y="58" width="10" height="8"/>
      <rect x="0" y="36" width="12" height="30"/><rect x="${W - 12}" y="36" width="12" height="30"/></g>
    <g class="br-span"><rect x="0" y="${deck - 1}" width="${W}" height="3"/>
      <path class="br-cable" d="M${t1} ${top}Q${(t1 + t2) / 2} ${c} ${t2} ${top}M${a1} ${end}Q${(a1 + t1) / 2} ${cs} ${t1} ${top}M${a2} ${end}Q${(a2 + t2) / 2} ${cs} ${t2} ${top}"/>
      <path class="br-hanger" d="${hangers.join('')}"/></g></svg>`;
}
function chimneyScene() {
  const s = scene('fl-chim');
  const factory = node('div', 'fl-factory', { right: '24px', bottom: '0px', width: '240px', height: '70px' });
  factory.append(art(FACTORY_SVG), ...CHIMNEYS.map(([x, y], i) => source({ left: px(x), top: px(y) },
    smoke(12, { life: 6.4 + i * 0.5, dx: -124, dy: -12, s0: 0.35, s1: 3.1, o: 0.42, size: 13, seed: 29 + i }))));
  const bridge = node('div', 'fl-bridge', { right: '296px', bottom: '0px', width: '400px', height: '66px' });
  bridge.append(art(bridgeSvg()));
  const far = node('div', 'fl-far', { right: '270px', bottom: '0px', width: '600px', height: '40px' });
  far.append(art(farSvg()), ...FAR_CHIMNEYS.map(([x, y], i) => source({ left: px(x), top: px(y) },
    smoke(10, { life: 7.5 + i * 0.6, dx: -96, dy: -8, s0: 0.3, s1: 2.6, o: 0.3, size: 10, cls: 'is-far', seed: 37 + i }))));
  s.stage.append(node('div', 'fl-glow'), far, bridge, factory);
  let stage = -1, smog = -1;
  return {
    ...s,
    update(era, year) {
      const st = year >= BRIDGE_OPEN ? 2 : year >= BRIDGE_START ? 1 : 0; // 0 まだない・1 工事中（塔だけ）・2 開通
      if (st !== stage) { stage = st; bridge.dataset.stage = st; }
      // 煙は 1970 年ごろから薄くなる（公害対策で空が戻っていく）
      const k = Math.round(Math.min(1, Math.max(0.4, 1 - ((year - 1970) / 15) * 0.6)) * 20) / 20;
      if (k !== smog) { smog = k; s.el.style.setProperty('--smog', k); }
    },
  };
}

// ---------- 幕末・明治：ゆかりの人物 ----------
function portraitScene() {
  return scene('fl-people');
}

const BUILD = { clouds: cloudScene, portraits: portraitScene, locomotive: trainScene, warships: warScene, chimneys: chimneyScene };

export function createFlavor(app) {
  const root = document.getElementById('flavor');
  const title = document.getElementById('title');
  const map = document.getElementById('map');
  // 題字はスマホでは「名前」と「時代名・年」の2行に分かれるので、3つとも測る
  const words = ['.title-name', '.title-era', '.title-year'].map((q) => title.querySelector(q));
  const body = document.body;
  const scenes = new Map();
  let cur = null, w = 0;

  // 帯の左端はタイトルの文字の右、右端は右上のボタン（新規登録・共有）の手前（ボタンがなければ地図の窓の右）。
  // 時代名・書体・画面の幅・ボタンの幅（登録して名前に変わる）が変わるたびに測り直す
  const actions = title.querySelector('.title-actions');
  function layout() {
    const left = Math.round(Math.max(...words.map((e) => e.getBoundingClientRect().right)) + 20);
    const right = Math.round(actions?.offsetWidth ? actions.getBoundingClientRect().left - 16 : map.getBoundingClientRect().right);
    const s = title.offsetHeight / H;
    const room = Math.max(0, right - left);
    root.style.setProperty('--fl-left', px(left));
    root.style.setProperty('--fl-right', px(root.clientWidth - right));
    root.style.setProperty('--fl-s', s.toFixed(4));
    root.classList.toggle('is-cramped', room < 72);
    const nw = room / s;
    root.style.setProperty('--fl-w', px(nw.toFixed(1)));
    if (Math.abs(nw - w) > 0.5) { w = nw; for (const sc of scenes.values()) sc.layout?.(w); }
  }

  function build(key) {
    const make = BUILD[key];
    if (!make) return null;
    const sc = make();
    root.append(sc.el);
    sc.layout?.(w);
    scenes.set(key, sc);
    return sc;
  }
  function show(key) {
    const next = key ? scenes.get(key) ?? build(key) : null;
    if (next === cur) return;
    if (cur) {
      const old = cur;
      old.el.classList.remove('is-on');
      clearTimeout(old.timer);
      old.timer = setTimeout(() => { if (old !== cur) old.el.hidden = true; }, 460); // 消えてから止める
    }
    cur = next;
    if (!cur) return;
    clearTimeout(cur.timer);
    if (cur.el.hidden) {
      cur.el.hidden = false;
      cur.enter?.();
      void cur.el.offsetWidth; // 表示してから is-on を付けて、ふわっと出す
    }
    cur.el.classList.add('is-on');
  }

  // 冒頭の流しの間は出さない
  function sync() {
    show(body.classList.contains('is-intro') ? null : app.era?.flavor);
    cur?.update?.(app.era, app.year);
  }
  app.on('era', sync);
  app.on('t', () => cur?.update?.(app.era, app.year));
  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['class'] });
  const ro = new ResizeObserver(layout);
  for (const e of [title, ...words, map, actions]) if (e) ro.observe(e);
  layout();
  sync();
}

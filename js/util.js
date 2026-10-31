// 小さな共通の道具
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (k) => k * k * (3 - 2 * k);
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// 要素を作る。attrs の text は textContent、class は className、on〜 はイベント
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
export function svg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// 年の見出し（「前14000年」「1914年」）
export const yearText = (label) => (/[年頃紀]/.test(label) ? label : `${label}年`);

// ガイドの決済（デモ）は、その史跡ごとに1時間だけ覚えておく
const PAID_MS = 60 * 60 * 1000;
const paidAt = new Map(); // localStorage が使えない環境でも、ページを開いている間は覚えておく
export function setPaid(id) {
  const now = Date.now();
  paidAt.set(id, now);
  try { localStorage.setItem(`moji.paid.${id}`, String(now)); } catch { /* 保存できない環境では、その場かぎり */ }
}
// 決済が切れる時刻（決済していない・切れたときは 0）
export function paidUntil(id) {
  let t = paidAt.get(id) ?? 0;
  try { t = Math.max(t, Number(localStorage.getItem(`moji.paid.${id}`)) || 0); } catch { /* 同上 */ }
  return Date.now() - t < PAID_MS ? t + PAID_MS : 0;
}
export const isPaid = (id) => paidUntil(id) > 0;

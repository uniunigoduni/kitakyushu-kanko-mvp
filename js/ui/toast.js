// 地図の窓の下の端に、ひとことだけ出して消す（「デモのため動きません」など）。読み上げにも渡す
import { h } from '../util.js';

const el = h('div', { class: 'toast', role: 'status' });
document.body.append(el);
let timer = 0;

export function toast(text, ms = 2600) {
  clearTimeout(timer);
  el.textContent = text;
  el.classList.remove('is-on');
  void el.offsetWidth; // 続けて出したときも、もう一度ふわっと出す
  el.classList.add('is-on');
  timer = setTimeout(() => el.classList.remove('is-on'), ms);
}

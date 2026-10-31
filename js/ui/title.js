// タイトル「門司ヒストリーマップ 現代」。時代名・年・書体を差し替える。
// 冒頭の流しの間は回転ドラムのように、ぼかしながら上から送る。
import { formatYear } from '../eras.js';

export function createTitle(root = document.getElementById('title')) {
  const eraEl = root.querySelector('.title-era');
  const yearEl = root.querySelector('.title-year');
  const body = document.body;
  let era = null, yearStr = '', spinning = false;

  function setEra(e) {
    if (e === era) return;
    const first = !era;
    era = e;
    eraEl.textContent = e.name;
    body.classList.remove('font-brush', 'font-mincho', 'font-gothic');
    body.classList.add('font-' + e.font);
    document.title = `門司ヒストリーマップ ${e.name}`;
    if (spinning && !first) {
      eraEl.animate([{ transform: 'translateY(-42%)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 90, easing: 'ease-out' });
    }
  }

  function setYear(y) {
    const s = `${formatYear(y)}年`;
    if (s === yearStr) return;
    yearStr = s;
    yearEl.textContent = s;
  }

  // on=false で止めるとき、少し行き過ぎてから戻る
  function spin(on) {
    if (on === spinning) return;
    spinning = on;
    eraEl.classList.toggle('spin', on);
    yearEl.classList.toggle('spin', on);
    if (!on) {
      eraEl.animate(
        [{ transform: 'translateY(-30%)' }, { transform: 'translateY(5%)', offset: 0.62 }, { transform: 'none' }],
        { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }

  return { setEra, setYear, spin };
}

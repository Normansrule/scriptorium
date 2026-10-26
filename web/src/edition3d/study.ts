/**
 * Study mode: the desk (or a chapter) as a deck of practice cards. Each card asks before it tells:
 * an equation shows its idea and asks for the equation; a figure shows the picture and asks what it
 * shows; a self-check asks its question; an explorable asks its question and then says what to
 * notice. "Again" puts a card back a few places later, "Got it" retires it: a short version of
 * retrieval practice, one of the best-supported study techniques (see docs/LEARNING_DESIGN.md).
 */
import type { Item } from './items.ts';
import { cutOut, studyable } from './items.ts';
import type { BookModel } from './book.ts';
import { ICON } from './icons.ts';
import { KIND } from './kinds.ts';
import { checkContent, chip, el, type Modal } from './panel.ts';

interface Card {
  item: Item;
  tries: number;
}

export function startStudy(modal: Modal, model: BookModel, all: Item[], from: HTMLElement | null, onOpenItem: (it: Item) => void, source = 'your desk'): void {
  const items = all.filter(studyable);
  if (!items.length) return;
  // a fair mix: shuffle once, so related items are not always back to back
  const deck: Card[] = items.map((item) => ({ item, tries: 0 })).sort(() => Math.random() - 0.5);
  let done = 0;
  let firstTime = 0;
  const total = deck.length;

  modal.open({
    kicker: 'Study',
    title: `${total} card${total === 1 ? '' : 's'} from ${source}`,
    variant: 'study',
    from,
    build: (body) => {
      const bar = el('div', { class: 'study-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total) });
      const fill = el('span');
      bar.append(fill);
      const stage = el('div', { class: 'study-stage' });
      body.append(bar, stage);

      const show = () => {
        bar.setAttribute('aria-valuenow', String(done));
        fill.style.width = `${(done / total) * 100}%`;
        stage.innerHTML = '';
        const card = deck[0];
        if (!card) {
          finish();
          return;
        }
        render(card);
      };

      const finish = () => {
        const end = el('div', { class: 'study-end' });
        end.append(el('p', { class: 'study-big' }, `${firstTime} of ${total} on the first try`), el('p', {}, firstTime === total ? 'Every card, first time. Try a harder chapter, or come back tomorrow: a day’s gap makes it stick.' : 'The ones you missed came back until you had them. Come back tomorrow and go through the desk once more.'));
        const again = el('button', { type: 'button', class: 'btn primary', 'data-autofocus': '' }, 'Go through it again');
        again.addEventListener('click', () => startStudy(modal, model, items, from, onOpenItem, source));
        end.append(again);
        stage.append(end);
        again.focus();
      };

      const grade = (ok: boolean) => {
        const card = deck.shift()!;
        if (ok) {
          done++;
          if (card.tries === 0) firstTime++;
        } else {
          card.tries++;
          deck.splice(Math.min(deck.length, 2), 0, card); // see it again soon, not straight away
        }
        show();
      };

      const render = (card: Card) => {
        const it = card.item;
        const face = el('article', { class: 'study-card' });
        face.style.setProperty('--kind', KIND[it.kind].color);
        const top = el('div', { class: 'study-top' });
        top.append(chip(it.kind, it.name));
        if (card.tries) top.append(el('span', { class: 'study-again' }, 'again'));
        face.append(top);
        const front = el('div', { class: 'study-front' });
        const back = el('div', { class: 'study-back', hidden: '' });
        const actions = el('div', { class: 'study-actions' });
        const flip = el('button', { type: 'button', class: 'btn primary', 'data-autofocus': '' });
        flip.innerHTML = `${ICON.flip}<span>Show the answer</span>`;
        const again = el('button', { type: 'button', class: 'btn' }, 'Again');
        const got = el('button', { type: 'button', class: 'btn primary' }, 'Got it');
        again.hidden = got.hidden = true;
        again.addEventListener('click', () => grade(false));
        got.addEventListener('click', () => grade(true));
        const reveal = () => {
          back.hidden = false;
          flip.hidden = true;
          again.hidden = got.hidden = false;
          face.classList.add('flipped');
          got.focus();
        };
        flip.addEventListener('click', reveal);
        const open = el('button', { type: 'button', class: 'btn ghost' }, 'Open it in the book');
        open.addEventListener('click', () => {
          modal.close();
          onOpenItem(it);
        });

        const picture = async (into: HTMLElement) => {
          const c = await cutOut(model, it, 900);
          if (!c) return;
          const img = el('img', { alt: `${it.name}, as printed` });
          img.src = c.toDataURL('image/png');
          into.append(img);
        };

        switch (it.ref.kind) {
          case 'equation': {
            const e = it.ref.data;
            front.append(el('p', { class: 'study-q' }, e.intuition), el('p', { class: 'study-hint' }, 'Write or say the equation, with what each symbol means. Then check.'));
            void picture(back);
            back.append(el('p', { class: 'study-a' }, e.symbols.map((s) => `${s.symbol}: ${s.meaning}${s.unit && s.unit !== '— (no unit)' ? ` (${s.unit})` : ''}`).join(' · ')));
            break;
          }
          case 'figure':
          case 'model':
          case 'scene': {
            const f = it.ref.data;
            const pic = el('div', { class: 'study-pic' });
            void picture(pic);
            front.append(pic, el('p', { class: 'study-hint' }, 'What is this figure’s one takeaway? Say it in a sentence, then check.'));
            back.append(el('p', { class: 'study-a' }, f.caption));
            break;
          }
          case 'explore': {
            const x = it.ref.data.block as { prompt?: string; notice?: string };
            front.append(el('p', { class: 'study-q' }, x.prompt ?? it.title), el('p', { class: 'study-hint' }, 'Predict the answer first. Then check, or open it and drag the sliders.'));
            back.append(el('p', { class: 'study-a' }, x.notice ?? ''));
            break;
          }
          case 'check': {
            checkContent(front, it.ref.data, (right) => {
              // a self-check grades itself: the reason shows, and the reader moves on
              flip.hidden = true;
              again.hidden = got.hidden = false;
              (right ? got : again).focus();
            });
            flip.hidden = true;
            break;
          }
        }
        face.append(front, back);
        actions.append(flip, again, got, open);
        face.append(actions);
        stage.append(face);
        (flip.hidden ? (face.querySelector('button') as HTMLElement) : flip).focus({ preventScroll: true });
        face.addEventListener('keydown', (e) => {
          if (e.key === ' ' && !flip.hidden && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            reveal();
          }
        });
      };
      show();
    },
  });
}

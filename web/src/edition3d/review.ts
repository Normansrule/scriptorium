/**
 * Spaced review for study mode: a Leitner system. Each kept card sits in a box from 1 to 5; a card
 * answered right first time moves up a box and waits longer before it comes back (1, 2, 4, 8 then
 * 16 days), a miss sends it back to box 1. Spreading reviews out like this, and testing yourself
 * rather than rereading, are the two study techniques with the strongest evidence behind them
 * (see docs/LEARNING_DESIGN.md).
 *
 * Days are the reader's calendar days, so "tomorrow" means tomorrow morning, not 24 hours later.
 * Records stay in this browser (localStorage, per book), like the desk itself.
 */
import type { Item } from './items.ts';

/** Days until a card in box n comes back (index = box; box 0 is unused). */
export const INTERVALS = [0, 1, 2, 4, 8, 16] as const;
export const TOP_BOX = INTERVALS.length - 1;

export interface ReviewRecord {
  box: number;
  /** calendar day (see dayNumber) when it is next due */
  due: number;
}

/** The local calendar day of a time, as a whole number of days since 1970-01-01. */
export function dayNumber(t: number): number {
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export class ReviewStore {
  private records = new Map<string, ReviewRecord>();

  constructor(
    private storageKey: string,
    private now: () => number = () => Date.now(),
  ) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          const r = v as Partial<ReviewRecord> | null;
          if (r && Number.isInteger(r.box) && Number.isInteger(r.due) && r.box! >= 1 && r.box! <= TOP_BOX) this.records.set(k, { box: r.box!, due: r.due! });
        }
      }
    } catch {
      this.records.clear(); // a broken record starts fresh, never an error
    }
  }

  get today(): number {
    return dayNumber(this.now());
  }

  get(key: string): ReviewRecord | undefined {
    return this.records.get(key);
  }

  /** New cards (never studied) are due, and so is any card whose day has come. */
  isDue(key: string): boolean {
    const r = this.records.get(key);
    return !r || r.due <= this.today;
  }

  due(items: Item[]): Item[] {
    return items.filter((i) => this.isDue(i.key));
  }

  /** Days until the card is next due (0 = today, or new). */
  daysLeft(key: string): number {
    const r = this.records.get(key);
    return r ? Math.max(0, r.due - this.today) : 0;
  }

  /**
   * Record a card retired in a study session. Only a due card counts (practising ahead never moves
   * a card): right first time moves it up a box, anything else sends it back to box 1.
   */
  grade(key: string, firstTry: boolean): ReviewRecord | undefined {
    if (!this.isDue(key)) return this.records.get(key);
    const prev = this.records.get(key)?.box ?? 0;
    const box = firstTry ? Math.min(TOP_BOX, prev + 1) : 1;
    const rec = { box, due: this.today + INTERVALS[box]! };
    this.records.set(key, rec);
    this.save();
    return rec;
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this.records)));
    } catch {
      /* storage blocked: the schedule lasts for this visit */
    }
  }
}

/** "today", "tomorrow", "in 4 days". */
export function whenText(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

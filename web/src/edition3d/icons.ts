/** Drawn icons (one stroke weight, 24 px grid), never glyphs or emoji. */
const path = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;

export const ICON = {
  prev: path('<path d="M15 5l-7 7 7 7"/>'),
  next: path('<path d="M9 5l7 7-7 7"/>'),
  close: path('<path d="M6 6l12 12M18 6L6 18"/>'),
  lift: path('<path d="M4 15l8 4 8-4"/><path d="M4 11l8 4 8-4-8-4z"/><path d="M12 3v4"/>'),
  cube: path('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  cut: path('<path d="M4 20L20 4"/><path d="M5 9h6v6"/><rect x="11" y="11" width="8" height="8" rx="1"/>'),
  explode: path('<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 9v3M9 15l-1.5 1M15 15l1.5 1"/>'),
  xray: path('<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16" stroke-dasharray="2 2.5"/>'),
  labels: path('<path d="M4 6h10l4 4-4 4H4z"/><path d="M4 18h9"/>'),
  play: path('<path d="M8 5l11 7-11 7z"/>'),
  pause: path('<path d="M8 5v14M16 5v14"/>'),
  reset: path('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>'),
  book: path('<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13"/>'),
  sliders: path('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  info: path('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'),
};

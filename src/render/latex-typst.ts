/**
 * Converts the LaTeX math subset used in books to Typst math, so print equations are
 * real typeset text (searchable, selectable), not images.
 *
 * Supported: \frac \tfrac \dfrac (braced or single-token arguments), \sqrt, ^ and _ with
 * braced or single-token arguments, \text \mathrm \operatorname, \left \right,
 * \lvert \rvert, spacing (\, \; \! \quad), Greek letters, common operators and functions.
 * Anything else throws, and tests/unit/book.test.ts converts every equation in the
 * examples, so an unsupported command fails CI instead of printing wrong.
 */

const GREEK = [
  'alpha', 'beta', 'gamma', 'delta', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
];

const SYMBOLS: Record<string, string> = {
  varepsilon: 'epsilon',
  epsilon: 'epsilon.alt',
  varphi: 'phi',
  phi: 'phi.alt',
  vartheta: 'theta.alt',
  times: 'times',
  cdot: 'dot.op',
  approx: 'approx',
  le: '<=',
  leq: '<=',
  ge: '>=',
  geq: '>=',
  ne: '!=',
  neq: '!=',
  pm: 'plus.minus',
  infty: 'infinity',
  to: '->',
  rightarrow: '->',
  Rightarrow: '=>',
  implies: '==>',
  leftarrow: '<-',
  rightleftharpoons: 'harpoons.rtlb',
  propto: 'prop',
  parallel: 'parallel',
  degree: 'degree',
  circ: 'circle.stroked.tiny',
  partial: 'partial',
  lvert: '|',
  rvert: '|',
  vert: '|',
  ',': 'thin',
  ';': 'med',
  ':': 'med',
  '!': '',
  ' ': 'space',
  quad: 'quad',
  qquad: 'wide',
  '%': '%',
  '{': '{',
  '}': '}',
  left: '',
  right: '',
  displaystyle: '',
};

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const FUNCS = new Set(['ln', 'log', 'exp', 'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'max', 'min', 'lim']);

type Tok = { k: 'cmd'; v: string } | { k: 'open' } | { k: 'close' } | { k: 'char'; v: string } | { k: 'num'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      const m = src.slice(i + 1).match(/^([A-Za-z]+|.)/);
      if (!m) throw new Error(`Dangling backslash in "${src}"`);
      out.push({ k: 'cmd', v: m[1]! });
      i += 1 + m[1]!.length;
    } else if (c === '{') {
      out.push({ k: 'open' });
      i++;
    } else if (c === '}') {
      out.push({ k: 'close' });
      i++;
    } else if (/[0-9]/.test(c)) {
      const m = src.slice(i).match(/^[0-9]+(?:\.[0-9]+)?/)!;
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
    } else if (/\s/.test(c)) {
      i++;
    } else {
      out.push({ k: 'char', v: c });
      i++;
    }
  }
  return out;
}

const SPACE_MARK = '\u0001';

export function latexToTypst(latex: string): string {
  // Keep spaces inside \text{...} (the tokenizer drops whitespace everywhere else).
  const src = latex.replace(/\\(text|mathrm|textrm|operatorname)\{([^{}]*)\}/g, (_m, c: string, t: string) => `\\${c}{${t.replace(/ /g, SPACE_MARK)}}`);
  const toks = tokenize(src);
  let p = 0;

  /** One argument: a braced group, or a single token (digits split so \tfrac12 works). */
  function arg(): string {
    const t = toks[p];
    if (!t) throw new Error(`Missing argument in "${latex}"`);
    if (t.k === 'open') {
      p++;
      return seq(true);
    }
    if (t.k === 'num' && t.v.length > 1 && !t.v.includes('.')) {
      // \tfrac12 → numerator 1, and leave "2" for the next argument
      toks[p] = { k: 'num', v: t.v.slice(1) };
      return t.v[0]!;
    }
    return atom();
  }

  function textArg(): string {
    const t = toks[p];
    if (!t || t.k !== 'open') throw new Error(`\\text needs a braced argument in "${latex}"`);
    p++;
    let depth = 1;
    let s = '';
    while (p < toks.length) {
      const u = toks[p++]!;
      if (u.k === 'open') depth++;
      else if (u.k === 'close' && --depth === 0) break;
      s += u.k === 'char' ? (u.v === SPACE_MARK ? ' ' : u.v) : u.k === 'num' ? u.v : u.k === 'cmd' ? (u.v === ' ' || u.v === ',' ? ' ' : u.v) : '';
    }
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function atom(): string {
    const t = toks[p++]!;
    switch (t.k) {
      case 'num':
        return t.v;
      case 'char':
        if (t.v === '/') return '\\/';
        if (/[A-Za-z]/.test(t.v)) return t.v;
        if ('()[]|+-=<>,.!\''.includes(t.v)) return t.v;
        throw new Error(`Unsupported character "${t.v}" in "${latex}"`);
      case 'open':
        return `(${seq(true)})`;
      case 'close':
        throw new Error(`Unbalanced "}" in "${latex}"`);
      case 'cmd': {
        const v = t.v;
        if (v === 'frac' || v === 'tfrac' || v === 'dfrac') {
          const a = arg();
          const b = arg();
          return `frac(${a}, ${b})`;
        }
        if (v === 'sqrt') return `sqrt(${arg()})`;
        if (v === 'text' || v === 'mathrm' || v === 'operatorname' || v === 'textrm') return textArg();
        if (GREEK.includes(v)) return v;
        if (FUNCS.has(v)) return v;
        if (own(SYMBOLS, v)) return SYMBOLS[v]!;
        throw new Error(`Unsupported LaTeX command \\${v} in "${latex}"`);
      }
    }
  }

  function seq(untilClose: boolean): string {
    const parts: string[] = [];
    while (p < toks.length) {
      const t = toks[p]!;
      if (t.k === 'close') {
        if (untilClose) {
          p++;
          return mergeUnits(parts.filter((x) => x !== '')).join(' ');
        }
        throw new Error(`Unbalanced "}" in "${latex}"`);
      }
      if (t.k === 'char' && (t.v === '^' || t.v === '_')) {
        p++;
        const a = arg();
        const prev = parts.pop() ?? '""';
        parts.push(`${prev}${t.v}(${a})`);
        continue;
      }
      parts.push(atom());
    }
    if (untilClose) throw new Error(`Unclosed "{" in "${latex}"`);
    return mergeUnits(parts.filter((x) => x !== '')).join(' ');
  }

  return seq(false).replace(/\s+/g, ' ').trim();
}

/**
 * Units: "\mu\text{F}" and "\text{k}\Omega" typeset as one upright unit ("µF", "kΩ"),
 * so print shows 4.7 µF rather than an italic µ spaced away from the F.
 */
const UNIT_SYMBOL: Record<string, string> = { mu: 'µ', Omega: 'Ω' };
function mergeUnits(parts: string[]): string[] {
  const out: string[] = [];
  const isText = (x: string | undefined) => x !== undefined && /^"(?:[^"\\]|\\.)*"$/.test(x);
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i]!;
    const next = parts[i + 1];
    if (own(UNIT_SYMBOL, cur) && isText(next)) {
      parts[i + 1] = `"${UNIT_SYMBOL[cur]}${next!.slice(1)}`;
      continue;
    }
    const last = out[out.length - 1];
    if (own(UNIT_SYMBOL, cur) && isText(last)) {
      out[out.length - 1] = `${last!.slice(0, -1)}${UNIT_SYMBOL[cur]}"`;
      continue;
    }
    out.push(cur);
  }
  return out;
}

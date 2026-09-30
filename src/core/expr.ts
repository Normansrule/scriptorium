/**
 * A tiny, safe expression language for code-drawn plots.
 *
 * The model may *propose* a plot (stage 6) as data such as
 *   { "expr": "1 - exp(-x / tau)", "vars": { "tau": 1 } }
 * and this module evaluates it. It never calls eval() or Function(): it tokenizes and
 * parses a fixed grammar, so a hostile string can only fail to parse.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := '-' factor | power           (so -2^2 = -4, as in math)
 *   power  := atom ('^' factor)?           (right-associative)
 *   atom   := number | name | name '(' expr ')' | '(' expr ')'
 */

const FUNCS: Record<string, (x: number) => number> = {
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  atan: Math.atan,
  abs: Math.abs,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type Tok = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  if (src.length > 300) throw new Error('Expression too long.');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][-+]?\d+)?/);
      if (!m) throw new Error(`Bad number at ${i}.`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      out.push({ t: 'name', v: m[0] });
      i += m[0].length;
    } else if ('+-*/^()'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}".`);
    }
  }
  return out;
}

export type Compiled = (vars: Record<string, number>) => number;

export function compile(src: string): Compiled {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p++];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`Expected "${v ?? 'token'}" in "${src}".`);
    return t;
  };

  function expr(): Compiled {
    let left = term();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = eat().v;
      const l = left;
      const r = term();
      left = op === '+' ? (v) => l(v) + r(v) : (v) => l(v) - r(v);
    }
    return left;
  }
  function term(): Compiled {
    let left = factor();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = eat().v;
      const l = left;
      const r = factor();
      left = op === '*' ? (v) => l(v) * r(v) : (v) => l(v) / r(v);
    }
    return left;
  }
  function factor(): Compiled {
    if (peek()?.t === 'op' && peek()!.v === '-') {
      eat('-');
      const u = factor();
      return (v) => -u(v);
    }
    const base = atom();
    if (peek()?.t === 'op' && peek()!.v === '^') {
      eat('^');
      const ex = factor();
      return (v) => base(v) ** ex(v);
    }
    return base;
  }
  function atom(): Compiled {
    const t = eat();
    if (t.t === 'num') {
      const n = t.v;
      return () => n;
    }
    if (t.t === 'name') {
      if (peek()?.t === 'op' && peek()!.v === '(') {
        const fn = own(FUNCS, t.v) ? FUNCS[t.v] : undefined;
        if (!fn) throw new Error(`Unknown function "${t.v}".`);
        eat('(');
        const arg = expr();
        eat(')');
        return (v) => fn(arg(v));
      }
      const name = t.v;
      if (own(CONSTS, name)) return () => CONSTS[name]!;
      return (v) => {
        if (!own(v, name)) throw new Error(`Unknown variable "${name}".`);
        return v[name]!;
      };
    }
    if (t.v === '(') {
      const e = expr();
      eat(')');
      return e;
    }
    throw new Error(`Unexpected "${t.v}" in "${src}".`);
  }

  const fn = expr();
  if (p !== toks.length) throw new Error(`Unexpected trailing input in "${src}".`);
  return fn;
}

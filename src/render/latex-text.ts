/**
 * LaTeX → plain Unicode text, for places that cannot typeset maths: the 3D Edition's caption
 * panel, alt text, screen-reader announcements. Covers the small subset captions use (symbols,
 * \mathrm, \text, fractions, powers and indices); anything else keeps its LaTeX spelling, which is
 * still readable.
 */

const SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', approx: '≈', sim: '∼', propto: '∝', neq: '≠', ne: '≠', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', implies: '⇒', infty: '∞', partial: '∂', nabla: '∇', degree: '°', circ: '°',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'µ', nu: 'ν', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', omega: 'ω', Delta: 'Δ', Omega: 'Ω', Sigma: 'Σ', Phi: 'Φ', Lambda: 'Λ', Gamma: 'Γ', Theta: 'Θ',
  ln: 'ln', log: 'log', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', max: 'max', min: 'min', ldots: '…', cdots: '⋯', quad: ' ', qquad: '  ',
};
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ', i: 'ⁱ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋', '+': '₊', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', i: 'ᵢ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', n: 'ₙ', m: 'ₘ', k: 'ₖ' };

/** Superscript or subscript a short run if every character has a Unicode form; else ^(…) or _(…). */
function script(body: string, map: Record<string, string>, mark: '^' | '_'): string {
  const chars = [...body];
  if (chars.length && chars.every((c) => map[c])) return chars.map((c) => map[c]).join('');
  return body.length === 1 ? `${mark}${body}` : `${mark}(${body})`;
}

/** Read one argument: a {group} or a single character / command. Returns [text, rest]. */
function arg(s: string): [string, string] {
  s = s.replace(/^\s+/, '');
  if (s.startsWith('{')) {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) return [s.slice(1, i), s.slice(i + 1)];
    }
    return [s.slice(1), ''];
  }
  const cmd = s.match(/^\\[a-zA-Z]+/);
  if (cmd) return [cmd[0], s.slice(cmd[0].length)];
  return [s.slice(0, 1), s.slice(1)];
}

export function latexToText(latex: string): string {
  let out = '';
  let s = latex;
  while (s.length) {
    const c = s[0]!;
    if (c === '\\') {
      const m = s.match(/^\\([a-zA-Z]+|.)/)!;
      const name = m[1]!;
      s = s.slice(m[0].length);
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const [a, r1] = arg(s);
        const [b, r2] = arg(r1);
        s = r2;
        const wrap = (x: string) => (/^[\w.µ²³⁴]+$/u.test(x) ? x : `(${x})`);
        out += `${wrap(latexToText(a))}/${wrap(latexToText(b))}`;
      } else if (['mathrm', 'text', 'textrm', 'mathit', 'mathbf', 'boldsymbol', 'operatorname', 'mathsf'].includes(name)) {
        const [a, r] = arg(s);
        s = r;
        out += latexToText(a);
      } else if (name === 'sqrt') {
        const [a, r] = arg(s);
        s = r;
        out += `√(${latexToText(a)})`;
      } else if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'displaystyle') {
        // sizing only
      } else if (name === ',' || name === ';' || name === ':' || name === '!') {
        out += name === '!' ? '' : ' ';
      } else if (name === '%' || name === '$' || name === '{' || name === '}' || name === '_' || name === '&') {
        out += name;
      } else {
        out += SYMBOLS[name] ?? `\\${name}`;
      }
    } else if (c === '^' || c === '_') {
      const [a, r] = arg(s.slice(1));
      s = r;
      out += script(latexToText(a), c === '^' ? SUP : SUB, c);
    } else if (c === '{' || c === '}') {
      s = s.slice(1);
    } else if (c === '~') {
      out += ' ';
      s = s.slice(1);
    } else {
      out += c;
      s = s.slice(1);
    }
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s*([=<>≈≤≥∝])\s*/g, ' $1 ').trim();
}

// Runs the equation checks with whichever Python is available (PYTHON, .venv, python3, python).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const venv = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';
const candidates = [process.env.PYTHON, existsSync(venv) ? venv : undefined, 'python3', 'python'].filter(Boolean);
for (const py of candidates) {
  const probe = spawnSync(py, ['-c', 'import sympy, pint, pytest'], { stdio: 'ignore' });
  if (probe.status === 0) {
    const r = spawnSync(py, ['-m', 'pytest', '-q', 'tests/equations', ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
}
console.error('No Python with sympy, pint and pytest found. Run: python -m pip install -r requirements.txt');
process.exit(1);

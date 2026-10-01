import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Profile as DomainProfile } from '../../src/core/profile.ts';

const root = join(import.meta.dirname, '..', '..');

describe('domain profiles', () => {
  const files = readdirSync(join(root, 'profiles')).filter((f) => f.endsWith('.json'));
  it('ships the four documented profiles', () => {
    expect(files.sort()).toEqual(['biology.json', 'chemistry.json', 'engineering.json', 'medicine.json']);
  });
  for (const f of files) {
    it(`${f} parses and its citation style exists`, () => {
      const p = DomainProfile.parse(JSON.parse(readFileSync(join(root, 'profiles', f), 'utf8')));
      expect(p.id).toBe(f.replace('.json', ''));
      expect(existsSync(join(root, 'styles', `${p.citationStyle}.csl`))).toBe(true);
      expect(p.safetyNotes.length).toBeGreaterThan(0);
    });
  }
  it('medicine requires professional review', () => {
    const p = DomainProfile.parse(JSON.parse(readFileSync(join(root, 'profiles', 'medicine.json'), 'utf8')));
    expect(p.requiresProfessionalReview).toBe(true);
  });
});

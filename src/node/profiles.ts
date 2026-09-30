import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Profile } from '../core/profile.ts';

export function loadProfile(dir: string, id: string): Profile {
  return Profile.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8')));
}

export function listProfiles(dir: string): Profile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => Profile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

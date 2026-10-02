/**
 * Where the API key is kept between sessions.
 *
 *   Desktop app (Tauri): the operating system's keychain — Windows Credential Manager,
 *   macOS Keychain, or the Secret Service on Linux (GNOME Keyring, KWallet) — through three
 *   commands in src-tauri/src/lib.rs. The key never touches the webview's storage.
 *
 *   Browser: nothing by default (the key lives in memory for this tab). Only if the user
 *   ticks "Remember on this device" is it written to localStorage, unencrypted, which the
 *   settings screen says plainly.
 */
import { invoke } from '@tauri-apps/api/core';

export interface KeyStore {
  /** 'keychain' in the desktop app, 'browser' on the web */
  kind: 'keychain' | 'browser';
  load(): Promise<string>;
  save(key: string): Promise<void>;
  forget(): Promise<void>;
  /** true when a key is stored (not just held in memory) */
  hasStored(): Promise<boolean>;
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const BROWSER_KEY = 'scriptorium.apiKey';

const browserStore: KeyStore = {
  kind: 'browser',
  async load() {
    try {
      return localStorage.getItem(BROWSER_KEY) ?? '';
    } catch {
      return ''; // storage blocked: the key stays in memory for this tab
    }
  },
  async save(key) {
    try {
      localStorage.setItem(BROWSER_KEY, key);
    } catch {
      /* storage blocked */
    }
  },
  async forget() {
    try {
      localStorage.removeItem(BROWSER_KEY);
    } catch {
      /* storage blocked */
    }
  },
  async hasStored() {
    try {
      return !!localStorage.getItem(BROWSER_KEY);
    } catch {
      return false;
    }
  },
};

const keychainStore: KeyStore = {
  kind: 'keychain',
  async load() {
    return (await invoke<string | null>('key_get')) ?? '';
  },
  async save(key) {
    await invoke('key_set', { key });
  },
  async forget() {
    await invoke('key_delete');
  },
  async hasStored() {
    return !!(await invoke<string | null>('key_get'));
  },
};

export function keyStore(): KeyStore {
  return isDesktop() ? keychainStore : browserStore;
}

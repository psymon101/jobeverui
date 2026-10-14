// Persistent API-connection settings.
//
// Precedence (highest first):
//   1. saved settings file (written by the Settings page, atomic rename)
//   2. EVER_JOBS_API_URL environment variable (initial defaults)
//   3. built-in defaults
//
// The active settings object is held in memory and re-read on change, so a
// save takes effect on the very next proxied request — no restart needed.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateApiTarget, parseApiUrl } from './validate.js';

export const BUILT_IN_DEFAULTS = { protocol: 'http', host: '127.0.0.1', port: 3001 };

export class SettingsStore {
  /**
   * @param {string} filePath path to settings.json (persistent)
   * @param {Record<string,string|undefined>} env
   */
  constructor(filePath, env = process.env) {
    this.filePath = filePath;
    this.env = env;
    this.current = null; // { protocol, host, port }
    this.source = 'default'; // 'file' | 'env' | 'default'
    this.savedAt = null;
    this.connectionStatus = {
      state: 'unknown', // connected | disconnected | timeout | invalid | incompatible | unknown
      detail: 'Connection has not been tested yet.',
      latencyMs: null,
      checkedAt: null,
      apiVersion: null,
    };
  }

  baseUrl() {
    const { protocol, host, port } = this.current;
    const hostPart = host.includes(':') ? `[${host}]` : host;
    return `${protocol}://${hostPart}:${port}`;
  }

  snapshot() {
    return {
      settings: { ...this.current },
      baseUrl: this.baseUrl(),
      source: this.source,
      savedAt: this.savedAt,
      defaults: { ...BUILT_IN_DEFAULTS },
      status: { ...this.connectionStatus },
    };
  }

  setStatus(patch) {
    this.connectionStatus = { ...this.connectionStatus, ...patch, checkedAt: new Date().toISOString() };
  }

  /**
   * Whether the given { protocol, host, port } target is the currently active
   * one. The cached connectionStatus describes the ACTIVE connection only —
   * testing some candidate target must not overwrite it.
   */
  isActive(target) {
    return (
      target.protocol === this.current.protocol &&
      target.host === this.current.host &&
      target.port === this.current.port
    );
  }

  /** Load at boot: file -> env -> built-in. Never throws; falls back safely. */
  async load() {
    const fromFile = await this.#readFile();
    if (fromFile) {
      this.current = fromFile.settings;
      this.source = 'file';
      this.savedAt = fromFile.savedAt ?? null;
      return;
    }
    const envUrl = this.env.EVER_JOBS_API_URL;
    if (envUrl) {
      const parsed = parseApiUrl(envUrl);
      if (parsed) {
        this.current = parsed;
        this.source = 'env';
        return;
      }
      console.warn(`[settings] ignoring invalid EVER_JOBS_API_URL: ${envUrl}`);
    }
    this.current = { ...BUILT_IN_DEFAULTS };
    this.source = 'default';
  }

  /**
   * Validate + persist a new target. Caller must have tested connectivity
   * first; on any failure the previous configuration stays active.
   */
  async save(input) {
    const res = validateApiTarget(input);
    if (!res.ok) return res;
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = {
      version: 1,
      protocol: res.settings.protocol,
      host: res.settings.host,
      port: res.settings.port,
      savedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(tmp, this.filePath); // atomic
    this.current = res.settings;
    this.source = 'file';
    this.savedAt = payload.savedAt;
    return { ok: true, settings: { ...this.current } };
  }

  /** Remove the saved file; fall back to env / built-in defaults. */
  async reset() {
    try {
      await fs.unlink(this.filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const envUrl = this.env.EVER_JOBS_API_URL;
    const parsed = envUrl ? parseApiUrl(envUrl) : null;
    if (parsed) {
      this.current = parsed;
      this.source = 'env';
    } else {
      this.current = { ...BUILT_IN_DEFAULTS };
      this.source = 'default';
    }
    this.savedAt = null;
    // The active target may have changed — the old connection status no
    // longer describes it, so go back to "not tested".
    this.connectionStatus = {
      state: 'unknown',
      detail: 'Connection has not been tested yet.',
      latencyMs: null,
      checkedAt: new Date().toISOString(),
      apiVersion: null,
    };
    return { ok: true, settings: { ...this.current } };
  }

  async #readFile() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      const res = validateApiTarget(raw);
      if (!res.ok) {
        console.warn(`[settings] saved file invalid (${res.error}); ignoring.`);
        return null;
      }
      return { settings: res.settings, savedAt: raw.savedAt ?? null };
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[settings] could not read ${this.filePath}: ${err.message}`);
      return null;
    }
  }
}

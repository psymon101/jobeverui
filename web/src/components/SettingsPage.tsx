import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ApiSettings, SettingsSnapshot, TestResult } from '../lib/types';
import { Badge, Button, Field, Spinner, inputCls } from './ui';

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  connected: { text: 'Connected', tone: 'green' },
  disconnected: { text: 'Disconnected', tone: 'red' },
  timeout: { text: 'Timeout', tone: 'amber' },
  invalid: { text: 'Invalid API endpoint', tone: 'red' },
  incompatible: { text: 'Not an Ever Jobs API', tone: 'red' },
  auth_required: { text: 'Authentication required', tone: 'amber' },
  unknown: { text: 'Not tested yet', tone: 'slate' },
};

export function statusBadge(state: string) {
  const s = STATUS_LABEL[state] ?? { text: state, tone: 'slate' };
  return <Badge tone={s.tone}>{s.text}</Badge>;
}

export default function SettingsPage({ onStatusChange }: { onStatusChange: () => void }) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [form, setForm] = useState<ApiSettings | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSnapshot(s);
        setForm({ ...s.settings });
      })
      .catch((e) => setLoadError(String(e.message || e)));
  }, []);

  if (loadError) return <div className="p-6 text-red-600">Failed to load settings: {loadError}</div>;
  if (!snapshot || !form) {
    return (
      <div className="flex items-center gap-2 p-6 text-slate-500">
        <Spinner /> Loading settings…
      </div>
    );
  }

  const previewUrl = `${form.protocol}://${form.host.includes(':') ? `[${form.host}]` : form.host}:${form.port}`;
  const dirty =
    form.protocol !== snapshot.settings.protocol || form.host !== snapshot.settings.host || form.port !== snapshot.settings.port;

  async function test() {
    setTesting(true);
    setTestResult(null);
    setSaveError(null);
    try {
      const r = await api.testSettings(form!);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, status: 'invalid', detail: String((e as Error).message || e), latencyMs: null, apiVersion: null });
    } finally {
      setTesting(false);
      // The server caches the outcome of every test, so refresh the
      // "Current connection" card too, not just the header indicator.
      api.getSettings().then((s) => setSnapshot(s)).catch(() => undefined);
      onStatusChange();
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const r = await api.saveSettings(form!);
      setSnapshot(r);
      setForm({ ...r.settings });
      setSaveOk(true);
      setTestResult(r.test ?? null);
    } catch (e) {
      setSaveError(String((e as Error).message || e));
    } finally {
      setSaving(false);
      onStatusChange();
    }
  }

  async function reset() {
    setSaving(true);
    try {
      const s = await api.resetSettings();
      setSnapshot(s);
      setForm({ ...s.settings });
      setTestResult(null);
      setSaveError(null);
      setSaveOk(false);
    } finally {
      setSaving(false);
      onStatusChange();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-xl font-bold">Settings — API Connection</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Choose which Ever Jobs API this frontend connects to. Changes apply immediately to all searches — no restart needed.
        </p>
      </div>

      {/* Current connection */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Current connection:</span>
          {statusBadge(snapshot.status.state)}
          <code className="rounded bg-slate-100 px-2 py-0.5 text-sm dark:bg-slate-800">{snapshot.baseUrl}</code>
          {snapshot.status.latencyMs != null && snapshot.status.state === 'connected' && (
            <span className="text-xs text-slate-500">{snapshot.status.latencyMs} ms</span>
          )}
          <span className="ml-auto text-xs text-slate-400">
            config: {snapshot.source === 'file' ? `saved${snapshot.savedAt ? ` (${new Date(snapshot.savedAt).toLocaleString()})` : ''}` : snapshot.source === 'env' ? 'environment variable' : 'built-in defaults'}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{snapshot.status.detail}</p>
      </div>

      {/* Editor */}
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[7.5rem_1fr_7rem]">
          <Field label="Protocol">
            <select className={inputCls} value={form.protocol} onChange={(e) => { setForm({ ...form, protocol: e.target.value as 'http' | 'https' }); setTestResult(null); setSaveOk(false); }}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
          </Field>
          <Field label="API server (hostname or IP)">
            <input
              className={inputCls}
              value={form.host}
              placeholder="192.168.1.45"
              spellCheck={false}
              onChange={(e) => { setForm({ ...form, host: e.target.value.trim() }); setTestResult(null); setSaveOk(false); }}
            />
          </Field>
          <Field label="Port">
            <input
              className={inputCls}
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(e) => { setForm({ ...form, port: Number(e.target.value) }); setTestResult(null); setSaveOk(false); }}
            />
          </Field>
        </div>

        <div className="text-sm text-slate-600 dark:text-slate-300">
          Resulting API URL: <code className="rounded bg-slate-100 px-2 py-0.5 font-semibold dark:bg-slate-800">{previewUrl}</code>
          {dirty && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">unsaved changes</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={test} disabled={testing}>
            <span className="inline-flex items-center gap-2">{testing && <Spinner className="h-3.5 w-3.5" />}{testing ? 'Testing…' : 'Test Connection'}</span>
          </Button>
          <Button onClick={save} disabled={saving || testing || !dirty} title={dirty ? 'Tests the connection, then saves' : 'Nothing to save'}>
            <span className="inline-flex items-center gap-2">{saving && <Spinner className="h-3.5 w-3.5" />}Save Settings</span>
          </Button>
          <Button variant="danger" onClick={reset} disabled={saving || testing}>
            Reset to Defaults
          </Button>
        </div>

        <p className="text-xs text-slate-400">
          Saving first tests <code>/health</code> and the GraphQL <code>listSources</code> query against the target. If the test fails, the
          previously working configuration is kept. Settings are stored on the frontend server (survives restarts).
        </p>

        {testResult && (
          <div
            className={`rounded-md border p-3 text-sm ${
              testResult.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge(testResult.status)}
              {testResult.latencyMs != null && <span className="text-xs">response time: {testResult.latencyMs} ms</span>}
              {testResult.tested && <span className="text-xs opacity-75">→ {testResult.tested}</span>}
            </div>
            <div className="mt-1">{testResult.detail || testResult.error}</div>
          </div>
        )}

        {saveError && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <div className="font-semibold">Not saved — {saveError}</div>
            <div className="mt-1 text-xs">The previous configuration stays active.</div>
          </div>
        )}
        {saveOk && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            Settings saved. All searches now use <code>{snapshot.baseUrl}</code>.
          </div>
        )}
      </div>

      <div className="text-xs text-slate-400">
        Defaults: server <code>{snapshot.defaults.host}</code>, port <code>{snapshot.defaults.port}</code>, protocol{' '}
        <code>{snapshot.defaults.protocol.toUpperCase()}</code>. Reset restores these (or the server's EVER_JOBS_API_URL environment default).
      </div>
    </div>
  );
}

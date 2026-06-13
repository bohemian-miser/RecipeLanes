/*
 * Copyright (C) 2026 Bohemian Miser <https://substack.com/@bohemianmiser>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, Save } from 'lucide-react';
import { getIconQueueConfigAction, setIconQueueConfigAction } from '@/app/actions';
import type { IconQueueConfig } from '@/lib/config';

/**
 * Admin-only panel for editing the runtime icon-queue config (`config/icon_queue`).
 * Visibility is gated by `isAdmin` here AND every action is re-checked server-side.
 * Render nothing for non-admins.
 */
export function QueueConfigPanel({ isAdmin }: { isAdmin: boolean }) {
  const [config, setConfig] = useState<IconQueueConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      const res = await getIconQueueConfigAction();
      if (cancelled) return;
      if (res.error) setError(res.error);
      else if (res.config) setConfig(res.config);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const update = (patch: Partial<IconQueueConfig>) =>
    setConfig(prev => (prev ? { ...prev, ...patch } : prev));

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    const res = await setIconQueueConfigAction(config);
    if (res.error) setError(res.error);
    else if (res.config) {
      setConfig(res.config);
      setSavedAt(Date.now());
    }
    setSaving(false);
  };

  return (
    <section className="w-full rounded-lg border border-amber-700/50 bg-zinc-950/60 p-4 font-mono text-sm">
      <div className="mb-3 flex items-center gap-2 text-amber-500">
        <ShieldAlert className="h-4 w-4" />
        <span className="font-bold uppercase tracking-wider">Queue Config (Admin)</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading config…
        </div>
      ) : config ? (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4">
            <span className="text-zinc-300">Paused (hard stop)</span>
            <input
              type="checkbox"
              checked={config.paused}
              onChange={e => update({ paused: e.target.checked })}
              className="h-4 w-4 accent-amber-500"
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <span className="text-zinc-300">Allow anonymous forge</span>
            <input
              type="checkbox"
              checked={config.allowAnonForge}
              onChange={e => update({ allowAnonForge: e.target.checked })}
              className="h-4 w-4 accent-amber-500"
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <span className="text-zinc-300">Per-user daily cap</span>
            <input
              type="number"
              min={0}
              value={config.perUserDailyCap}
              onChange={e => update({ perUserDailyCap: Number(e.target.value) })}
              className="w-24 rounded bg-zinc-800 px-2 py-1 text-right text-zinc-100"
            />
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-amber-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
            {savedAt && !saving && <span className="text-xs text-green-500">Saved.</span>}
          </div>
        </div>
      ) : null}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </section>
  );
}

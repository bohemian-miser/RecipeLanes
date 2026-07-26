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

/**
 * Formatting for an icon's creation time, used by the icon_overview list view
 * (issue #279).
 *
 * `getPagedIcons` normalizes the Firestore `created_at` field before it reaches
 * the gallery, but the type differs by data service:
 *   - production (Firestore): an ISO-8601 string (`created_at.toDate().toISOString()`)
 *   - memory / tests:         an epoch-milliseconds number (`Date.now()`)
 * and it can be `null`/absent for older icons. These helpers accept all of those.
 */

export type IconCreatedAt = string | number | null | undefined;

/**
 * Normalizes an icon `created_at` value to epoch milliseconds, or `null` when it
 * is missing or unparseable. Accepts an ISO string, an epoch-ms number, or null.
 */
export function getIconCreatedAtMs(createdAt: IconCreatedAt): number | null {
  if (createdAt === null || createdAt === undefined || createdAt === '') return null;
  const ms = new Date(createdAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Formats an icon `created_at` value for display in the list view as a
 * deterministic, locale-independent `YYYY-MM-DD HH:mm UTC` string. Returns
 * `'Unknown'` when the timestamp is missing or unparseable.
 *
 * UTC is used (rather than the viewer's locale) so the rendered string is stable
 * regardless of where it is computed — which also keeps it unit-testable.
 */
export function formatIconCreatedAt(createdAt: IconCreatedAt): string {
  const ms = getIconCreatedAtMs(createdAt);
  if (ms === null) return 'Unknown';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

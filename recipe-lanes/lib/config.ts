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

// Global configuration flags
// Set this to true to disable authentication requirements (e.g. for local dev or demos)
export const AUTH_DISABLED = false; 

export const DB_COLLECTION_INGREDIENTS = 'ingredients_new';
export const DB_COLLECTION_QUEUE = 'icon_queue';
export const DB_COLLECTION_RECIPES = 'recipes';
export const DB_COLLECTION_FEEDBACK = 'feedback';
export const DB_COLLECTION_BUGS = 'bugs';
export const DB_COLLECTION_ICON_INDEX = 'icon_index';
export const DB_COLLECTION_CONFIG = 'config';

// Runtime config document for the icon-generation queue. Both the server actions
// and the Cloud Function read this so abuse controls are adjustable without a redeploy.
export const ICON_QUEUE_CONFIG_DOC = 'icon_queue';

export interface IconQueueConfig {
  /** Hard pause: when true the Cloud Task handler re-enqueues with backoff instead of generating. */
  paused: boolean;
  /** Whether logged-out/anonymous users may forge icons. */
  allowAnonForge: boolean;
  /** Max forges a single user may enqueue per calendar (UTC) day. */
  perUserDailyCap: number;
}

export const DEFAULT_ICON_QUEUE_CONFIG: IconQueueConfig = {
  paused: false,
  allowAnonForge: true,
  perUserDailyCap: 100,
};

/**
 * Apply safe defaults to a (possibly partial / undefined) raw config doc.
 * Defaults live in exactly one place so the typed accessor
 * (lib/icon-queue-config.ts) and the functions-side reader agree.
 */
export function withIconQueueConfigDefaults(raw: any): IconQueueConfig {
  const data = raw || {};
  return {
    paused: typeof data.paused === 'boolean' ? data.paused : DEFAULT_ICON_QUEUE_CONFIG.paused,
    allowAnonForge:
      typeof data.allowAnonForge === 'boolean'
        ? data.allowAnonForge
        : DEFAULT_ICON_QUEUE_CONFIG.allowAnonForge,
    perUserDailyCap:
      typeof data.perUserDailyCap === 'number' && Number.isFinite(data.perUserDailyCap)
        ? data.perUserDailyCap
        : DEFAULT_ICON_QUEUE_CONFIG.perUserDailyCap,
  };
}

/** UTC day key (YYYY-MM-DD) used for per-user daily forge counting. */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
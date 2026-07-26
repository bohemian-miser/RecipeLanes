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
 * Tailwind transform classes controlling how an icon's label reveals on the
 * icon_overview gallery grid (issue #99).
 *
 * Mobile has no hover, so the label must always be visible there. On larger
 * (hover-capable, `md` and up) screens we keep the original slide-up-on-hover
 * behaviour so the label doesn't permanently obscure the icon on desktop.
 *
 *   - base (mobile):  `translate-y-0`                 -> label sits over the icon, always shown
 *   - `md` and up:    `md:translate-y-full`           -> hidden below the tile by default
 *                     `md:group-hover:translate-y-0`  -> slides up into view on hover
 */
export const GALLERY_LABEL_TRANSFORM_CLASS =
  'translate-y-0 md:translate-y-full md:group-hover:translate-y-0';

/**
 * Whether a transform class string keeps the gallery label visible on mobile
 * (i.e. without any hover). True when the un-prefixed transform shows the label
 * (`translate-y-0`) and nothing un-prefixed pushes it out of view
 * (`translate-y-full` with no breakpoint prefix).
 */
export function isLabelAlwaysVisibleOnMobile(cls: string): boolean {
  const tokens = cls.split(/\s+/).filter(Boolean);
  return tokens.includes('translate-y-0') && !tokens.includes('translate-y-full');
}

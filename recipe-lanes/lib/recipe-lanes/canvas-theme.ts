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

import type { IconStyleId } from './types';

/**
 * Visual theme for the diagram canvas (the "paper" the recipe sits on).
 * The diagram surface colour, the ReactFlow dot-pattern colour, and the
 * PNG-export background are all derived from the selected style, so that
 * on-screen and downloaded diagrams stay in sync.
 */
export interface CanvasTheme {
    /** Background colour of the diagram surface. */
    surface: string;
    /** Colour of the ReactFlow <Background/> dot pattern. */
    pattern: string;
    /** Background colour used when exporting the diagram to PNG. */
    exportBackground: string;
}

/** The default white canvas used by every existing style. */
export const DEFAULT_CANVAS_THEME: CanvasTheme = {
    surface: '#ffffff',
    pattern: '#f4f4f5',
    exportBackground: '#ffffff',
};

/** Warm kraft "butcher's paper" surface (issue #111). */
export const BUTCHER_PAPER_THEME: CanvasTheme = {
    surface: '#e7d7b3',
    pattern: '#cbb98f',
    exportBackground: '#e7d7b3',
};

/**
 * Resolves the canvas theme for a given icon style. Only the `butcher` style
 * changes the paper; every other (or unknown/undefined) style keeps the
 * default white canvas, so existing themes render exactly as before.
 */
export function getCanvasTheme(iconStyle: IconStyleId | string | undefined | null): CanvasTheme {
    return iconStyle === 'butcher' ? BUTCHER_PAPER_THEME : DEFAULT_CANVAS_THEME;
}

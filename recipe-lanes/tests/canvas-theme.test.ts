/*
 * Copyright (C) 2026 Bohemian Miser
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getCanvasTheme,
    DEFAULT_CANVAS_THEME,
    BUTCHER_PAPER_THEME,
} from '../lib/recipe-lanes/canvas-theme';

describe('canvas-theme (issue #111: butcher\'s paper)', () => {
    it('returns the butcher\'s-paper surface for the "butcher" style', () => {
        const theme = getCanvasTheme('butcher');
        assert.deepEqual(theme, BUTCHER_PAPER_THEME);
        // The butcher surface must be a warm paper, not the default white.
        assert.notEqual(theme.surface, '#ffffff');
    });

    it('keeps the default white canvas for every existing style', () => {
        for (const style of ['classic', 'modern', 'modern_clean', 'timeline-circle']) {
            assert.deepEqual(getCanvasTheme(style), DEFAULT_CANVAS_THEME);
        }
    });

    it('falls back to the default canvas for unknown/undefined/null styles', () => {
        assert.deepEqual(getCanvasTheme(undefined), DEFAULT_CANVAS_THEME);
        assert.deepEqual(getCanvasTheme(null), DEFAULT_CANVAS_THEME);
        assert.deepEqual(getCanvasTheme('not-a-real-style'), DEFAULT_CANVAS_THEME);
    });

    it('butcher\'s paper is visually distinct from the default across all fields', () => {
        assert.notEqual(BUTCHER_PAPER_THEME.surface, DEFAULT_CANVAS_THEME.surface);
        assert.notEqual(BUTCHER_PAPER_THEME.pattern, DEFAULT_CANVAS_THEME.pattern);
        assert.notEqual(BUTCHER_PAPER_THEME.exportBackground, DEFAULT_CANVAS_THEME.exportBackground);
    });

    it('exports a PNG background that matches its on-screen surface', () => {
        // Downloads should look like the screen — surface and export bg agree.
        assert.equal(BUTCHER_PAPER_THEME.exportBackground, BUTCHER_PAPER_THEME.surface);
        assert.equal(DEFAULT_CANVAS_THEME.exportBackground, DEFAULT_CANVAS_THEME.surface);
    });
});

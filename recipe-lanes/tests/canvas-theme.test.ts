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

describe('canvas-theme (issue #111: butcher\'s paper background)', () => {
    it('returns the butcher\'s-paper surface for the "butcher" background', () => {
        const theme = getCanvasTheme('butcher');
        assert.deepEqual(theme, BUTCHER_PAPER_THEME);
        // The butcher surface must be a warm paper, not the default white.
        assert.notEqual(theme.surface, '#ffffff');
    });

    it('keeps the default white canvas for the "default" background', () => {
        assert.deepEqual(getCanvasTheme('default'), DEFAULT_CANVAS_THEME);
    });

    it('falls back to the default canvas for unknown/undefined/null backgrounds', () => {
        assert.deepEqual(getCanvasTheme(undefined), DEFAULT_CANVAS_THEME);
        assert.deepEqual(getCanvasTheme(null), DEFAULT_CANVAS_THEME);
        assert.deepEqual(getCanvasTheme('not-a-real-background'), DEFAULT_CANVAS_THEME);
    });

    it('background choice is independent of icon style (icon-style values do not select butcher)', () => {
        // The background is a separate dimension from iconStyle, so passing an
        // icon-style id must NOT resolve to the butcher paper.
        for (const iconStyle of ['classic', 'modern', 'modern_clean', 'timeline-circle']) {
            assert.deepEqual(getCanvasTheme(iconStyle), DEFAULT_CANVAS_THEME);
        }
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

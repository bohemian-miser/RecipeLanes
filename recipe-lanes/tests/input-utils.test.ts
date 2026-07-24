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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAdjustSubmitKey, looksLikeUrl } from '../lib/recipe-lanes/input-utils';

describe('isAdjustSubmitKey (issue #110 — Enter submits the adjust box on mobile)', () => {
  it('submits on a plain Enter reported via key (desktop)', () => {
    assert.equal(isAdjustSubmitKey({ key: 'Enter', keyCode: 13 }), true);
  });

  it('submits when the mobile keyboard only surfaces Enter via legacy keyCode 13', () => {
    // Android soft keyboards can report key === 'Unidentified' for the action key.
    assert.equal(isAdjustSubmitKey({ key: 'Unidentified', keyCode: 13 }), true);
  });

  it('does NOT submit during IME composition (isComposing)', () => {
    assert.equal(isAdjustSubmitKey({ key: 'Enter', keyCode: 13, isComposing: true }), false);
  });

  it('does NOT submit on the keyCode 229 composition sentinel', () => {
    // The exact case that broke mobile: composing keydown with keyCode 229.
    assert.equal(isAdjustSubmitKey({ key: 'Unidentified', keyCode: 229 }), false);
  });

  it('does NOT submit on Shift+Enter (reserved for a future newline affordance)', () => {
    assert.equal(isAdjustSubmitKey({ key: 'Enter', keyCode: 13, shiftKey: true }), false);
  });

  it('does NOT submit on other keys', () => {
    assert.equal(isAdjustSubmitKey({ key: 'a', keyCode: 65 }), false);
    assert.equal(isAdjustSubmitKey({ key: 'Escape', keyCode: 27 }), false);
    assert.equal(isAdjustSubmitKey({ key: ' ', keyCode: 32 }), false);
  });

  it('tolerates a partial event (no keyCode) as long as key is Enter', () => {
    assert.equal(isAdjustSubmitKey({ key: 'Enter' }), true);
    assert.equal(isAdjustSubmitKey({}), false);
  });
});

// Lock in the pre-existing helper in the same module while we now have a test file.
describe('looksLikeUrl', () => {
  it('flags a bare URL', () => {
    assert.equal(looksLikeUrl('https://example.com/recipe'), true);
    assert.equal(looksLikeUrl('www.example.com'), true);
  });

  it('does not flag real recipe text that merely mentions a link', () => {
    assert.equal(looksLikeUrl('Mix flour and water. See https://example.com'), false);
    assert.equal(looksLikeUrl('2 eggs\n100g flour'), false);
    assert.equal(looksLikeUrl(''), false);
  });
});

/*
 * Copyright (C) 2026 Bohemian Miser
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GALLERY_LABEL_TRANSFORM_CLASS,
  isLabelAlwaysVisibleOnMobile,
} from '../lib/recipe-lanes/gallery-label';

describe('gallery-label visibility (issue #99)', () => {
  it('shows the label on mobile (no hover dependence)', () => {
    // Un-prefixed transform must reveal the label so touch devices, which
    // cannot hover, always see the ingredient name.
    assert.equal(isLabelAlwaysVisibleOnMobile(GALLERY_LABEL_TRANSFORM_CLASS), true);
    const tokens = GALLERY_LABEL_TRANSFORM_CLASS.split(/\s+/);
    assert.ok(tokens.includes('translate-y-0'), 'base transform should be translate-y-0');
    assert.ok(
      !tokens.includes('translate-y-full'),
      'no un-prefixed rule may hide the label',
    );
  });

  it('keeps the slide-up-on-hover behaviour on hover-capable (md+) screens', () => {
    const tokens = GALLERY_LABEL_TRANSFORM_CLASS.split(/\s+/);
    assert.ok(
      tokens.includes('md:translate-y-full'),
      'label should be hidden by default on md+ screens',
    );
    assert.ok(
      tokens.includes('md:group-hover:translate-y-0'),
      'label should slide up on hover on md+ screens',
    );
  });

  it('detects the old hover-only class as NOT mobile-visible (regression guard)', () => {
    // The pre-fix behaviour that caused issue #99: hidden below the tile,
    // only revealed on hover — invisible on mobile.
    const oldHoverOnly = 'translate-y-full group-hover:translate-y-0';
    assert.equal(isLabelAlwaysVisibleOnMobile(oldHoverOnly), false);
  });

  it('isLabelAlwaysVisibleOnMobile handles extra whitespace and unrelated tokens', () => {
    assert.equal(isLabelAlwaysVisibleOnMobile('  translate-y-0   md:translate-y-full  '), true);
    assert.equal(isLabelAlwaysVisibleOnMobile('opacity-100 backdrop-blur-sm'), false);
    assert.equal(isLabelAlwaysVisibleOnMobile('translate-y-0 translate-y-full'), false);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyVerb } from '../lib/recipe-lanes/verbs';

describe('classifyVerb', () => {
    const cases: [string, { verb: string; glyph: string } | null][] = [
        ['Chop the onion', { verb: 'chop', glyph: '🔪' }],
        ['Slice 2 cloves garlic', { verb: 'chop', glyph: '🔪' }],
        ['Dice the carrot', { verb: 'chop', glyph: '🔪' }],
        ['Cut into strips', { verb: 'chop', glyph: '🔪' }],
        ['Mince the ginger', { verb: 'chop', glyph: '🔪' }],
        ['Stir the sauce', { verb: 'stir', glyph: '🌀' }],
        ['Toss to combine', { verb: 'stir', glyph: '🌀' }],
        ['Whisk the eggs', { verb: 'stir', glyph: '🌀' }],
        ['Heat the oil', { verb: 'heat', glyph: '🔥' }],
        ['Fry until golden', { verb: 'heat', glyph: '🔥' }],
        ['Sear the beef', { verb: 'heat', glyph: '🔥' }],
        ['Sauté the shallots', { verb: 'heat', glyph: '🔥' }],
        ['Brown 3-4 minutes', { verb: 'heat', glyph: '🔥' }],
        ['Simmer for 2 minutes', { verb: 'simmer', glyph: '♨️' }],
        ['Boil the noodles', { verb: 'boil', glyph: '🫧' }],
        ['Drain and rinse', { verb: 'drain', glyph: '🫗' }],
        ['Strain the stock', { verb: 'drain', glyph: '🫗' }],
        ['Pour off the fat', { verb: 'drain', glyph: '🫗' }],
        ['Season with salt', { verb: 'season', glyph: '🧂' }],
        ['Add pepper', { verb: 'season', glyph: '🧂' }],
        ['Rest for 5 minutes', { verb: 'rest', glyph: '⏲️' }],
        ['Wait until cool', { verb: 'rest', glyph: '⏲️' }],
        ['Chill overnight', { verb: 'rest', glyph: '⏲️' }],
        ['Fold gently', { verb: 'fold', glyph: '🥄' }],
['Combine everything gently', { verb: 'fold', glyph: '🥄' }],
        ['Crush the peanuts', { verb: 'crush', glyph: '🔨' }],
        ['Pound the meat', { verb: 'crush', glyph: '🔨' }],
        ['Bake at 200C', { verb: 'bake', glyph: '🔳' }],
        ['Roast the vegetables', { verb: 'bake', glyph: '🔳' }],
        ['Serve immediately', { verb: 'serve', glyph: '🍽️' }],
        ['Plate up', { verb: 'serve', glyph: '🍽️' }],
        ['Divide between bowls', { verb: 'serve', glyph: '🍽️' }],
    ];

    for (const [text, expected] of cases) {
        it(`classifies "${text}"`, () => {
            assert.deepStrictEqual(classifyVerb(text), expected);
        });
    }

    it('returns null when no keyword matches', () => {
        assert.strictEqual(classifyVerb('Assemble the tacos'), null);
        assert.strictEqual(classifyVerb(''), null);
    });

    it('is case-insensitive', () => {
        assert.deepStrictEqual(classifyVerb('CHOP the onion'), { verb: 'chop', glyph: '🔪' });
    });

    it('does not false-positive on substrings without word boundaries', () => {
        // "coconut" contains "cut" but is not the verb "cut".
        assert.strictEqual(classifyVerb('Add coconut milk'), null);
    });

    it('first match wins when text could match multiple entries', () => {
        // Contains both "chop" (table entry 1) and "stir" (table entry 2) — chop wins.
        assert.deepStrictEqual(classifyVerb('Chop then stir the mixture'), { verb: 'chop', glyph: '🔪' });
    });
});

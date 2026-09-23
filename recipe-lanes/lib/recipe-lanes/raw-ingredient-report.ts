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
 * The merge-quality evidence for raw-ingredient extraction: what the
 * classifier's raw names would actually DO to the comparison table, computed
 * from a set of classified labels.
 *
 * Why this is a pure module and not a few loops inside the backfill script:
 * these numbers are the owner's gate before anything is written to production.
 * Over-merging is silent data corruption — a teaspoon of tomato paste summed
 * into 400g of tinned tomatoes produces a number that looks perfectly
 * reasonable — so the report that is supposed to catch it cannot itself be
 * untested code that only ever runs against a live database.
 *
 * WHOLE-CORPUS, NOT JUST THIS RUN. Callers must pass the labels that already
 * have docs alongside the ones being classified now, flagged `isNew: false`. A
 * merge is a relationship BETWEEN labels, so a report computed from only the
 * pending set cannot see it: backfill the corpus, get it approved, and then let
 * one new label "Tomato Paste" arrive whose raw name is "Tomato" — scoped to
 * the run, the report says "collision groups: 0, cross-category: none" while
 * the write folds tomato paste into tinned tomatoes. The report would be
 * asserting the absence of exactly the corruption it exists to catch. Passing
 * the existing docs in costs one flag per entry and makes that impossible.
 *
 * It answers three questions, in escalating order of how much they should
 * worry a reviewer:
 *
 *   1. Which labels move at all? (`renames`) A label whose raw name keys to the
 *      same row it already had changes nothing; only the ones that move are
 *      worth reading.
 *   2. Which labels end up sharing a row? (`groups`) This is the feature
 *      working — and also the only place over-merging can show up.
 *   3. Which of those groups merged labels the taxonomy itself considers
 *      different kinds of thing? (`crossCategoryGroups`) A group spanning
 *      `condiments_liquids` and `vegetables` is the classifier having folded a
 *      derivative into its parent, which is exactly the failure the boundary
 *      rules exist to prevent. It cannot be proven wrong mechanically, so it is
 *      flagged loudly rather than filtered.
 *
 * Anything containing a NEW label sorts first throughout, and
 * `newCrossCategoryGroups` isolates the subset a run is actually accountable
 * for. On a first or `--force` run every entry is new, so the ordering
 * degenerates to plain size/usage order and nothing about that run changes; on
 * an incremental run it is what stops three new labels from being invisible
 * underneath four thousand reviewed ones.
 *
 * Everything is keyed through `ingredientCategoryKey` — the same derivation the
 * comparison table rows use — so "these two labels merge" here means precisely
 * "these two labels will share a row" there, rather than a lookalike computed
 * from display strings.
 */

import { ingredientCategoryKey } from './ingredient-label-extract';

/** One classified label, with the raw ingredient name extracted for it. */
export interface RawIngredientEntry {
    /** The standardized label, as stored on the doc (e.g. "Carrot, Chopped"). */
    label: string;
    /** The raw ingredient name for it, display-cased (e.g. "Carrot"). */
    raw: string;
    /** The label's taxonomy category id. */
    category: string;
    /** Usage count from the census, used for ordering and for weighting risk. */
    usageCount: number;
    /**
     * False for an entry read back from a doc that already existed. Omitted
     * means true: "classified in this run", which is the only kind of entry a
     * first run has and the default a test wants.
     */
    isNew?: boolean;
}

/** A label whose raw name would move it to a different comparison row. */
export interface RawIngredientRename {
    label: string;
    raw: string;
    usageCount: number;
    isNew: boolean;
}

/** One label inside a group of labels that share a raw ingredient. */
export interface RawIngredientGroupMember {
    label: string;
    category: string;
    usageCount: number;
    isNew: boolean;
}

/** Two or more labels that the raw names would collapse onto one row. */
export interface RawIngredientGroup {
    /** `ingredientCategoryKey(raw)` — the row key the members would share. */
    key: string;
    /**
     * Display form of the shared raw name: the spelling of the most-used
     * member, not whichever the iteration happened to reach first. The members
     * of a group agree on the row KEY, not on casing or accents, and a header
     * reading "carrot" over a group whose dominant member spells it "Carrot"
     * reads as a different ingredient to someone reviewing the table.
     */
    raw: string;
    /** Members, most-used first. Always at least 2. */
    members: RawIngredientGroupMember[];
    /** Sum of the members' usage counts — the size of the merged row. */
    usageCount: number;
    /** Distinct categories across the members, sorted. Length > 1 is the flag. */
    categories: string[];
    /** True when the members do not all carry the same category. */
    crossCategory: boolean;
    /** True when at least one member is being classified in this run. */
    hasNewMember: boolean;
}

export interface RawIngredientReport {
    /** Entries fed in, existing docs included. */
    totalLabels: number;
    /** How many of them are new this run. */
    newLabels: number;
    /** Labels whose raw name keys to a different row than the label does. */
    renames: RawIngredientRename[];
    /** Raw groups with 2+ member labels, new-touching first, then biggest. */
    groups: RawIngredientGroup[];
    /** The subset of `groups` spanning more than one category. */
    crossCategoryGroups: RawIngredientGroup[];
    /**
     * The subset of `crossCategoryGroups` this run is accountable for: at least
     * one member is being written now. The circuit breaker keys on this rather
     * than on the total, so a corpus whose flags a human has already reviewed
     * does not re-block every later run, while a newly-introduced over-merge
     * always does.
     */
    newCrossCategoryGroups: RawIngredientGroup[];
    /**
     * How many comparison rows the merge removes: every group of N members
     * becomes 1 row, so it costs N-1 rows. The headline "is this doing
     * anything" number, and the one to sanity-check against `renames`.
     */
    rowsMerged: number;
}

/** What a group accumulates per member before it is published. */
interface Accumulated extends RawIngredientGroupMember {
    /** This member's own spelling of the shared raw name. */
    raw: string;
}

/**
 * New first, then usage, then label. Newness leads because an incremental run's
 * whole risk is concentrated in its handful of new labels, and a cap of 50
 * printed rows would otherwise bury them under the reviewed corpus. Label last
 * so equal rows never reorder between runs.
 */
function byNewThenUsage(
    a: { isNew: boolean; usageCount: number; label: string },
    b: { isNew: boolean; usageCount: number; label: string },
): number {
    return (
        Number(b.isNew) - Number(a.isNew)
        || b.usageCount - a.usageCount
        || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    );
}

/** Usage first, then label — members keep pure usage order (see `group.raw`). */
function byUsageThenLabel(a: Accumulated, b: Accumulated): number {
    return b.usageCount - a.usageCount || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
}

/**
 * Builds the merge-quality report for a set of classified labels.
 *
 * Identity entries (raw keys to the same row as the label) are excluded from
 * `renames` but NOT from grouping: identity is the documented safe default, and
 * a group of "Carrot" + "Carrot, Chopped" is formed precisely by one identity
 * entry and one moved one. Dropping identities before grouping would hide the
 * common half of every merge.
 *
 * Entries with a blank raw name are treated as identity — the callers' fallback
 * is the label itself, and this keeps the report honest if one slips through.
 */
export function buildRawIngredientReport(
    entries: readonly RawIngredientEntry[],
): RawIngredientReport {
    const renames: RawIngredientRename[] = [];
    // Map, not a plain object: a raw key can legitimately be "__proto__".
    const byRawKey = new Map<string, Accumulated[]>();
    let newLabels = 0;

    for (const entry of entries) {
        const isNew = entry.isNew ?? true;
        if (isNew) newLabels++;
        const raw = entry.raw.trim() || entry.label;
        const rawKey = ingredientCategoryKey(raw);
        const labelKey = ingredientCategoryKey(entry.label);
        // A raw that normalises to nothing cannot key a row; such an entry can
        // only ever be its own row, so it is neither a rename nor groupable.
        if (!rawKey) continue;

        if (rawKey !== labelKey) {
            renames.push({ label: entry.label, raw, usageCount: entry.usageCount, isNew });
        }

        const member: Accumulated = {
            label: entry.label,
            category: entry.category,
            usageCount: entry.usageCount,
            isNew,
            raw,
        };
        const group = byRawKey.get(rawKey);
        if (group) group.push(member);
        else byRawKey.set(rawKey, [member]);
    }

    renames.sort(byNewThenUsage);

    const groups: RawIngredientGroup[] = [];
    for (const [key, accumulated] of byRawKey) {
        // One member is not a merge — it is the row the label already had.
        if (accumulated.length < 2) continue;
        accumulated.sort(byUsageThenLabel);
        const categories = [...new Set(accumulated.map(m => m.category))].sort();
        groups.push({
            key,
            // Sorted, so this is the dominant member's spelling.
            raw: accumulated[0].raw,
            members: accumulated.map(({ label, category, usageCount, isNew }) => ({
                label,
                category,
                usageCount,
                isNew,
            })),
            usageCount: accumulated.reduce((n, m) => n + m.usageCount, 0),
            categories,
            crossCategory: categories.length > 1,
            hasNewMember: accumulated.some(m => m.isNew),
        });
    }

    // Groups touching a new label first — on a first run that is all of them,
    // so the ordering below is what actually decides. "Biggest" is member count
    // first: a 5-label group is a bigger claim about the corpus than a 2-label
    // group that happens to be heavily used, and it is the one a reviewer most
    // needs to see. Usage breaks the tie, key breaks that, so the ordering is
    // total and the tables are reproducible.
    groups.sort(
        (a, b) =>
            Number(b.hasNewMember) - Number(a.hasNewMember)
            || b.members.length - a.members.length
            || b.usageCount - a.usageCount
            || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

    const crossCategoryGroups = groups.filter(g => g.crossCategory);
    return {
        totalLabels: entries.length,
        newLabels,
        renames,
        groups,
        crossCategoryGroups,
        newCrossCategoryGroups: crossCategoryGroups.filter(g => g.hasNewMember),
        rowsMerged: groups.reduce((n, g) => n + g.members.length - 1, 0),
    };
}

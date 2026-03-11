# Popularity Score Logic: Wilson LCB & Generation Gating

The "Recipe RPG" application uses the **Wilson Score Interval (Lower Confidence Bound)** to rank icons based on user acceptance rates, coupled with a strict **Cache-First** selection strategy to optimize for quality and cost.

## 1. Metrics (Per Icon Variant)

- **`n` (Impressions):** The number of times this specific icon variant has been displayed to a user.
- **`r` (Rejections):** The number of times a user has "rerolled" (refreshed) while this icon was displayed.
- **`k` (Accepts):** `n - r`. (Implicitly, if a user doesn't reroll, it's an "accept").

## 2. Scoring: Wilson Lower Confidence Bound (LCB)

We use the LCB to penalize "lucky" icons with few samples.
*Confidence Level:* 95% one-sided (`z = 1.645`).

**Formula:**
```
p = k / n
den = 1 + z^2 / n
centre = p + z^2 / (2n)
adj = z * sqrt( (p*(1-p) + z^2/(4n)) / n )
LCB = (centre - adj) / den
```
*Result:* A value in `[0, 1]` representing the conservative estimate of the icon's quality.

## 3. Selection Strategy (Cache-First)

The system prioritizes showing existing high-quality assets before spending money/time generating new ones.

### Loop:
1.  **User Request:** User requests "Iron Sword".
2.  **Filter:** Exclude icons already shown in this current session (avoid loops).
3.  **Gate Check (Should we generate?):**
    *   **Session Limit:** Have we rejected `R = 4` cached variants this session?
    *   **Quality Floor:** IF we hit the limit, look at the "Proven Cache" (icons with `n >= 20`).
        *   If the *best* proven icon has `LCB < 0.40` (garbage collection), OR cache is tiny (< 3 items), allow generation.
        *   Otherwise, keep cycling the cache (force exploration of existing items).
4.  **Selection:**
    *   If generating: Create new icon. The Cloud Function calculates `n = latestRecipeIds.length` (initial impressions) and `r=0` before publishing.
    *   If using cache: Pick the available icon with the **highest LCB**.
5.  **Record:** Increment `n` for the selected icon immediately when assigning existing items to a recipe.

## 4. Rejection Handling

When the user clicks "Reroll":
1.  **Record Rejection:** Increment `r` for the icon being removed and recalculate LCB.
2.  **Trigger Loop:** Request a new icon (step 1 above).

## 5. Storage

Metrics `n` and `r` are stored in:
1.  **Firestore:** `icons` subcollection fields `impressions` and `rejections`. The score is stored as `score`.

# Billing Implementation Plan

Develop in staging. Roll to prod once end-to-end tested.

---

## Current State

- ✅ Visibility system (`private` / `unlisted` / `public`)
- ✅ Vetting infrastructure (`getUnvettedRecipesAction`, `getUnvettedRecipes`)
- ✅ User collection in Firestore (`users/{uid}`)
- ✅ Icon generation pipeline (`resolveRecipeIcons`, `nodeNeedsProcessing`)
- ✅ Fork tracking (`graph.sourceId`)
- ✅ `forging` status state exists in the lanes UI
- ❌ Icons generate automatically — no forge gate (`createVisualRecipeAction` calls `resolveRecipeIcons` immediately)
- ❌ No credits/billing fields on user documents
- ❌ No Stripe integration
- ❌ No placeholder icon set (currently emojis)
- ❌ No credit deduction logic
- ❌ No vetting → credit return flow

---

## The Forge Flow

This is the mental model everything else hangs off.

```
Anyone
  → pastes recipe text
  → graph generates (free, always)
  → sees graph with placeholder icons
  → sees credit cost: "Forging costs N credits (N = nodes + 1)"

Not signed in
  → "Sign in to forge"

Signed in, no credits
  → "You need N credits — buy credits or subscribe"
  → link to purchase

Signed in, has credits
  → "Forge Icons — N credits" button
  → confirm (show balance before/after)
  → credits deducted
  → resolveRecipeIcons runs
  → icons appear
```

The only code change that enables most of this: **move `resolveRecipeIcons` out of
`createVisualRecipeAction` and into a new `forgeRecipeAction`**. Everything else is additive.

---

## Stage 1 — Separate Forge from Create

Minimal change, unlocks all subsequent work.

**In `app/actions.ts`:**
- Remove the `resolveRecipeIcons(id)` call from `createVisualRecipeAction`
- Add a new `forgeRecipeAction(recipeId)` server action that calls `resolveRecipeIcons`
- For now, `forgeRecipeAction` has no credit check — gate comes in Stage 3

**In `recipes/{id}`, add:**
```
forged: boolean        // false until first successful forge
forgeCost: number      // credits spent at last forge (0 until billing live)
rerollCounts: { [nodeId]: number }
submittedForVetting: boolean
publicDiscount: boolean
```

**Migration:** backfill `forged: true` on all existing recipes so they don't show the forge prompt.

---

## Stage 2 — Placeholder Icons

Do this before showing the credit cost UI so unforged recipes look intentional, not broken.

- Replace emoji fallbacks with neutral silhouette icons rendered client-side
- Ingredient placeholders: generic shapes (round, elongated, leafy, liquid)
- Action placeholders: generic action shapes (hand, flame, bowl, timer)
- Placeholders stored as static assets — not per-node, just rendered when `node.icon` is absent
- Unforged recipes cannot be submitted to the gallery

---

## Stage 3 — Credit Check & Forge UI

**User data model — add to `users/{uid}`:**
```
credits: number                  // purchased/granted, never expire
monthlyCapacity: number          // resets each billing period
capacityUsed: number
capacityResetAt: Timestamp
tier: 'free' | 'signin' | 'starter' | 'pro'
tierExpiresAt: Timestamp | null
stripeCustomerId: string | null
```

**`users/{uid}/transactions` subcollection:**
```
type: 'grant' | 'purchase' | 'forge' | 'vetting_return'
amount: number          // positive = credit, negative = debit
recipeId: string | null
createdAt: Timestamp
```

**`forgeRecipeAction` now:**
1. Auth check — must be signed in
2. Load recipe, compute cost: `nodes.length + 1`, apply 30% if `submittedForVetting`
3. Load user credits: `availableCredits = monthlyCapacity - capacityUsed + credits`
4. If insufficient: return `{ error: 'insufficient_credits', cost, balance }`
5. Deduct: capacity first, then purchased credits
6. Write transaction log entry
7. Call `resolveRecipeIcons`
8. Update recipe: `forged: true`, `forgeCost: cost`

**Forge UI (lanes page):**
- Show credit cost on the forge button: "Forge Icons — 25 credits"
- Show user balance somewhere unobtrusive
- If not signed in: replace button with "Sign in to forge"
- If insufficient credits: disable button, show "Buy credits" link
- On success: balance updates, icons load in

**New server action: `getUserCreditsAction`**
- Returns `{ credits, monthlyCapacity, capacityUsed, tier }` for the current user
- Called on page load to populate the UI

---

## Stage 4 — Stripe Integration

**Products:**
- Starter Monthly ($5), Starter Annual ($50)
- Pro Monthly ($12), Pro Annual ($120)
- Credit pack: variable amount (Stripe Payment Links with custom amount, or fixed packs)

**Webhook handlers:**
- `checkout.session.completed` → activate subscription or grant credits
- `invoice.paid` → reset monthly capacity (`capacityUsed = 0`, `capacityResetAt = next period`)
- `customer.subscription.deleted` → downgrade tier, keep purchased credits
- `customer.subscription.updated` → handle upgrades/downgrades

**Transaction fee pass-through for purchases < $5:**
Add Stripe fee to charge amount. Display: "Processing fee of $X applies to purchases under $5."

**Credit rates enforced server-side:**
- Sign In first purchase: 200 credits for $5 (tracked via `firstPurchaseDone` flag on user)
- Sign In subsequent: 35/$
- Starter/Pro overage: 37/$ and 38/$ respectively

**Use Stripe Customer Portal** for subscription management — no need to build cancel/upgrade UI.

---

## Stage 5 — Vetting & Credit Return

- "Submit to gallery" checkbox appears in forge dialog → sets `submittedForVetting: true`, applies 30% discount
- On vetting approval: `returnVettingCredits(recipeId)` credits 30% of `forgeCost` back to purchased balance, logs `vetting_return` transaction
- Admin vetting UI: approve / reject with reason field
- On rejection: notify user, allow resubmit

---

## Staging Validation Checklist

- [ ] New user gets 75 credits on first login
- [ ] Existing recipes show `forged: true`, no forge prompt
- [ ] New recipe shows placeholder icons + credit cost before forging
- [ ] Signed-out user sees "Sign in to forge"
- [ ] Signed-in user with no credits sees "Buy credits"
- [ ] Signed-in user with credits can forge — balance deducts correctly
- [ ] Capacity depletes before purchased credits
- [ ] Purchased credits survive monthly capacity reset
- [ ] 30% discount applies when submitting to gallery
- [ ] Reroll cap enforced at 5/node and 15/recipe
- [ ] Post-forge description edit costs 1 credit
- [ ] Stripe checkout activates subscription / grants credits
- [ ] `invoice.paid` resets monthly capacity
- [ ] Subscription cancel downgrades tier, keeps credits
- [ ] Vetting approval returns 30% credits
- [ ] Transaction log accurate for all flows
- [ ] Stripe fee shown clearly for purchases under $5
- [ ] Placeholder icons display on all unforged nodes

---

## Rollout Order

1. **Stage 1** — separate forge from create, backfill migration (staging first, then prod — safe change)
2. **Stage 2** — placeholder icons (can go to prod independently)
3. **Stage 3** — credit check + forge UI (staging only until Stripe ready)
4. **Stage 4** — Stripe in test mode (staging)
5. **Stage 5** — vetting flow (staging)
6. Full validation checklist
7. **Prod rollout** — grant founding users credits, flip live

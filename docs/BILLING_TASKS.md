# Billing Task List

---

## Stage 1 — Separate Forge from Create

### 1.1 — Remove auto-forge from createVisualRecipeAction
**File:** `app/actions.ts:167`
Remove the `await getDataService().resolveRecipeIcons(id)` call.
Recipe saves but no icons are triggered. Existing tests should still pass.
**Test:** Create a recipe — graph appears, all nodes show placeholder state (no icons).

### 1.2 — Add forgeRecipeAction server action
**File:** `app/actions.ts`
New exported async function `forgeRecipeAction(recipeId: string)`:
- Auth check via `getAuthService().verifyAuth()` — return `{error: 'unauthenticated'}` if no session
- Fetch recipe via `getDataService().getRecipe(recipeId)` — verify caller is owner
- Call `getDataService().resolveRecipeIcons(recipeId)`
- Return `{success: true}` or `{error}`
No credit check yet — that comes in Stage 3.
**Test:** Call `forgeRecipeAction(id)` after creating a recipe — icons generate correctly.

### 1.3 — Backfill migration: mark existing recipes as forged
**File:** new `scripts/backfill-forged.ts`
For all recipes in Firestore: set `forged: true`, `forgeCost: 0`.
So existing recipes don't prompt users to forge.
**Test:** Run script — all existing recipes have `forged: true`. New recipes from 1.1 have `forged: false`.

### 1.4 — Add billing fields to recipe documents
**File:** `lib/recipe-lanes/types.ts` — extend `RecipeGraph` with:
```ts
forged?: boolean
forgeCost?: number
rerollCounts?: Record<string, number>  // nodeId → count
submittedForVetting?: boolean
publicDiscount?: boolean
```
No runtime behaviour change — just type coverage for fields written in later stages.
**Test:** TypeScript compiles cleanly.

---

## Stage 2 — Placeholder Icons

### 2.1 — Create placeholder icon assets
**Location:** `public/placeholders/`
Two SVG files per category is enough to start:
- `ingredient-round.svg`, `ingredient-long.svg`, `ingredient-leaf.svg`
- `action-heat.svg`, `action-mix.svg`, `action-generic.svg`
Simple monochrome silhouettes — intentional, not broken-looking.
**Test:** Assets load at `/placeholders/ingredient-round.svg`.

### 2.2 — Update icon display to use placeholders
**File:** `components/icon-display.tsx`
Currently shows "Forging..." spinner when `!iconUrl && !iconId` (line ~119).
Change: when node has no icon AND recipe is not in forging state, show placeholder image
based on `node.type` + a hash of `node.visualDescription` to pick consistently among variants.
When recipe IS forging, keep the existing spinner.
**Test:** Unforged recipe shows placeholder icons. Forging recipe shows spinners. Forged recipe shows real icons.

### 2.3 — Update IngredientsSidebar placeholder
**File:** `components/recipe-lanes/ui/ingredients-sidebar.tsx:85`
Replace the hardcoded 🥕 emoji with the same placeholder logic from 2.2.
**Test:** Sidebar shows placeholder silhouette instead of carrot emoji for unforged recipes.

### 2.4 — Block unforged recipes from gallery submission
**File:** `app/actions.ts` — in `saveRecipeAction`
If `visibility === 'public'` and `recipe.forged !== true`, return `{error: 'Recipe must be forged before publishing'}`.
**Test:** Attempting to set an unforged recipe to public returns an error.

---

## Stage 3 — User Credit Model

### 3.1 — Add credit fields to user documents
**File:** `lib/data-service.ts` — add a `getUserBilling(userId)` method to the DataService interface and FirebaseDataService implementation:
```ts
interface UserBilling {
  credits: number           // purchased/granted, never expire
  monthlyCapacity: number   // resets each billing period
  capacityUsed: number
  capacityResetAt: Timestamp | null
  tier: 'free' | 'signin' | 'starter' | 'pro'
  tierExpiresAt: Timestamp | null
  stripeCustomerId: string | null
  firstPurchaseDone: boolean
}
```
Reads from `users/{uid}`. Returns safe defaults if doc doesn't exist yet:
`{ credits: 0, monthlyCapacity: 0, capacityUsed: 0, ..., tier: 'free' }`.
**Test:** `getUserBilling('nonexistent-uid')` returns defaults without throwing.

### 3.2 — Add getUserCreditsAction server action
**File:** `app/actions.ts`
New exported `getUserCreditsAction()`:
- Calls `verifyAuth()` — returns null if not signed in
- Calls `getDataService().getUserBilling(userId)`
- Returns `{ credits, monthlyCapacity, capacityUsed, tier }` (no sensitive fields)
**Test:** Signed-in user gets their billing data. Signed-out returns null.

### 3.3 — Add credit transaction log method
**File:** `lib/data-service.ts`
New `logCreditTransaction(userId, entry)` method:
```ts
interface CreditTransaction {
  type: 'grant' | 'purchase' | 'forge' | 'vetting_return'
  amount: number        // positive = credit in, negative = debit
  recipeId?: string
  description: string
  createdAt: Timestamp
}
```
Writes to `users/{uid}/transactions` subcollection.
**Test:** Call the method — document appears in Firestore under the right path.

### 3.4 — Add deductCreditsForForge method
**File:** `lib/data-service.ts`
New `deductCreditsForForge(userId, recipeId, cost)` method using a Firestore transaction:
1. Reads `users/{uid}` billing fields
2. Computes available = `(monthlyCapacity - capacityUsed) + credits`
3. If `available < cost` → throws `InsufficientCreditsError`
4. Deducts from `capacityUsed` first, then `credits`
5. Calls `logCreditTransaction` with `type: 'forge', amount: -cost`
**Test:**
- User with 10 credits, cost 5 → success, credits become 5
- User with 0 credits, cost 5 → throws `InsufficientCreditsError`
- User with 3 capacity remaining + 5 purchased, cost 7 → capacity goes to 0, purchased goes to 1

### 3.5 — Grant signup bonus on first login
**File:** `lib/data-service.ts` — add `grantSignupBonus(userId)` method:
- Checks if `users/{uid}.signupBonusGranted === true` — if so, returns early (idempotent)
- Adds 75 to `credits`
- Sets `signupBonusGranted: true`
- Logs `grant` transaction: "Signup bonus"
**File:** `app/api/auth/login/route.ts` — call `grantSignupBonus(uid)` after session cookie is set.
**Test:** First login → user gets 75 credits. Second login → credits unchanged.

### 3.6 — Wire credit check into forgeRecipeAction
**File:** `app/actions.ts` — update `forgeRecipeAction(recipeId, opts?: { submitForVetting?: boolean })`:
1. Auth check
2. Fetch recipe — verify ownership
3. Compute `cost = graph.nodes.length + 1`
4. Apply 30% discount if `opts.submitForVetting` → `cost = Math.ceil(cost * 0.7)`
5. Call `getUserBilling(userId)` — compute available credits
6. If insufficient: return `{ error: 'insufficient_credits', cost, available }`
7. Call `deductCreditsForForge(userId, recipeId, cost)`
8. Update recipe: `forged: true, forgeCost: cost, submittedForVetting: !!opts.submitForVetting, publicDiscount: !!opts.submitForVetting`
9. Call `resolveRecipeIcons(recipeId)`
10. Return `{ success: true, cost, remainingCredits }`
**Test:**
- User with enough credits: forges, credits deducted, icons generate
- User with no credits: returns `insufficient_credits` error, no icons queued
- `submitForVetting: true`: cost is 30% cheaper, recipe gets `submittedForVetting: true`

---

## Stage 4 — Forge UI

### 4.1 — Load user credits on lanes page
**File:** `app/lanes/page.tsx`
Add state: `const [userBilling, setUserBilling] = useState<UserBilling | null>(null)`
On mount (and when `user` changes): call `getUserCreditsAction()` and set state.
**Test:** Billing state populates when signed in, null when signed out.

### 4.2 — Compute and show forge cost
**File:** `app/lanes/page.tsx`
Derive `forgeCost = graph ? graph.nodes.length + 1 : 0` from graph state.
Show it near the forge button: "Forging costs {forgeCost} credits".
No button yet — just the display.
**Test:** Graph with 20 nodes shows "Forging costs 21 credits".

### 4.3 — Add Forge button (replaces auto-forge)
**File:** `app/lanes/page.tsx`
Currently `handleVisualize()` implicitly forges. Now:
- After graph loads, show a "Forge Icons — {forgeCost} credits" button
- Button is only shown when `graph !== null && !graph.forged`
- Button calls a new `handleForge()` function which calls `forgeRecipeAction(recipeId)`
- Sets `status = 'forging'` during the call, then `'complete'`
- If `error === 'insufficient_credits'`: show inline message "You need {cost} credits — [Buy credits]"
- If not signed in: show "Sign in to forge" which calls existing `signIn()`
**Test:**
- Signed-out user sees "Sign in to forge"
- Signed-in user with no credits sees "You need N credits"
- Signed-in user with credits sees "Forge Icons — N credits", clicking it triggers forging

### 4.4 — Submit to gallery checkbox in forge flow
**File:** `app/lanes/page.tsx`
Before confirming forge, show:
- Checkbox: "Submit to gallery for vetting (saves 30% — costs {discountedCost} credits)"
- Only shown if recipe is `unlisted` (not already submitted)
Pass `submitForVetting` to `forgeRecipeAction`.
**Test:** Checking the box reduces displayed cost by 30%.

### 4.5 — Show credit balance in UI
**File:** `app/lanes/page.tsx`
Show `{userBilling.credits + (userBilling.monthlyCapacity - userBilling.capacityUsed)} credits available`
somewhere unobtrusive (e.g. near the forge button or in the user menu).
Update balance after a successful forge using the `remainingCredits` returned from `forgeRecipeAction`.
**Test:** Balance updates immediately after forging without a page reload.

### 4.6 — Reroll cap enforcement
**File:** `app/actions.ts` — in `rejectIcon` server action (line 44):
- Fetch recipe, read `graph.rerollCounts[nodeId] ?? 0`
- Compute `recipeTotal = sum of all rerollCounts values`
- If node count ≥ 5 or recipe total ≥ 15: return `{ error: 'reroll_limit_reached' }`
- On success: increment `graph.rerollCounts[nodeId]`
**File:** `components/nodes/minimal-node.tsx` — in `handleReroll()`:
- If response is `reroll_limit_reached`: show tooltip "Reroll limit reached — edit the description to change this icon"
- Disable reroll button when node count ≥ 5
**Test:**
- 4 rerolls on a node: button still active
- 5th reroll: button disabled with tooltip
- 15 total rerolls on recipe: all reroll buttons disabled

---

## Stage 5 — Stripe Integration

### 5.1 — Add Stripe dependency and config
```
npm install stripe @stripe/stripe-js
```
**File:** `lib/config.ts` — add:
```ts
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!
export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
```
Add to `.env` and `.env.staging`.
**Test:** Config loads without throwing.

### 5.2 — Create Stripe products (manual, one-time)
In Stripe dashboard (test mode first):
- Starter Monthly: $5/mo recurring
- Starter Annual: $50/yr recurring
- Pro Monthly: $12/mo recurring
- Pro Annual: $120/yr recurring
- Credit pack: one-time payment, custom amount
Record all price IDs in `.env` as `STRIPE_PRICE_STARTER_MONTHLY` etc.

### 5.3 — Add Stripe customer creation to user flow
**File:** `lib/data-service.ts` — add `getOrCreateStripeCustomer(userId, email)`:
- Checks `users/{uid}.stripeCustomerId` — returns it if set
- Otherwise calls `stripe.customers.create({ email, metadata: { firebaseUid: uid } })`
- Saves `stripeCustomerId` to `users/{uid}`
- Returns customer ID
**Test:** Called twice for same user → only one Stripe customer created.

### 5.4 — Create checkout session action
**File:** `app/actions.ts` — add `createCheckoutSessionAction(priceId: string, creditAmount?: number)`:
- Auth check
- Call `getOrCreateStripeCustomer(userId, user.email)`
- For subscriptions: `stripe.checkout.sessions.create({ mode: 'subscription', ... })`
- For credit purchases: `stripe.checkout.sessions.create({ mode: 'payment', ... })`
  - Credit purchases < $5: add Stripe fee to line item amount
  - Track if `firstPurchaseDone` to apply first-purchase parity (200 credits for first $5)
- Returns `{ url }` for redirect
**Test:** Returns a valid Stripe checkout URL for each product type.

### 5.5 — Stripe webhook handler
**File:** `app/api/stripe/webhook/route.ts` (new file)
POST handler, verify signature with `stripe.webhooks.constructEvent`.
Handle events:
- `checkout.session.completed`:
  - If subscription: call `activateSubscription(userId, tier, periodEnd)`
  - If payment: call `grantPurchasedCredits(userId, creditAmount)`
- `invoice.paid`: call `resetMonthlyCapacity(userId, newPeriodEnd)`
- `customer.subscription.deleted`: call `downgradeToFree(userId)`
- `customer.subscription.updated`: call `updateTier(userId, newTier)`

New `lib/data-service.ts` methods referenced above:
- `activateSubscription(userId, tier, periodEnd)` — sets tier, monthlyCapacity, capacityResetAt
- `grantPurchasedCredits(userId, amount)` — adds to credits, logs transaction
- `resetMonthlyCapacity(userId, newPeriodEnd)` — sets `capacityUsed: 0`, updates `capacityResetAt`
- `downgradeToFree(userId)` — sets `tier: 'free', monthlyCapacity: 0, tierExpiresAt: null`
**Test (use Stripe CLI `stripe listen`):**
- Simulate `checkout.session.completed` for subscription → user gets tier + capacity
- Simulate `invoice.paid` → capacity resets
- Simulate `customer.subscription.deleted` → user downgraded to free, credits intact

### 5.6 — Add billing/pricing page
**File:** `app/billing/page.tsx` (new)
Simple page showing:
- Current tier and balance
- Subscribe buttons → call `createCheckoutSessionAction` → redirect to Stripe
- "Buy credits" with amount input → same flow
- Link to Stripe Customer Portal for managing existing subscription:
  `stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: ... })`
**Test:** Each button redirects to correct Stripe checkout. Customer portal link works.

---

## Stage 6 — Vetting Flow

### 6.1 — Connect submittedForVetting to vetting queue
**File:** `app/actions.ts` — in `forgeRecipeAction`, after `resolveRecipeIcons`:
If `opts.submitForVetting`, call `getDataService().submitForVetting(recipeId)` which sets
`recipes/{id}.submittedForVetting: true` and adds to vetting queue (existing `getUnvettedRecipes` query covers this).
**Test:** Forging with `submitForVetting` → recipe appears in `getUnvettedRecipesAction()` results.

### 6.2 — Vetting credit return on approval
**File:** `app/actions.ts` — update `approveRecipeAction` (or create it if missing):
After setting `isVetted: true` and `visibility: 'public'`:
- Read `forgeCost` and `publicDiscount` from recipe
- If `publicDiscount: true`: compute return = `Math.floor(forgeCost * 0.3)`
- Call `grantPurchasedCredits(ownerId, return)` with `type: 'vetting_return'`
**Test:** Approving a recipe with `publicDiscount: true` and `forgeCost: 20` → owner gets 6 credits back.

### 6.3 — Admin vetting UI
**File:** wherever the existing admin vetting UI lives (check `getUnvettedRecipesAction` call sites)
Add approve/reject buttons if not already present.
Reject requires a reason string — store on recipe as `vettingRejectionReason`.
Notify user on rejection (in-app notification or email TBD).
**Test:** Admin can approve and reject recipes. Approved recipes appear in gallery. Rejected recipes get reason field set.

---

## Stage 7 — Founding Users & Launch Prep

### 7.1 — Founding user grant script
**File:** `scripts/grant-founding-users.ts`
Accepts a list of UIDs (hardcoded or from args).
For each: sets `monthlyCapacity` equivalent to 5 recipes (~125 credits) as a permanent monthly grant,
adds 20 one-time bonus credits, logs transactions.
This is a one-time script — run against prod at launch.
**Test:** Run against staging with test UIDs — verify credits and capacity appear correctly.

### 7.2 — Backfill all existing users to tier: free
**File:** `scripts/backfill-user-tiers.ts`
Sets `tier: 'free'`, `credits: 0`, `monthlyCapacity: 0`, `capacityUsed: 0` on all existing `users/{uid}` docs
that don't already have billing fields.
**Test:** Run script — all user docs have billing fields, no existing data overwritten.

---

## Validation Checklist (run in staging before prod)

- [ ] New user gets 75 credits on first login
- [ ] Existing recipes show `forged: true`, no forge prompt shown
- [ ] New recipe: graph appears with placeholder icons + credit cost shown
- [ ] Signed-out user sees "Sign in to forge"
- [ ] Signed-in, no credits: sees "You need N credits" with buy link
- [ ] Signed-in, has credits: forge button works, balance deducts correctly
- [ ] Monthly capacity depletes before purchased credits
- [ ] Purchased credits survive monthly capacity reset
- [ ] 30% discount applied when submitting to gallery
- [ ] Discounted cost shown in UI before confirming
- [ ] Reroll cap: 5/node and 15/recipe enforced, button disabled with message
- [ ] Post-forge description edit costs 1 credit, reroll count resets for that node
- [ ] Stripe checkout → subscription activates, capacity appears
- [ ] `invoice.paid` webhook resets monthly capacity
- [ ] Subscription cancel → downgraded to free, purchased credits intact
- [ ] Vetting approval → 30% credits returned to owner
- [ ] Transaction log accurate for: forge, grant, purchase, vetting_return
- [ ] Stripe fee shown for purchases under $5
- [ ] Placeholder icons on unforged nodes look intentional, not broken
- [ ] Unforged recipe cannot be set to public

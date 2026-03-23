# RecipeLanes Billing Model

The graph is always free to create. Credits are spent at **forge time** when AI icons are generated.

---

## Credit Formula

```
recipe_cost (credits) = node_count + 1
```

Based on production data (229 recipes): **80% of recipes cost under $1** at the subscriber rate.

| Stat | Nodes | Credits | Subscriber cost | À la carte cost |
|---|---|---|---|---|
| Median recipe | 21 | 22 | $0.55 | $0.63 |
| Mean recipe | 24 | 25 | $0.63 | $0.71 |
| P80 recipe | 38 | 39 | **$0.98** | **$1.11** |
| P90 recipe | 44 | 45 | $1.13 | $1.29 |

---

## Credit Rates

| | Sign In | Starter | Pro |
|---|---|---|---|
| Rate | 35 credits / $1 | 40 credits / $1 | 40 credits / $1 |
| First $5 purchase | 200 credits (Starter rate) | — | — |
| Subsequent purchases | 35 credits / $1 | 40 credits / $1 | 40 credits / $1 |

**First purchase parity:** A Sign In user's first $5 credit purchase gets 200 credits — the same as a Starter month — so there's no penalty for trying before subscribing. Subsequent Sign In purchases are at the standard 35/$ rate.

Transaction fee (Stripe) passed to user on purchases under $5.

---

## Tiers

| | **Public** | **Sign In** | **Starter** | **Pro** |
|---|---|---|---|---|
| Monthly | — | — | $5 | $12 |
| Yearly | — | — | $50 | $120 |
| Signup credits | — | 75 | — | — |
| Included credits/mo | — | — | 200 | 480 |
| Typical recipes/mo | — | ~3 to try | ~8 | ~19 |
| Credit rate | — | 35/$ | 40/$ (incl.) + 37/$ (extra) | 40/$ (incl.) + 38/$ (extra) |
| Export PNG/SVG | — | — | ✓ | ✓ |
| Remove branding | — | — | — | ✓ |

Yearly = 10× monthly (2 months free). Monthly capacity resets each billing date; purchased credits never expire.

---

## Commercial *(Coming Soon)*

| | **Blogger** | **Studio** | **Enterprise** |
|---|---|---|---|
| Monthly | $30 | $100 | Custom |
| Yearly | $300 | $1,000 | Custom |
| Custom icon style | ✓ | ✓ | ✓ |
| Embeddable widget | ✓ | ✓ | ✓ |
| White-label | — | ✓ | ✓ |
| API access | — | ✓ | ✓ |
| Bulk import | — | ✓ | ✓ |
| Seats | 1 | 5 | Custom |
| SLA | — | — | ✓ |

---

## Rerolls

- 5 rerolls per node, 15 per recipe (all tiers)
- Free — platform absorbs the cost

---

## Post-Forge Edits

Edit a visual description before forging: free. Edit after forging: costs 1 credit and resets that node's reroll budget.

---

## Public Recipe Discount

Check "submit to gallery" before forging → 30% off the forge cost, applied immediately.
Discount is kept regardless of vetting outcome.

Vetting checks: recipe has a title, all icons generated, sensible graph, not a duplicate.

---

## Legal

- Users warrant they have the right to share submitted recipes
- Public recipes grant RecipeLanes a license to display, cache, and allow forking
- Graph and icons are AI-generated
- Forked recipes are independent copies with attribution to the original
- Commercial use of gallery content requires a Commercial license
- DMCA: dmca@recipelanes.com

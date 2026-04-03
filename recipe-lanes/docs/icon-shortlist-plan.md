# Icon Shortlist & Forge Plan

## Problem

When searching for an icon to represent a recipe action node, the current approach matches the **visual description** (what the image looks like) against embeddings of other visual descriptions. This breaks when similar-looking images have very different descriptions — e.g. "cross-section of chicken pot pie with golden pastry, peas, corn, and chicken in gravy" doesn't find the right icon because no other icon description uses those exact terms.

The root cause: visual descriptions are written *about* what to generate, not *about* what to search for.

## Proposed Solution: Structured Metadata + LLM Shortlisting

### Generation pipeline changes (upstream)

When a new action node is created and an icon is being generated:

1. **LLM generates structured metadata** alongside the visual description:
   - `searchTerms`: 3–6 short search queries that would find similar images (e.g. `["pot pie", "pastry crust", "pie cross section", "comfort food bake"]`)
   - `visualTags`: concrete visual elements present (e.g. `["golden crust", "layered filling", "baking dish", "fork cut"]`)
   - `category`: high-level food action category

2. **Image-to-text captioning**: after icon image is generated, run it through a vision model (Gemini Vision / BLIP-2) to produce a plain-language caption. Store this alongside the visual description. This "bridges" what the image actually looks like to what users might search for.

### Icon retrieval (at recipe-render time)

When an action node needs an icon and nothing is cached:

1. Use `searchTerms` + `visualTags` (not the raw visual description) to query:
   - Text embedding search against captions (img→txt)
   - BM25 over captions + searchTerms
   - CLIP cross-modal search (text → image embedding)
2. Collect **top 30 candidates** across all methods, deduplicate
3. **LLM re-ranker**: given the action description + search terms + 30 candidate icons (with their captions/descriptions), pick the best 5–8 and return an ordered shortlist
4. Cache the shortlist against the visual description hash

### User-facing UI

- Default: show the **#1 icon** from shortlist (same as today)
- **Re-roll button**: cycles through shortlist positions 2→3→4…→N, then wraps to default fry pan / carrot emoji fallback, then back to #1
- **Forge button**: costs coins/credits — triggers fresh icon generation for that specific node
  - Multi-select: user can select multiple nodes and forge all at once (reuse existing node-select tooling)
- Shortlist is per-node and persists; re-rolls are free (within the shortlist)

## Demo Plan (immediate)

Goal: prove the chicken pot pie case works.

1. **Caption existing icons**: run Gemini Vision over the ~1,684 icons with images, store captions in `ie_data/captions.json`
2. **Build caption search**: POST query → embed with Gemini text → cosine sim against caption embeddings
3. **Hybrid retrieval demo**: show side-by-side — old (visual description embedding) vs new (caption search + BM25 + CLIP) for the chicken pie query
4. **LLM shortlist demo**: pipe top 30 into Gemini, get back a ranked shortlist with reasoning

## Better Embedding Options to Explore

| Model | Strength | Notes |
|-------|----------|-------|
| CLIP (current) | Cross-modal text→image | Works but query distribution mismatch |
| SigLIP (Google) | Better CLIP, longer text | Drop-in via `transformers` |
| BLIP-2 captioning | img→txt captions | Use for pre-computing captions |
| Gemini Vision | img→txt, high quality | API cost but already integrated |
| Nomic Embed Vision | Multimodal, open | Good open-source option |

**Recommended path**: BLIP-2 or Gemini Vision for captions (one-time batch) + existing Gemini text embeddings for caption search. This reuses the infrastructure already built and directly addresses the description-vs-caption mismatch.

## Relation to Billing / Free Tier

- Shortlist pre-computation happens at recipe creation time (server-side, one cost)
- Re-rolls are free — no additional API calls at UI time
- Forge is the credit-gated upsell for users who want a custom icon
- Bulk forge (multi-select) is a power feature — could be a higher tier or bulk-coin purchase

## Open Questions

- Where to store `searchTerms` / `visualTags` / captions: new Firestore field on recipe nodes, or separate collection?
- Shortlist TTL: re-compute when new icons are added to the library?
- Forge queue: same `icon_queue` collection or separate?
- Default fallback set: curate a small set of ~20 emoji-style fallbacks by food category

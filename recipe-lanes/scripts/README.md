# Scripts

All run from `recipe-lanes/` unless noted. Add `--staging` or `--prod` where shown; default is local emulator.

---

## Icon search / pipeline

```bash
# Test the vector search CF with free-text queries or a real recipe
npx tsx scripts/test-search.ts "fresh eggs" "cracked egg" --staging --top 5
npx tsx scripts/test-search.ts --recipe <recipeId> --staging --top 3

# Pull icon shortlist state for every node in a recipe
npx tsx scripts/check-recipe-nodes.ts <recipeId>           # hardcoded staging

# Re-trigger CF search and write shortlists for a stuck recipe
npx tsx scripts/retrigger-recipe-icons.ts --staging <recipeId>

# Find an icon by ID prefix
npx tsx scripts/find-icon.ts <icon-id-prefix> --staging

# Dump icon_index to JSON (used by CF for in-memory vector search)
npx tsx scripts/export-icon-index.ts --staging
```

## Logs

```bash
# Pull app + CF logs for a recipe from Cloud Logging
bash scripts/recipe-logs.sh <recipeId> [--prod] [--since 30m]

# Deploy / test / check status of the vector search CF
bash scripts/vector-search.sh deploy --staging
bash scripts/vector-search.sh test --staging "a bowl of eggs"
bash scripts/vector-search.sh status --staging
```

## Backfills

```bash
# Backfill icon_index with MiniLM embeddings for existing icons
npx tsx scripts/backfill-icon-index.ts --staging

# Backfill visual descriptions on icon_index docs
npx tsx scripts/backfill-icon-visual-description.ts --staging

# Backfill icon shortlists on recipes using CF search
npx tsx scripts/backfill-recipe-shortlists.ts --staging [--dry-run]

# Backfill HyDE search terms on recipe nodes
npx tsx scripts/backfill-search-terms.ts --staging

# Backfill ingredient name metadata
npx tsx scripts/backfill-names.ts --staging
```

## DB / Admin

```bash
# Pull a full DB snapshot to local JSON
npx tsx scripts/pull-db.ts --staging

# Backup staging Firestore to file
npx tsx scripts/backup-staging.ts

# List most recent recipes
npx tsx scripts/list-latest-recipes.ts --staging

# Grant admin role to a user
npx tsx scripts/make-admin.ts <uid> --staging

# Inspect icon queue / orphan state
npx tsx scripts/forensics-query.ts --staging
```

## Tests / dev

```bash
bash scripts/test-unit.sh
bash scripts/test-e2e.sh
bash scripts/start-emulators.sh
```

---

## investigation/

One-off diagnostic scripts, not maintained. See filenames.

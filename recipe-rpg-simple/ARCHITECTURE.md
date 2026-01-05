# Architecture: Recipe Lanes (Schema V2 & Unified Queue)

## Overview
Recipe Lanes uses a decoupled, queue-based architecture for AI asset generation to ensure scalability, reliability, and concurrency management. The database schema has been migrated to a more efficient structure (`ingredients_new`) to support this.

## Database Schema V2

### 1. `ingredients_new` (Collection)
Primary storage for ingredient metadata and their associated icons. Replaces the legacy `ingredients` collection and its subcollections.

*   **Doc ID:** `StandardizedName` (e.g. "Carrot", "Olive Oil")
*   **Fields:**
    *   `name`: string (Canonical Name)
    *   `icons`: Array of Icon Objects (Cache)
        *   `id`: string (UUID)
        *   `url`: string (Public Storage URL)
        *   `score`: number (Wilson Score)
        *   `impressions`: number
        *   `rejections`: number
        *   `visualDescription`: string
    *   `created_at`: Timestamp
    *   `updated_at`: Timestamp

### 2. `icon_queue` (Collection)
Work queue for the Cloud Function (`processIconQueue`).

*   **Doc ID:** `StandardizedName`
*   **Fields:**
    *   `status`: 'pending' | 'processing' | 'completed' | 'failed'
    *   `recipes`: Array of Recipe IDs waiting for this icon (for optimistic updates)
    *   `created_at`: Timestamp
    *   `error`: string (optional)

### 3. `feed_icons` (Collection)
Flat collection of all generated icons, used for the "Live Gallery" feed.

*   **Doc ID:** `IconID`
*   **Fields:**
    *   `url`, `ingredient`, `created_at`, `score`, etc.

### 4. `recipes` (Collection)
Stores the Recipe Graph and user preferences.

*   **Fields:**
    *   `graph`: RecipeGraph Object
        *   `nodes`: Array of Nodes (containing `iconUrl`, `iconId`, `visualDescription`)
        *   `rejections`: Map<IngredientName, RejectedIconIDs[]> (Persistent User Rejections)

## Unified Icon Queue

All icon generation requests (whether from the Main Page, Recipe Lanes, or Rerolls) flow through a single entry point:

1.  **Client/Action:** Calls `DataService.queueIcons(items)`.
2.  **DataService:**
    *   Checks `ingredients_new` Cache (respecting `rejectedIds`).
    *   If Cache Hit: Returns immediately.
    *   If Cache Miss: Writes to `icon_queue`.
3.  **Cloud Function (`processIconQueue`):**
    *   Triggers on write to `icon_queue`.
    *   Calls AI Service (Vertex AI / Mock) to generate image.
    *   Saves image to Storage.
    *   Updates `ingredients_new` (adds icon).
    *   Updates `feed_icons`.
    *   Updates `recipes` (Backfills pending nodes).
    *   Marks queue item as `completed`.

## Legacy vs New
*   **Legacy:** `ingredients/{id}/icons/{iconId}`. Direct generation in Server Actions.
*   **New:** `ingredients_new/{Name}`. Async Queue.

## Testing & Migration
*   **Migration Script:** `scripts/migrate-ingredients.ts` moves data from V1 to V2.
*   **Tests:** E2E tests cover the full flow including background worker triggering.

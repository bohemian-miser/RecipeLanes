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

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { db, storage } from '../lib/firebase-admin';
import { createVisualRecipeAction, forgeIconAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';
import { getIconPath } from '../lib/recipe-lanes/model-utils';
import { standardizeIngredientName } from '../lib/utils';

// Use Mocks for parsing to ensure deterministic test.
// "Butter" is used as the ingredient because MockAIService has a local Butter.png,
// preventing the Functions emulator from making an external HTTP fetch for the image.
class MetadataMockAIService extends MockAIService {
    async generateText(prompt: string): Promise<string> {
        const match = prompt.match(/Fry 1 (Metadata-Test-Butter-\d+)/i);
        const name = match ? match[1] : "Metadata-Test-Butter";

        return JSON.stringify({
            title: "Metadata Test",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes: [
                { id: "n1", laneId: "l1", text: "1 Butter", visualDescription: name, type: "ingredient" }
            ]
        });
    }
}
setAIService(new MetadataMockAIService());
setAuthService(new MockAuthService());

describe('Cloud Function Metadata', () => {
    it('should populate icon metadata in storage correctly', async () => {
        const uniqueId = Date.now();
        const ingredientName = `Metadata-Test-Butter-${uniqueId}`;
        const recipeText = `Fry 1 ${ingredientName}`;

        // 1. Create Recipe
        const result = await createVisualRecipeAction(recipeText);
        if (!result.id) throw new Error("Failed to create recipe");
        const recipeId = result.id;

        // 2. Force generation — resolveRecipeIcons may have resolved the ingredient from
        //    stale icon_index entries written by previous test runs, assigning a search result
        //    instead of queuing generation. Calling forgeIconAction clears any shortlist and
        //    queues the ingredient unconditionally (no embedFn → skips index search).
        const forgeResult = await forgeIconAction(recipeId, ingredientName) as any;
        if (!forgeResult?.success) throw new Error(`forgeIconAction failed: ${forgeResult?.error}`);

        // 3. Poll until Background Worker updates the icon.
        // Poll every 500 ms for up to 60 s (120 attempts) to handle a slow emulator
        // on low-power hardware without timing out before the function completes.
        let iconId: string | null = null;
        let iconVisualDescription: string | null = null;
        let attempts = 0;
        const maxAttempts = 120;
        const pollIntervalMs = 500;

        while (attempts < maxAttempts) {
            const doc = await db.collection('recipes').doc(recipeId).get();
            const nodes = doc.data()?.graph?.nodes || [];
            const node = nodes.find((n: any) => n.visualDescription === ingredientName);

            // Icons are stored in the shortlist model: node.iconShortlist[shortlistIndex].icon
            // URLs are derived from visualDescription + id, not stored directly.
            // Only accept a 'generated' icon — search results may point to stale Firestore
            // entries from previous test runs that were never uploaded to Storage.
            const currentEntry = node?.iconShortlist?.[node?.shortlistIndex ?? 0];
            const entryIcon = currentEntry?.icon;
            if (entryIcon?.id && entryIcon?.visualDescription && currentEntry?.matchType === 'generated') {
                iconId = entryIcon.id;
                iconVisualDescription = entryIcon.visualDescription;
                break;
            }

            await new Promise(r => setTimeout(r, pollIntervalMs));
            attempts++;
        }

        assert.ok(iconId, `Background worker did not update icons within ${(maxAttempts * pollIntervalMs) / 1000}s.`);

        // 4. Verify Storage Metadata — derive path the same way getIconPublicUrl() does.
        const filePath = getIconPath(iconId!, standardizeIngredientName(iconVisualDescription!));
        
        const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app');
        const file = bucket.file(filePath);
        
        const [metadata] = await file.getMetadata();
        const custom = metadata.metadata || {};

        console.log(`[DEBUG] Storage Path: ${filePath}`);
        console.log(`[DEBUG] Fetched Metadata:`, JSON.stringify(custom, null, 2));

        assert.ok(custom.geometry, "Missing geometry");
    });
});

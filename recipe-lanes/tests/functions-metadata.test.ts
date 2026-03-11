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
import { createVisualRecipeAction } from '../app/actions';
import { setAIService, MockAIService } from '../lib/ai-service';
import { setAuthService, MockAuthService } from '../lib/auth-service';

// Use Mocks for parsing to ensure deterministic test
class MetadataMockAIService extends MockAIService {
    async generateText(prompt: string): Promise<string> {
        const match = prompt.match(/Fry 1 (Metadata-Test-Ham-\d+)/i);
        const name = match ? match[1] : "Metadata-Test-Ham";
        
        return JSON.stringify({
            title: "Metadata Test",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes: [
                { id: "n1", laneId: "l1", text: "1 Ham", visualDescription: name, type: "ingredient" }
            ]
        });
    }
}
setAIService(new MetadataMockAIService());
setAuthService(new MockAuthService());

describe('Cloud Function Metadata', () => {
    it('should populate icon metadata in storage correctly', async () => {
        const uniqueId = Date.now();
        const ingredientName = `Metadata-Test-Ham-${uniqueId}`;
        const recipeText = `Fry 1 ${ingredientName}`;

        // 1. Create Recipe
        const result = await createVisualRecipeAction(recipeText);
        if (!result.id) throw new Error("Failed to create recipe");
        const recipeId = result.id;

        // 2. Poll until Background Worker updates the icon
        let iconUrl: string | null = null;
        let attempts = 0;
        const maxAttempts = 30;

        while (attempts < maxAttempts) {
            const doc = await db.collection('recipes').doc(recipeId).get();
            const nodes = doc.data()?.graph?.nodes || [];
            const node = nodes.find((n: any) => n.visualDescription === ingredientName);

            if (node?.icon?.url && node?.icon?.id) {
                iconUrl = node.icon.url;
                break;
            }

            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        assert.ok(iconUrl, "Background worker timed out or failed to update icons.");

        // 3. Verify Storage Metadata
        let filePath: string;
        if (iconUrl.includes('/o/')) {
            const matches = iconUrl.match(new RegExp('/o/([^?]+)'));
            if (!matches || !matches[1]) throw new Error("Could not parse Storage path");
            filePath = decodeURIComponent(matches[1]);
        } else {
            const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
            const parts = iconUrl.split(bucketName);
            filePath = decodeURIComponent(parts[1]);
            if (filePath.startsWith('/')) filePath = filePath.substring(1);
        }
        
        const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app');
        const file = bucket.file(filePath);
        
        const [metadata] = await file.getMetadata();
        const custom = metadata.metadata || {};

        console.log(`[DEBUG] Storage Path: ${filePath}`);
        console.log(`[DEBUG] Fetched Metadata:`, JSON.stringify(custom, null, 2));

        assert.ok(custom.geometry, "Missing geometry");
    });
});

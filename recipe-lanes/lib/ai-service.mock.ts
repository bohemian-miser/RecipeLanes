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

import * as fs from 'fs';
import * as path from 'path';
import type { AIService } from './ai-service';

export class MockAIService implements AIService {
  async generateText(prompt: string): Promise<string> {
    const lower = prompt.toLowerCase();
    // TODO only log the interesting bit. Disable for now.
    // console.log("[MockAIService] generateText received prompt:", prompt);
    if (lower.includes("test eggs")) {
        let extraIngredient = lower.includes("test eggs with ") ? lower.split("test eggs with ")[1].trim() : null;

        // Clean up extracted ingredient
        if (extraIngredient) {
            if (extraIngredient.startsWith('"')) extraIngredient = extraIngredient.slice(1);
            if (extraIngredient.endsWith('"')) extraIngredient = extraIngredient.slice(0, -1);
            if (extraIngredient.endsWith('.')) extraIngredient = extraIngredient.slice(0, -1);
        }

        const nodes = [
                { id: "1", laneId: "l1", text: "2 Eggs", type: "ingredient", visualDescription: "Egg" },
                { id: "2", laneId: "l1", text: "100g Flour", type: "ingredient", visualDescription: "Flour" },
                { id: "3", laneId: "l1", text: "Mix", type: "action", inputs: ["1", "2"], visualDescription: "Mixing bowl" }
        ];

        if (extraIngredient) {
            nodes.push({ id: "4", laneId: "l1", text: extraIngredient, type: "ingredient", visualDescription: extraIngredient });
            // @ts-ignore
            nodes[2].inputs.push("4");
        }

        return JSON.stringify({
            title: "Mock Recipe",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes
        });
    }
    if (lower.includes("complex")) {
        return JSON.stringify({
            title: "Complex Mock Recipe",
            lanes: [
                { id: "l1", label: "Prep", type: "prep" },
                { id: "l2", label: "Cook", type: "cook" }
            ],
            nodes: [
                // Parents (ingredients)
                { id: "1", laneId: "l1", text: "Ingredient A", type: "ingredient", visualDescription: "Ing A" },
                { id: "2", laneId: "l1", text: "Ingredient B", type: "ingredient", visualDescription: "Ing B" },
                // A and B (first level actions)
                { id: "3", laneId: "l1", text: "Process A", type: "action", inputs: ["1"], visualDescription: "Proc A" },
                { id: "4", laneId: "l1", text: "Process B", type: "action", inputs: ["2"], visualDescription: "Proc B" },
                // C - common node that A and B both point to
                { id: "5", laneId: "l2", text: "Combine (Common)", type: "action", inputs: ["3", "4"], visualDescription: "Common" },
                // D - extra thing A points to
                { id: "6", laneId: "l1", text: "Extra from A", type: "action", inputs: ["3"], visualDescription: "Extra A" },
                // E - extra thing B points to
                { id: "7", laneId: "l1", text: "Extra from B", type: "action", inputs: ["4"], visualDescription: "Extra B" },
                // F - one of the things C points to, also receives from D
                { id: "8", laneId: "l2", text: "Final Step F", type: "action", inputs: ["5", "6"], visualDescription: "Final F" },
                // G - the other thing C points to
                { id: "9", laneId: "l2", text: "Final Step G", type: "action", inputs: ["5"], visualDescription: "Final G" },
            ]
        });
    }
    // Generic fallback for E2E tests - Try to extract ingredient from prompt
    // Prompt usually contains: "convert the following cooking instructions... Input Recipe ... "
    // Handle both quoted and unquoted inputs, and varying newlines
    const potatoesMatch = prompt.match(/test (\d+) potato(?: suffix (.+))?/i);
    if (potatoesMatch) {
         const count = parseInt(potatoesMatch[1], 10);
         const suffix = potatoesMatch[2] ? ` ${potatoesMatch[2].trim()}` : '';
         const nodes = [];
         const inputs = [];

         for (let i = 1; i <= count; i++) {
             nodes.push({
                 id: `p${i}`,
                 laneId: "l1",
                 text: `Potato ${i}${suffix}`,
                 type: "ingredient",
                 visualDescription: `Potato ${i}${suffix}`
             });
             inputs.push(`p${i}`);
         }

         nodes.push({
             id: "mash",
             laneId: "l2",
             text: "Mash",
             type: "action",
             inputs: inputs,
             visualDescription: "Mashing"
         });

         return JSON.stringify({
            title: `Potato Feast (${count})`,
            lanes: [
                { id: "l1", label: "Prep", type: "prep" },
                { id: "l2", label: "Cook", type: "cook" }
            ],
            nodes
        });
    }

    const match = prompt.match(/Input Recipe\s*\n\s*(["']?)([\s\S]*)\1\s*$/);
    let inputDerived = match ? match[2].trim() : "Mock Ingredient 1";
    // Extra cleanup if regex missed something (e.g. mismatched quotes or just one quote captured)
    if (inputDerived.endsWith('"') && !inputDerived.startsWith('"')) {
        inputDerived = inputDerived.slice(0, -1);
    }

    const lines = inputDerived.split('\n').filter(l => l.trim());
    const nodes = lines.map((l, i) => ({
        id: (i + 1).toString(),
        laneId: "l1",
        text: l.trim(),
        type: i === 0 ? "ingredient" : "action" as const,
        inputs: i > 0 ? [i.toString()] : undefined,
        visualDescription: l.trim()
    }));

    return JSON.stringify({
            title: "Mock Recipe",
            lanes: [{ id: "l1", label: "Prep", type: "prep" }],
            nodes: nodes.length > 0 ? nodes : [{ id: "1", laneId: "l1", text: "Mock Ingredient 1", type: "ingredient", visualDescription: "Mock Ingredient 1" }]
        });
  }

  async generateTextFromImage(prompt: string, imageDataUrl: string): Promise<string> {
    // Deterministic mock for the photo-to-recipe flow (issue #182). We can't
    // "read" the image, so return a fixed, recognisable graph. Tests can force
    // a failure by uploading an image whose bytes decode to "FAIL".
    const b64 = imageDataUrl.split(',')[1] ?? '';
    if (Buffer.from(b64, 'base64').toString('utf8') === 'FAIL') {
        return 'ai failed';
    }
    return JSON.stringify({
        title: 'Photo Mock Recipe',
        baseServes: 2,
        originalText: '2 Eggs\n100g Flour\n\n1. Mix eggs and flour.',
        lanes: [{ id: 'l1', label: 'Prep', type: 'prep' }],
        nodes: [
            { id: '1', laneId: 'l1', text: '2 Eggs', type: 'ingredient', visualDescription: 'Egg' },
            { id: '2', laneId: 'l1', text: '100g Flour', type: 'ingredient', visualDescription: 'Flour' },
            { id: '3', laneId: 'l1', text: 'Mix', type: 'action', inputs: ['1', '2'], visualDescription: 'Mixing bowl' },
        ],
    });
  }

  async generateImage(prompt: string): Promise<string> {
    console.log(`[MockAIService] generateImage called for: "${prompt.substring(0, 30)}"...`);

    const knownIngredients = ['Egg', 'Flour', 'Sugar', 'Butter', 'Onion', 'Garlic', 'Milk', 'Mixing Bowl', 'Fry An Egg', 'Ham', 'Cheese'];
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt.includes('force_quota_error')) {
      console.log('[MockAIService] Simulating Quota Error...');
      throw new Error('Quota exceeded (simulated)');
    }

    if (lowerPrompt.includes('slow')) {
      //sleep for 5 sec to simulate image generation.
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Find matching ingredient. Sort by length desc to match "Fry An Egg" before "Egg"
    const match = knownIngredients
        .sort((a, b) => b.length - a.length)
        .find(ing => lowerPrompt.includes(ing.toLowerCase()));

    if (match) {
         // Try to find file
         const possiblePaths = [
             path.join(process.cwd(), 'e2e/test_data/icons/', `${match}.png`),
             path.join(process.cwd(), '../e2e/test_data/icons/', `${match}.png`), // If cwd is functions
             path.join(__dirname, '../../../e2e/test_data/icons/', `${match}.png`) // Relative to compiled lib
         ];

         for (const p of possiblePaths) {
             if (fs.existsSync(p)) {
                 console.log(`[MockAIService] Found local icon at: ${p}`);
                 const buffer = fs.readFileSync(p);
                 return `data:image/png;base64,${buffer.toString('base64')}`;
             }
         }
         console.warn(`[MockAIService] Icon for ${match} not found in search paths: ${possiblePaths.join(', ')}`);
    }

    // Append random UUID to ensure unique URL for each generation (simulate reroll)
    const uuid = Math.random().toString(36).substring(7);
    const url = `https://placehold.co/64x64/png?text=Mock+${encodeURIComponent(prompt.slice(0, 10))}&uuid=${uuid}`;
    console.log(`[MockAIService] Returning mock URL: ${url}`);
    return url;
  }

  async embedTexts(texts: string[]): Promise<number[]> {
    if (texts.length === 0) return [];
    // Deterministic 4-dim mock embedding derived from input text
    const combined = texts.join(' ').toLowerCase();
    const h = combined.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 0);
    return [
      ((h & 0xff) / 255),
      (((h >> 4) & 0xff) / 255),
      (((h >> 8) & 0xff) / 255),
      (((h >> 12) & 0xff) / 255),
    ];
  }
}

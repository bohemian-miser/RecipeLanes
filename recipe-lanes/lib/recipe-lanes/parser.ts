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

import { z } from 'zod';
import type { RecipeGraph } from './types';

// Schema Definition (Matching TypeScript Interface)
const RecipeGraphSchema = z.object({
  title: z.string().optional(),
  lanes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['prep', 'cook', 'serve'])
  })),
  nodes: z.array(z.object({
    id: z.string(),
    laneId: z.string(),
    text: z.string(),
    visualDescription: z.string(),
    hydeQueries: z.array(z.string()).optional(),
    type: z.enum(['ingredient', 'action']),
    inputs: z.array(z.string()).optional(),
    temperature: z.string().optional(),
    duration: z.string().optional()
  }))
});

// Helper: Quantity Parsing
function parseQuantity(text: string): { quantity?: number, unit?: string, canonicalName?: string } {
    // Basic regex: Start with number/fraction, optional unit, then rest
    // e.g. "1.5 kg Flour", "1/2 cup Sugar", "2 Carrots"
    const regex = /^([\d\./]+)\s*([a-zA-Z\.]+)?\s+(.*)$/;
    const match = text.trim().match(regex);
    
    if (!match) {
        // Fallback: Check if just number and name? e.g. "2 Onions"
        const simpleRegex = /^([\d\./]+)\s+(.*)$/;
        const match2 = text.trim().match(simpleRegex);
        if (match2) {
             return { quantity: parseFraction(match2[1]), unit: '', canonicalName: match2[2] };
        }
        return { canonicalName: text };
    }
    
    return { 
        quantity: parseFraction(match[1]), 
        unit: match[2] || '', 
        canonicalName: match[3] 
    };
}

function parseFraction(str: string): number {
    if (str.includes('/')) {
        const [n, d] = str.split('/');
        return parseFloat(n) / parseFloat(d);
    }
    return parseFloat(str);
}

const SCHEMA_INTERFACE = `
interface RecipeGraph {
  title: string; // A concise title for the recipe (e.g. "Spicy Ramen")
  baseServes?: number; // Estimated servings (e.g. 4)
  lanes: {
    id: string;
    label: string; // e.g. "Skillet"
    type: 'prep' | 'cook' | 'serve';
  }[];
  nodes: {
    id: string;
    laneId: string; // Must match a lane.id
    text: string; // Concise instruction e.g. "Add onions" or "2 Onions"
    visualDescription: string; // Detailed prompt for pixel-art icon
    hydeQueries: string[]; // 12 image-search terms for this node's icon (see below)
    type: 'ingredient' | 'action';
    inputs?: string[]; // IDs of previous nodes flowing into this one
    temperature?: string; // e.g. "Medium Heat" (for actions)
    duration?: string; // e.g. "5 min" (for actions)
  }[];
}
`;

export function generateRecipePrompt(recipeText: string): string {
  const BLOCK_START = "```typescript";
  const BLOCK_END = "```";

  return `
You are an expert recipe parser and creator. Your goal is to convert the following cooking instructions into a structured "Swimlane Graph" JSON.
If the instructions are brief or unclear, do your best to fill in the gaps with reasonable assumptions.

### Core Philosophy: The State-Flow Pattern
1. **Ingredient Nodes (Input):** Represent *new* items being added. Visuals show the ingredient in its *prepared* state (e.g. "Chopped Onion").
2. **Action Nodes (State):** Represent the *result* state of the vessel. Visuals show the *combined state* (e.g. "Onions frying in pan").
3. **Lanes (Containers):** Represents physical locations (Bowl, Pan, Pot).

### Critical Rules
1. **QUANTITY:** The 
text\n field for Ingredient Nodes MUST include the specific quantity used in that step (e.g. "3 Eggs", "200g Flour", "Pinch of Salt"). Never just "Eggs".
2. **SPLIT INGREDIENTS:** If an ingredient is divided and used in different steps (e.g. "Add half sugar now, half later"), create **TWO separate Ingredient Nodes** with the partial quantities (e.g. "100g Sugar" and "100g Sugar").
3. **SPLIT OUTPUTS:** If a mixture is divided (e.g. "Pour batter into two pans"), the single Action Node producing the mixture should be listed as an input for **BOTH** destination nodes.
4. **TITLE & SERVES:** Extract a concise 
_title_\n and estimated 
_baseServes_\n (number) from the text.

### Schema
Return ONLY raw JSON complying with this TypeScript interface. No Comments:

${BLOCK_START}
${SCHEMA_INTERFACE}
${BLOCK_END}

### Visual Description Guidelines (CRITICAL)
These are cached, so simplicity and consistency is key.

1. **INGREDIENT Nodes (The "Item"):**
   - **Atomic & Generic:** Visuals must be simple, singular, and reusable inventory items.
   - **Clarify Ambiguity:** If a word has multiple meanings (e.g. "Pepper"), add a qualifier (e.g. "Black Pepper" or "Bell Pepper").
   - **NO Quantities:** Never show specific numbers (e.g. "3 eggs"). Visual should be "egg".
   - **NO Action Context:** Do not show pouring/falling/mixing. Just the item.
   - **Examples:**
     - "3 Eggs" -> "egg"
     - "A pinch of Salt" -> "Salt"
     - "Pepper" -> "Black Pepper"
     - "Bottle of Olive Oil" -> "Olive Oil"
     - "A pat of butter melting in a non stick frying pan" -> "butter in pan"

2. **ACTION Nodes (The "State"):

### hydeQueries Guidelines (CRITICAL)
For every node, generate exactly 12 search terms that describe what its 64×64 icon looks like (colorful, white background, recipe card). Provide:
- 4 short tags (1–3 words, e.g. "oven mitt", "red glove")
- 4 medium phrases (4–6 words, e.g. "red oven mitt icon", "cooking glove recipe")
- 4 longer visual descriptions (7–12 words, e.g. "red oven mitt with white heart and flame, simple icon")

### Input Recipe
"${recipeText}"
`;
}

/**
 * Prompt for generating HyDE search terms for a single ingredient/node name.
 * Used when generating icons outside the recipe flow (e.g. icon_overview direct generation).
 */
export function generateHydeQueriesPrompt(ingredientName: string, nodeType: 'ingredient' | 'action' = 'ingredient'): string {
  const isAction = nodeType === 'action';
  const shortEx = isAction ? '"pan with sauce", "sizzling skillet"' : '"cracked egg", "raw egg"';
  const medEx = isAction ? '"onions frying in pan icon", "saucepan with boiling liquid"' : '"cracked egg icon", "whole egg cooking"';
  const longEx = isAction
    ? '"overhead view of frying pan with golden onions and wisps of steam rising"'
    : '"cracked raw egg, translucent white with bright yellow yolk, oval form"';
  const extra = isAction
    ? '\nFor action icons: ≥2 terms must name the vessel/container (pan, pot, bowl) and ≥2 must describe a visible state cue (steam, bubbles, browning, sizzling).'
    : '\nFor ingredient icons: ≥2 terms must describe colour/shape/texture WITHOUT naming the ingredient (e.g. "white oval grain", "purple layered crescent").';

  return `Generate exactly 12 search terms describing a 64×64 pixel-art icon for "${ingredientName}" in a recipe card style.
Return ONLY a raw JSON array of 12 strings. No explanation, no markdown:
- 4 short tags covering DIFFERENT angles: (1) ingredient/action name, (2) visual synonym or colour, (3) prep/cooking state, (4) category label. (e.g. ${shortEx})
- 4 medium phrases — one semantic (what it IS), one visual (what it LOOKS LIKE), one contextual (how it's used), one categorical. (e.g. ${medEx})
- 4 longer visual descriptions focusing on shape, colour, texture and visible detail — no style or background references. (e.g. ${longEx})${extra}`;
}

/**
 * Parses the LLM response from generateHydeQueriesPrompt into a string[].
 * Returns [] on any parse failure so callers can proceed without queries.
 */
export function parseHydeQueries(aiResponse: string): string[] {
  try {
    let json = aiResponse.trim();
    if (json.startsWith('```')) json = json.replace(/^```(json)?/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) return parsed;
  } catch {}
  return [];
}

export function parseRecipeGraph(aiResponse: string): RecipeGraph {
  // 1. Clean Markdown code blocks if present
  let jsonStr = aiResponse.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(json)?/, "").replace(/```$/, "");
  }
  jsonStr = jsonStr.trim();
  
  try {
    // 2. Parse JSON
    const rawObj = JSON.parse(jsonStr);

    // 3. Post-Process: Enrich Nodes with Parsed Quantities
    if (rawObj.nodes) {
        rawObj.nodes = rawObj.nodes.map((n: any) => {
            if (n.type === 'ingredient' && n.text) {
                const parsed = parseQuantity(n.text);
                return { ...n, ...parsed };
            }
            return n;
        });
    }
    
    // 4. Validate Schema (Relaxed to allow extra fields we just added)
    return rawObj as RecipeGraph; 
  } catch (e) {
    console.error(`[parseRecipeGraph]Failed to parse recipe graph:${e}\n\nResponse:\n${aiResponse}`);
    throw new Error('Invalid AI Response Format');
  }
}

export function extractServes(text: string): number | undefined {
    const match = text.match(/Serves[:\s]*(\d+)/i);
    return match ? parseInt(match[1]) : undefined;
}
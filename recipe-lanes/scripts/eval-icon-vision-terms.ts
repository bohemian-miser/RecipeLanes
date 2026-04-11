/**
 * Evaluation script: use Gemini 2.5 Flash vision to generate search terms from icon images.
 * Processes 10 icons from icon_index, prints the URL and generated terms for each.
 * Does NOT write anything — purely for inspection.
 *
 * Usage:
 *   npx tsx scripts/eval-icon-vision-terms.ts [--staging]
 */

import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
import { DB_COLLECTION_ICON_INDEX } from '../lib/config';
import { scanCollection } from './lib/db-tools';

const staging = process.argv.includes('--staging');

if (staging) {
    dotenv.config({ path: '.env.staging', override: true });
} else {
    dotenv.config();
}

const LIMIT = 10;
const PROJECT = staging ? 'recipe-lanes-staging' : 'recipe-lanes';
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    ?? (staging ? 'recipe-lanes-staging.firebasestorage.app' : 'recipe-lanes.firebasestorage.app');

const PROMPT = `You are generating search terms for a food and cooking icon image library.

How the terms are used: each term gets independently embedded with a sentence model (MiniLM), then all embeddings are averaged into a single vector for this icon. A user's search query is embedded the same way and matched against it. Terms that cluster in the same semantic region waste slots — "truffle oil", "truffle cooking oil", and "oil with truffles" barely shift the average. Terms that cover distinct angles each pull the centroid somewhere new, making the icon reachable from more queries.

Look at the icon carefully. Generate around 12 terms that together cover as much ground as possible:

- The ingredient/dish name and any synonyms or regional alternatives (e.g. "ramen" and "noodle soup", "scallion" and "spring onion", "zucchini" and "courgette")
- Short distinctive visual fragments: dominant colour, shape, or material ("golden liquid", "dark round seeds", "orange broth", "cork stopper")
- Cooking context: dish, cuisine, technique, or meal type
- Ingredient category (dairy, grain, legume, condiment, seafood, etc.)
- 3–4 full descriptive sentences that paint the exact contents of the icon in detail — materials, colours, textures, arrangement. These are the most valuable terms. Write them the way someone would describe a photo to someone who can't see it. Example: "clear glass bottle with a brown cork stopper, containing amber oil and two dark bumpy truffles sitting at the bottom"

DO NOT include: meta-descriptions ("cartoon", "illustration", "icon", "pixel art"), vague filler ("refreshment", "preserved food", "food item", "cooking ingredient"), or near-duplicates of each other.

All lowercase. Return ONLY a JSON array of strings, no explanation, no markdown fences.`;

function iconStorageUrl(iconId: string, ingredientName: string): string {
    const shortId = iconId.substring(0, 8);
    const kebabName = ingredientName.trim().replace(/\s+/g, '-');
    const path = `icons/${kebabName}-${shortId}.png`;
    return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

let cachedToken: string | null = null;
let tokenExpiry = 0;
async function getToken(): Promise<string> {
    if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const t = await client.getAccessToken();
    cachedToken = t.token!;
    tokenExpiry = Date.now() + 3_600_000;
    return cachedToken;
}

async function fetchImageBase64(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image fetch ${res.status}: ${url}`);
    const buf = await res.arrayBuffer();
    return Buffer.from(buf).toString('base64');
}

async function callGeminiVision(imageBase64: string): Promise<string[]> {
    const token = await getToken();
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/png', data: imageBase64 } },
                    { text: PROMPT },
                ],
            }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const clean = raw.trim().replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(clean);
    } catch {
        // Truncated JSON — extract whatever complete strings exist
        const matches = clean.match(/"([^"\\]|\\.)*"/g) ?? [];
        if (matches.length === 0) throw new Error(`Unparseable response: ${clean.slice(0, 100)}`);
        return matches.map(s => JSON.parse(s));
    }
}

async function main() {
    const { db } = await import('../lib/firebase-admin');

    console.log(`ENV:    ${staging ? 'staging' : 'prod'}`);
    console.log(`BUCKET: ${BUCKET}`);
    console.log(`\n--- PROMPT ---\n${PROMPT}\n--- END PROMPT ---\n`);

    let count = 0;
    for await (const doc of scanCollection(db, DB_COLLECTION_ICON_INDEX)) {
        if (count >= LIMIT) break;

        const data = doc.data();
        const name: string = data.ingredient_name ?? doc.id;
        const url = iconStorageUrl(doc.id, name);

        console.log(`\n[${count + 1}/${LIMIT}] ${doc.id}`);
        console.log(`  name: ${name}`);
        console.log(`  url:  ${url}`);

        try {
            const imageBase64 = await fetchImageBase64(url);
            const terms = await callGeminiVision(imageBase64);
            console.log(`  terms (${terms.length}):`);
            terms.forEach((t, i) => console.log(`    ${i + 1}. ${t}`));
        } catch (e: any) {
            console.error(`  ERROR: ${e.message}`);
        }

        count++;
    }

    console.log(`\nDone. Evaluated ${count} icons.`);
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});

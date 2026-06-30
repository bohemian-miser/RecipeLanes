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

import { ai, textModel, imageModelName, embeddingModel } from './genkit';
import { processIcon } from '../functions/src/image-processing';

export interface AIService {
  generateText(prompt: string): Promise<string>;
  generateImage(prompt: string): Promise<string>;
  /** Returns a single averaged embedding vector for the given texts. */
  embedTexts(texts: string[]): Promise<number[]>;
}

export class NodeCFAIService implements AIService {
    async generateText(prompt: string): Promise<string> {
        return new RealAIService().generateText(prompt);
    }
    async generateImage(prompt: string): Promise<string> {
        return new RealAIService().generateImage(prompt);
    }
    async embedTexts(texts: string[]): Promise<number[]> {
        if (texts.length === 0) return [];
        // Average multiple texts if provided, or just embed the first one
        // For simplicity, we just use the first text for the Node CF call right now
        // since the CF is optimized for single query strings.
        const query = texts.join(" "); 
        try {
            const { getFunctions, httpsCallable } = require('firebase/functions');
            const { app } = require('./firebase-client');
            const functions = getFunctions(app, 'us-central1');
            const searchIconVector = httpsCallable(functions, 'vectorSearch-searchIconVector');
            const result: any = await searchIconVector({ query, limit: 1 });
            return result.data.embedding;
        } catch (e: any) {
            console.error("[NodeCFAIService] Failed to get embedding from CF:", e);
            throw e;
        }
    }
}

export class RealAIService implements AIService {
  async generateText(prompt: string): Promise<string> {
    try {
        const response = await ai.generate({
            model: textModel,
            prompt: prompt,
            config: { thinkingConfig: { thinkingBudget: 0 } },
        });
        return response.text || '';
    } catch (e) {
        console.error("Real AI failed, NOT falling back to Mock:", e);
        return "ai failed";
    }
  }

  async generateImage(prompt: string): Promise<string> {
    console.log(`[RealAIService] generateImage called with prompt: "${prompt.substring(0, 30)}"...`);
    try {
        const response = await ai.generate({
        model: imageModelName,
        prompt: prompt,
        });
        if (!response.media || !response.media.url) {
             throw new Error('No media returned');
        }
        console.log(`[RealAIService] Success. URL: ${response.media.url.substring(0, 50)}...`);
        
        // Fetch the image
        const imageResponse = await fetch(response.media.url);
        const imageBuffer = await imageResponse.arrayBuffer();

        // Process the image to remove the background
        const { buffer: processedBuffer } = await processIcon(imageBuffer);

        // Convert the processed buffer to a data URL
        const base64 = processedBuffer.toString('base64');
        const dataUrl = `data:image/png;base64,${base64}`;

        return dataUrl;
    } catch (e) {
        console.error("Real AI Image Generation failed:", e);
        throw e;
    }
  }

  async embedTexts(texts: string[]): Promise<number[]> {
    if (texts.length === 0) return [];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            // Single batched API call via ai.embedMany — one HTTP request for all texts.
            const batch = await ai.embedMany({ embedder: embeddingModel, content: texts });
            const vecs = batch.map(e => e.embedding);
            const dim = vecs[0].length;
            const avg = new Array(dim).fill(0) as number[];
            for (const vec of vecs) {
                for (let i = 0; i < dim; i++) avg[i] += vec[i] / vecs.length;
            }
            return avg;
        } catch (e) {
            lastErr = e;
            if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
    }
    throw lastErr;
  }
}

// App/composition code ALWAYS constructs a real client. No environment flag
// here selects a mock. Tests and the dev/e2e harness swap in MockAIService via
// setAIService() (pure dependency injection) — the mock module is never
// referenced from this file, so it is structurally absent from the prod bundle.
const useNodeCF = process.env.NEXT_PUBLIC_ICON_SEARCH_MODE === 'node_cf';

// The active service is stored on globalThis, NOT a module-scoped `let`.
// Next.js bundles instrumentation.ts and server actions / route handlers into
// SEPARATE module graphs that each get their own instance of this module — a
// plain module variable set by instrumentation's setAIService() would not be
// visible to getAIService() inside a server action. globalThis is shared across
// every module in the one Node server process, so the DI injection propagates.
declare global {
  // eslint-disable-next-line no-var
  var __recipelanesAIService: AIService | undefined;
}

function defaultAIService(): AIService {
  return useNodeCF ? new NodeCFAIService() : new RealAIService();
}

export function getAIService(): AIService {
  if (!globalThis.__recipelanesAIService) {
    globalThis.__recipelanesAIService = defaultAIService();
  }
  return globalThis.__recipelanesAIService;
}

export function setAIService(service: AIService) {
  globalThis.__recipelanesAIService = service;
}
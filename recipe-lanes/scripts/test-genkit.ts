import * as dotenv from 'dotenv';
import * as path from 'path';
import { ai, embeddingModel } from '../lib/genkit';

dotenv.config({ path: path.resolve(__dirname, '../.env.staging') });

async function test() {
    console.log("Embedding 'apple'...");
    const result = await ai.embed({ embedder: embeddingModel, content: 'apple' });
    console.log("Full Result keys:", Object.keys(result));
    console.log("Result content:", JSON.stringify(result).substring(0, 100));
}

test().catch(console.error);

import { GoogleAuth } from 'google-auth-library';
import { PROJECT_ID } from './firebase';

export async function getAccessToken(): Promise<string> {
  const auth = new GoogleAuth({
    keyFile: './staging-service-account.json',
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token!;
}

export async function embedTextVertex(
  text: string, 
  model: string = 'text-embedding-004', 
  region: string = 'us-central1'
): Promise<{ vector: number[], timeMs: number }> {
  const start = Date.now();
  const token = await getAccessToken();
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${region}/publishers/google/models/${model}:predict`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      instances: [{ content: text, task_type: 'RETRIEVAL_QUERY' }] 
    })
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Embed API error: ${res.status} ${errorText}`);
  }
  
  const data = await res.json() as any;
  const vec = data.predictions[0].embeddings.values as number[];
  const timeMs = Date.now() - start;
  
  return { vector: vec, timeMs };
}

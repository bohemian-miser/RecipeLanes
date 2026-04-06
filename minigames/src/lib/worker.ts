import { pipeline, env } from '@xenova/transformers';

// Skip local model caching to work well in dev
env.allowLocalModels = false;

class PipelineSingleton {
  static instances: Record<string, any> = {};

  static async getInstance(model: string) {
    if (!this.instances[model]) {
      console.log(`[Worker] Initializing model: ${model}`);
      this.instances[model] = await pipeline('feature-extraction', model);
    }
    return this.instances[model];
  }
}

self.addEventListener('message', async (event) => {
  const { id, text, model } = event.data;
  
  try {
    const extractor = await PipelineSingleton.getInstance(model);
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    
    self.postMessage({
      id,
      status: 'success',
      vector: Array.from(out.data)
    });
  } catch (error: any) {
    console.error('[Worker] Error embedding:', error);
    self.postMessage({
      id,
      status: 'error',
      error: error.message
    });
  }
});

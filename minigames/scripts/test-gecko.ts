import { embedTextVertex } from '../src/lib/vertex';

async function test() {
  try {
    const res = await embedTextVertex('egg', 'textembedding-gecko@003', 'us-central1');
    console.log('Success!', res.vector.length);
  } catch (e: any) {
    console.error('Failed textembedding-gecko@003:', e.message);
  }
}
test();

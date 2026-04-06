import { NextResponse } from 'next/server';
import { embedTextVertex } from '@/lib/vertex';

export async function POST(req: Request) {
  try {
    const { text, model, region } = await req.json();
    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }
    
    const { vector, timeMs } = await embedTextVertex(text, model, region);
    
    return NextResponse.json({ vector, timeMs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

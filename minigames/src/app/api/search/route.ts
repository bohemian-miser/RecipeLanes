import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: Request) {
  try {
    const { vector, limit = 12 } = await req.json();
    
    if (!vector || !Array.isArray(vector)) {
      return NextResponse.json({ error: 'Vector is required' }, { status: 400 });
    }

    const start = Date.now();
    
    // Choose collection based on vector dimension
    const collectionName = vector.length === 384 ? 'icon_index_browser' : 'icon_index';
    
    const snap = await db.collection(collectionName)
      .findNearest('embedding', FieldValue.vector(vector), { 
        limit, 
        distanceMeasure: 'COSINE' 
      })
      .get();
      
    const timeMs = Date.now() - start;
    
    const results = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      // Remove embedding to save bandwidth
      embedding: undefined 
    }));
    
    return NextResponse.json({ results, timeMs });
  } catch (error: any) {
    console.error('Search error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

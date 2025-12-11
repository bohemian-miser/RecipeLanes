import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { ingredient } = await req.json();
  
  if (!ingredient) {
    return NextResponse.json({ error: 'Ingredient is required' }, { status: 400 });
  }

  // Simulate delay
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Return a mock image URL based on the ingredient length to give some variety
  // Using a stable placeholder service that supports text
  const mockUrl = `https://placehold.co/64x64/png?text=${encodeURIComponent(ingredient)}`;

  return NextResponse.json({ 
    iconUrl: mockUrl 
  });
}

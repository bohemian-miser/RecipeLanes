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
    url: mockUrl 
  });
}
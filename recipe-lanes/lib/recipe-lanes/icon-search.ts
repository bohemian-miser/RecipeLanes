import type { IconStats } from './types';

export interface IconSearchResult {
  shortlist: IconStats[]
  queryUsed: string
  method: string
}

export async function searchIconsForNode(
  hydeQueries: string[],
  embedText: (texts: string[]) => Promise<number[]>,
  findNearest: (vec: number[], limit: number) => Promise<IconStats[]>,
  opts?: { limit?: number; excludeIds?: string[] }
): Promise<IconSearchResult> {
  if (hydeQueries.length === 0) {
    return { shortlist: [], queryUsed: '', method: 'hyde_avg_firestore' };
  }

  const vec = await embedText(hydeQueries);
  const raw = await findNearest(vec, opts?.limit ?? 8);

  const excludeSet = new Set(opts?.excludeIds ?? []);
  const shortlist = raw.filter(icon => !excludeSet.has(icon.id));

  return {
    shortlist,
    queryUsed: hydeQueries.join(' | '),
    method: 'hyde_avg_firestore',
  };
}

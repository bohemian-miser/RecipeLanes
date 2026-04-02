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

// --- Input Graph (From AI Parser) ---

export interface Lane {
  id: string;
  label: string; // e.g. "Skillet", "Bowl"
  type: 'prep' | 'cook' | 'serve';
}

export interface SearchTerm {
  text: string
  embedding?: number[]
  source: 'hyde_from_img' | 'user_desc' | 'llm_vision'
  addedAt: number
}

export interface IconStats {
    id: string;
    url?: string;
    path?: string;
    score?: number;
    prompt?: string;
    impressions?: number;
    rejections?: number;
    metadata?: {
        center: { x: number, y: number };
        bbox: { x: number, y: number, w: number, h: number };
    };
    status?: 'pending' | 'processing' | 'failed';
    searchTerms?: SearchTerm[];
}

export interface ShortlistEntry {
    icon: IconStats;
    matchType: 'generated' | 'search';
}

export interface RecipeNode {
  id: string;
  laneId: string;
  text: string; // "Grate 2 carrots"
  visualDescription: string; // "A carrot going into a grater"
  
  // Icon Data
  iconShortlist?: ShortlistEntry[];
  shortlistIndex?: number;  // current position in iconShortlist, 0-based
  iconQuery?: {
    queryUsed: string;
    method: string;
    outcome?: 'accepted' | 'rerolled_past' | 'regenerated';
  };
  hydeQueries?: string[];

  type: 'ingredient' | 'action';
  inputs?: string[]; // IDs of nodes that flow into this one
  
  // Action Metadata
  temperature?: string; // "Medium Heat"
  duration?: string; // "5 min"

  // Quantity Metadata (Parsed or AI)
  quantity?: number;
  unit?: string;
  canonicalName?: string; // "Carrot" vs "2 Carrots"
  
  // Layout Persistence
  x?: number;
  y?: number;
  rotation?: number;
  textPos?: 'bottom' | 'top' | 'left' | 'right';
  iconTheme?: 'classic' | 'modern' | 'modern_clean';
}

export interface NodeLayout {
  id: string;
  x: number;
  y: number;
}

// TODO add last update, created by, currentID.
export interface RecipeGraph {
  title?: string;
  sourceId?: string;
  originalText?: string;
  layoutMode?: string;
  visibility?: 'public' | 'unlisted' | 'private';
  isVetted?: boolean;
  
  // Scaling
  serves?: number; // Current servings setting
  baseServes?: number; // Original recipe servings

  lanes: Lane[];
  nodes: RecipeNode[];
  layouts?: Record<string, NodeLayout[]>;
  
  // Persistent user preferences for this recipe
  rejections?: Record<string, string[]>; // Map<VisualDescription, RejectedIconIDs[]>
}

// --- Output Layout (For Rendering) ---

export interface VisualNode {
  id: string;
  type: 'ingredient' | 'action';
  x: number;
  y: number;
  width: number;
  height: number;
  depth?: number;
  data: RecipeNode;
}

export interface VisualEdge {
  id: string;
  sourceId: string;
  targetId: string;
  path: string; // SVG path d attribute
}

export interface VisualLane {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface LayoutGraph {
  nodes: VisualNode[];
  edges: VisualEdge[];
  lanes: VisualLane[];
  width: number;
  height: number;
}
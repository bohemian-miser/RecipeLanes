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
    /** The canonical ingredient/visual description used to derive the storage path. */
    visualDescription?: string;
    score?: number;
    impressions?: number;
    rejections?: number;
    metadata?: {
        center: { x: number, y: number };
        bbox: { x: number, y: number, w: number, h: number };
    };
    searchTerms?: SearchTerm[];
}

/** Shape of a document in the Firestore `icon_index` collection. Internal to data-service. */
export interface IconIndexEntry {
    icon_id: string;
    ingredient_name: string;
    created_at?: any;
}

/**
 * Shape of a document in the Firestore `ingredients_new` collection.
 * Doc ID = standardized ingredient name (same as visualDescription).
 * `icons` is a slice of IconStats (up to 50 most recent).
 */
// this also has 'embedding' which is a 768 dimensional vector.
export interface IngredientDoc {
    icons: IconStats[];
    created_at: any;
    updated_at: any;
}

export interface ShortlistEntry {
    icon: IconStats;
    matchType: 'generated' | 'search';
    /** Cosine similarity [0, 1] between the search query embedding and this icon's embedding. */
    matchScore?: number;
    /** True once an impression has been recorded for this entry in the backend. */
    hasImpressed?: boolean;
    /** True once a rejection has been recorded for this entry in the backend. */
    hasRejected?: boolean;
}

export interface RecipeNode {
  id: string;
  laneId: string;
  text: string; // "Grate 2 carrots"
  visualDescription: string; // "A carrot going into a grater"
  
  // Icon Data
  iconShortlist?: ShortlistEntry[];
  shortlistIndex?: number;   // current position in iconShortlist, 0-based
  shortlistCycled?: boolean; // true once the user has wrapped all the way around the shortlist
  iconQuery?: {
    queryUsed: string;
    method: string;
    outcome?: 'accepted' | 'rerolled_past' | 'regenerated';
  };
  status?: 'pending' | 'processing' | 'failed';
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
  
  // Persistent user preferences for this recipe (not needed anymore since we moved to shortlist)
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
  lineColor?: string;
}

export interface VisualEdge {
  id: string;
  sourceId: string;
  targetId: string;
  path: string; // SVG path d attribute
  lineColor?: string;
  kind?: 'chain' | 'spur';
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
  /** Present only for 'timeline' mode. */
  timelineData?: {
    pixelsPerMin: number;
    totalMinutes: number;
    actionZoneY: number;
    totalHeight: number;
    rulerHeight: number;
    laneLabelWidth: number;
    gridInterval: number;
  };
}
// --- Input Graph (From AI Parser) ---

export interface Lane {
  id: string;
  label: string; // e.g. "Skillet", "Bowl"
  type: 'prep' | 'cook' | 'serve';
}

export interface RecipeNode {
  id: string;
  laneId: string;
  text: string; // "Grate 2 carrots"
  visualDescription: string; // "A carrot going into a grater"
  iconId?: string | null; // Firestore/Storage ID
  iconUrl?: string; // Generated Icon URL (Computed or Cached)
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

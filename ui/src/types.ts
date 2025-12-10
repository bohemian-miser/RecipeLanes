export type ResourceType = 'prep' | 'cook' | 'cool' | 'passive';

export interface Ingredient {
  id: string;
  name: string;
  quantity?: string;
  icon?: string; // Emoji or SVG path key
}

export interface Step {
  id: string;
  label: string;
  description: string;
  resource: string;
  resourceType: ResourceType;
  dependencies: string[]; // IDs of ingredients or previous steps
  duration?: string; // e.g. "10m", "5m"
  temperature?: string; // e.g. "165°C"
  state: 'active' | 'waiting' | 'done';
  icon?: string;
}

export interface RecipeGraph {
  ingredients: Ingredient[];
  steps: Step[];
  lanes: string[];
}

export interface VisualNode {
  id: string;
  type: 'ingredient' | 'step';
  x: number;
  y: number;
  width: number;
  height: number;
  laneIndex: number;
  data: Step | Ingredient;
}

export interface VisualEdge {
  id: string;
  sourceId: string;
  targetId: string;
  path: string; // SVG path command
}

export interface LayoutGraph {
  nodes: VisualNode[];
  edges: VisualEdge[];
  width: number;
  height: number;
  lanes: { name: string; y: number; height: number; color: string }[];
}
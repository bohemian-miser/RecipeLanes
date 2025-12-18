export function generateRecipePrompt(recipeText: string): string {
  return `
You are an expert recipe parser. Your goal is to convert the following cooking instructions into a structured "Swimlane Graph" JSON.

### Core Concepts
1. **Lanes (Containers):** Represents a physical location where ingredients aggregate (e.g., "Bowl", "Skillet", "Pot").
2. **Nodes (Steps):** Represents an Ingredient addition or an Action.
3. **Edges (Flow):** Ingredients flow into Actions. Actions flow into subsequent Actions in the same lane or merge into new lanes.

### Schema
Return ONLY raw JSON complying with this TypeScript interface:

\
interface RecipeGraph {
  lanes: { 
    id: string;
    label: string; // e.g. "Skillet"
    type: 'prep' | 'cook' | 'serve';
  }[];
  nodes: {
    id: string;
    laneId: string; // Must match a lane.id
    text: string; // Concise instruction e.g. "Add onions" or "2 Onions"
    visualDescription: string; // Detailed prompt for pixel-art icon
    type: 'ingredient' | 'action';
    inputs?: string[]; // IDs of previous nodes flowing into this one
    temperature?: string; // e.g. "Medium Heat" (for actions)
    duration?: string; // e.g. "5 min" (for actions)
  }[];
}
\

### Visual Description Guidelines (CRITICAL)
- **Active & Object-Focused:** Descriptions should focus on the *object* and the *action* without showing human body parts (hands).
- **State Changes:** Capture the transition (e.g., "melting", "falling into", "boiling").
- **Examples:**
    - "Grate Carrot" -> "A carrot going into a box grater"
    - "Add Grated Carrot" -> "Grated orange carrot shreds falling into a skillet"
    - "Whisk Eggs" -> "A wire whisk beating yellow eggs in a glass bowl"
    - "Fry Onions" -> "Onions frying in a pan"

### Input Recipe
("${recipeText}")
`;
}
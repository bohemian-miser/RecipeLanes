import type { RecipeGraph, Ingredient, Step, ResourceType } from '../types';

// Keyword to Icon mapping
const ICON_MAP: { [key: string]: string } = {
  mix: '🥣', whisk: '🌪️', stir: '🥄', beat: '🌪️',
  chop: '🔪', slice: '🔪', cut: '🔪',
  cook: '🍳', fry: '🍳', sauté: '🍳', boil: '🍲', simmer: '🍲',
  bake: '🔥', roast: '🍗', grill: '🔥', preheat: '🌡️',
  cool: '❄️', chill: '❄️', freeze: '🧊', rest: '⏳', wait: '⏳',
  serve: '🍽️', plate: '🍽️', eat: '😋',
  wash: '🚰', clean: '🚰',
  default: '⏺️'
};

const RESOURCE_TYPE_MAP: { [key: string]: ResourceType } = {
  oven: 'cook', stove: 'cook', burner: 'cook', frypan: 'cook', grill: 'cook',
  fridge: 'cool', freezer: 'cool',
  bench: 'prep', board: 'prep', mixer: 'prep', bowl: 'prep',
  sink: 'passive', passive: 'passive', off_heat: 'passive'
};

export const parseRecipe = (text: string): RecipeGraph => {
  const ingredients: Ingredient[] = [];
  const steps: Step[] = [];
  const lanes: string[] = [];
  let ingredientIdCounter = 0;
  let stepIdCounter = 0;

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  // 1. Parse Ingredients (lines starting with '-')
  lines.forEach(line => {
    if (line.startsWith('-')) {
      // Format: - Quantity Unit Ingredient Name (optional icon)
      // Heuristic: - 1 cup Sugar
      const content = line.substring(1).trim();
      // Try to extract icon if present at start or end? For now, just simplistic.
      
      ingredients.push({
        id: `ing-${ingredientIdCounter++}`, 
        name: content,
        quantity: '', // TODO: Smarter parsing
        icon: '📦' 
      });
    }
  });

  // 2. Parse Steps
  // Format: 1. Description {Time} @Temp [Lane] (Deps)
  lines.forEach(line => {
    // Regex breakdown:
    // ^(\d+)\.           -> Starts with "1."
    // \s*                -> whitespace
    // (.*?)              -> Description (capture group 1) - NON-GREEDY
    // (?:\{([^}]+)\})?   -> Optional {Duration} (capture group 2)
    // (?:\s*@(\S+))?     -> Optional @Temperature (capture group 3)
    // \s*\[([^\]]+)\]    -> [Lane] (capture group 4)
    // (?:\s*\(([^)]+)\))?-> Optional (Dependencies) (capture group 5)
    // $                  -> End
    // Note: The non-greedy description is tricky if strictly regexed. 
    // It's often easier to extract tags and then clean the string.

    if (/^\d+\./.test(line)) {
      let remaining = line.replace(/^\d+\.\s*/, '');
      
      // Extract Tags
      let duration = '';
      const durMatch = remaining.match(/\{([^}]+)\}/);
      if (durMatch) {
        duration = durMatch[1];
        remaining = remaining.replace(durMatch[0], '');
      }

      let temperature = '';
      const tempMatch = remaining.match(/@([^\s\[\(]+)/); // match @180C until space or [ or (
      if (tempMatch) {
        temperature = tempMatch[1];
        remaining = remaining.replace(tempMatch[0], '');
      }

      let resource = 'bench'; // default
      const resMatch = remaining.match(/\[([^\]]+)\]/);
      if (resMatch) {
        resource = resMatch[1];
        remaining = remaining.replace(resMatch[0], '');
      }

      let dependencies: string[] = [];
      const depMatch = remaining.match(/\(([^)]+)\)/);
      if (depMatch) {
        // Need to resolve numeric dependencies to actual IDs if possible
        // This is a "second pass" problem, but here we'll just store strings.
        // We need a way to link "1" to the first step's ID.
        // For this simplified parser, let's assume dependencies are raw IDs or we'll map them later.
        // Actually, let's make the IDs predictable: "step-1", "step-2".
        const depString = depMatch[1];
        dependencies = depString.split(',').map(d => d.trim());
        remaining = remaining.replace(depMatch[0], '');
      }

      const description = remaining.trim();
      
      // Infer Metadata
      const lowerDesc = description.toLowerCase();
      const lowerRes = resource.toLowerCase();

      // Icon
      let icon = ICON_MAP['default'];
      for (const key in ICON_MAP) {
        if (lowerDesc.includes(key)) {
          icon = ICON_MAP[key];
          break;
        }
      }

      // Resource Type
      let resourceType: ResourceType = 'passive';
      for (const key in RESOURCE_TYPE_MAP) {
        if (lowerRes.includes(key)) {
          resourceType = RESOURCE_TYPE_MAP[key];
          break;
        }
      }

      // Lane management
      if (!lanes.includes(resource)) {
        lanes.push(resource);
      }

      // Resolve numeric dependencies to actual IDs if possible
      // This is a "second pass" problem, but here we'll just store strings.
      // We need a way to link "1" to the first step's ID.
      // For this simplified parser, let's assume dependencies are raw IDs or we'll map them later.
      // Actually, let's make the IDs predictable: "step-1", "step-2".
      const stepNumMatch = line.match(/^(\d+)\./);
      const stepNum = stepNumMatch ? stepNumMatch[1] : stepIdCounter++;
      const id = `step-${stepNum}`;
      
      // Fix dependencies: if user wrote "1", make it "step-1".
      dependencies = dependencies.map(d => {
        if (/^\d+$/.test(d)) return `step-${d}`;
        // if it matches an ingredient name? Too complex for now.
        return d; 
      });

      steps.push({
        id,
        label: stepNum.toString(),
        description,
        resource,
        resourceType,
        dependencies,
        duration,
        temperature,
        state: 'waiting',
        icon
      });
    }
  });

  return { ingredients, steps, lanes };
};

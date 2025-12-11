// Simple in-memory store for fallback/testing
export interface IconData {
  id: string;
  url: string;
  ingredient: string;
  popularity_score: number;
  created_at: number;
  marked_for_deletion: boolean;
  embedding?: number[];
  ingredientId?: string;
}

export interface IngredientData {
  id: string;
  name: string;
  embedding: number[];
  created_at: number;
}

class MemoryStore {
  private ingredients: IngredientData[] = [];
  private icons: IconData[] = [];

  addIngredient(data: Omit<IngredientData, 'id'>): string {
    const id = `ing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.ingredients.push({ ...data, id });
    return id;
  }

  getIngredients(): IngredientData[] {
    return this.ingredients;
  }

  addIcon(data: Omit<IconData, 'id'>): string {
    const id = `icon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.icons.push({ ...data, id });
    return id;
  }

  getIconsForIngredient(ingredientId: string): IconData[] {
    return this.icons.filter(i => i.ingredientId === ingredientId);
  }
  
  getIconsByName(name: string): IconData[] {
      return this.icons.filter(i => i.ingredient === name);
  }

  updateIconPopularity(iconUrl: string, adjustment: number) {
    const icon = this.icons.find(i => i.url === iconUrl);
    if (icon) {
      icon.popularity_score += adjustment;
      // Simple logic: count siblings
      const siblings = this.icons.filter(i => i.ingredientId === icon.ingredientId);
      if (icon.popularity_score < -Math.max(siblings.length, 100)) {
        icon.marked_for_deletion = true;
      }
    }
  }
}

export const memoryStore = new MemoryStore();

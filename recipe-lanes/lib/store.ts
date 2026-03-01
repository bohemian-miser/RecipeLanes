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

// Simple in-memory store for fallback/testing
export interface IconData {
  id: string;
  url: string;
  ingredient: string;
  popularity_score: number;
  impressions?: number;
  rejections?: number;
  created_at: number;
  marked_for_deletion: boolean;
  embedding?: number[];
  ingredientId?: string;
  visualDescription?: string;
  fullPrompt?: string;
  textModel?: string;
  imageModel?: string;
  metadata?: any;
}

export interface IngredientData {
  id: string;
  name: string;
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

  updateIcon(id: string, updates: Partial<IconData>) {
      const index = this.icons.findIndex(i => i.id === id);
      if (index !== -1) {
          this.icons[index] = { ...this.icons[index], ...updates };
      }
  }

  getIconsForIngredient(ingredientId: string): IconData[] {
    return this.icons.filter(i => i.ingredientId === ingredientId);
  }
  
  getIconsByName(name: string): IconData[] {
      return this.icons.filter(i => i.ingredient === name);
  }

  getAllIcons(): IconData[] {
    return this.icons;
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

  deleteIcon(url: string) {
      this.icons = this.icons.filter(i => i.url !== url);
  }

  deleteIngredient(name: string) {
      const ingredient = this.ingredients.find(i => i.name.toLowerCase() === name.toLowerCase());
      if (ingredient) {
          this.ingredients = this.ingredients.filter(i => i.id !== ingredient.id);
          this.icons = this.icons.filter(i => i.ingredientId !== ingredient.id);
      }
  }
}

export const memoryStore = new MemoryStore();
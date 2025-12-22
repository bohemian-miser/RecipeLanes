import { db, storage } from './firebase-admin';
import { memoryStore, IconData, IngredientData } from './store';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { RecipeGraph } from './recipe-lanes/types';

export interface DataService {
  getIngredientByName(name: string): Promise<{ id: string; data: any } | null>;
  createIngredient(name: string): Promise<string>;
  
  getIconsForIngredient(ingredientId: string): Promise<any[]>;
  getAllIcons(): Promise<any[]>;
  
  saveIcon(
      ingredientId: string, 
      ingredientName: string, 
      visualDescription: string, 
      imagePrompt: string,
      fullImagePrompt: string,
      publicUrl: string, 
      imageBuffer: ArrayBuffer, 
      meta: { lcb: number, impressions: number, rejections: number, textModel: string, imageModel: string }
  ): Promise<string>;
  
  saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility?: 'private' | 'unlisted' | 'public'): Promise<string>;
  getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, visibility?: string, stats?: any } | null>;

  voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none'): Promise<void>;
  toggleStar(recipeId: string, userId: string): Promise<boolean>;
  copyRecipe(recipeId: string, userId: string): Promise<string>;

  searchPublicRecipes(query: string): Promise<any[]>;
  getUserRecipes(userId: string): Promise<any[]>;
  getStarredRecipes(userId: string): Promise<any[]>;
  getPublicRecipes(limit: number): Promise<any[]>;

  recordRejection(iconUrl: string, ingredientName: string, ingredientId: string): Promise<void>;
  deleteIcon(iconUrl: string, ingredientName?: string): Promise<void>;
  deleteIngredientCategory(ingredientName: string): Promise<void>;
  incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number): Promise<void>;
  listDebugFiles(): Promise<any[]>;
}

// --- Firebase Implementation ---
export class FirebaseDataService implements DataService { 
  
  async getPublicRecipes(limit: number = 50): Promise<any[]> {
      try {
          const snapshot = await db.collection('recipes')
              .where('visibility', '==', 'public')
              .orderBy('created_at', 'desc')
              .limit(limit)
              .get();
          return this.mapRecipes(snapshot);
      } catch (e: any) {
          console.warn('getPublicRecipes failed:', e.message);
          return [];
      }
  }

  async searchPublicRecipes(query: string): Promise<any[]> {
      const term = query.toLowerCase();
      const snapshot = await db.collection('recipes')
          .where('visibility', '==', 'public')
          .orderBy('created_at', 'desc')
          .limit(100)
          .get();
      
      const all = this.mapRecipes(snapshot);
      return all.filter(r => r.title.toLowerCase().includes(term));
  }

  async getUserRecipes(userId: string): Promise<any[]> {
      const snapshot = await db.collection('recipes')
          .where('ownerId', '==', userId)
          .orderBy('created_at', 'desc')
          .get();
      return this.mapRecipes(snapshot);
  }

  async getStarredRecipes(userId: string): Promise<any[]> {
      const starSnap = await db.collection('users').doc(userId).collection('stars').get();
      if (starSnap.empty) return [];
      
      const ids = starSnap.docs.map(d => d.id);
      const recipes = [];
      for (const id of ids) {
          const doc = await db.collection('recipes').doc(id).get();
          if (doc.exists) {
              recipes.push(this.mapRecipeDoc(doc));
          }
      }
      return recipes;
  }

  async saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility: 'private' | 'unlisted' | 'public' = 'unlisted'): Promise<string> {
      const data: any = {
          graph,
          updated_at: FieldValue.serverTimestamp()
      };
      
      if (userId) data.ownerId = userId;
      if (visibility) data.visibility = visibility;
      if (graph.title) data.title = graph.title;

      if (existingId) {
          await db.collection('recipes').doc(existingId).set(data, { merge: true });
          return existingId;
      }

      data.created_at = FieldValue.serverTimestamp();
      data.likes = 0;
      data.dislikes = 0;
      
      const doc = await db.collection('recipes').add(data);
      return doc.id;
  }

  async getRecipe(id: string) {
      const doc = await db.collection('recipes').doc(id).get();
      if (!doc.exists) return null;
      const data = doc.data()!;
      return { 
          graph: data.graph as RecipeGraph, 
          ownerId: data.ownerId, 
          visibility: data.visibility,
          stats: { likes: data.likes || 0, dislikes: data.dislikes || 0 }
      };
  }

  async voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none') {
      const userRef = db.collection('users').doc(userId);
      const recipeRef = db.collection('recipes').doc(recipeId);
      
      await db.runTransaction(async (t) => {
          const userDoc = await t.get(userRef);
          const userData = userDoc.data() || {};
          const currentLikes = new Set(userData.likedRecipes || []);
          const currentDislikes = new Set(userData.dislikedRecipes || []);
          
          let likeChange = 0;
          let dislikeChange = 0;
          
          if (currentLikes.has(recipeId)) {
              currentLikes.delete(recipeId);
              likeChange = -1;
          }
          if (currentDislikes.has(recipeId)) {
              currentDislikes.delete(recipeId);
              dislikeChange = -1;
          }
          
          if (vote === 'like') {
              currentLikes.add(recipeId);
              likeChange += 1;
          } else if (vote === 'dislike') {
              currentDislikes.add(recipeId);
              dislikeChange += 1;
          }
          
          t.set(userRef, { 
              likedRecipes: Array.from(currentLikes),
              dislikedRecipes: Array.from(currentDislikes)
          }, { merge: true });
          
          t.update(recipeRef, {
              likes: FieldValue.increment(likeChange),
              dislikes: FieldValue.increment(dislikeChange)
          });
      });
  }

  async toggleStar(recipeId: string, userId: string): Promise<boolean> {
      const starRef = db.collection('users').doc(userId).collection('stars').doc(recipeId);
      const doc = await starRef.get();
      if (doc.exists) {
          await starRef.delete();
          return false;
      } else {
          await starRef.set({ created_at: FieldValue.serverTimestamp() });
          return true;
      }
  }

  async copyRecipe(recipeId: string, userId: string): Promise<string> {
      const source = await this.getRecipe(recipeId);
      if (!source) throw new Error("Recipe not found");
      
      const newGraph = JSON.parse(JSON.stringify(source.graph));
      if (newGraph.title) newGraph.title = `${newGraph.title} (Copy)`;
      
      return this.saveRecipe(newGraph, undefined, userId, 'unlisted');
  }

  private mapRecipes(snapshot: FirebaseFirestore.QuerySnapshot) {
      return snapshot.docs.map(doc => this.mapRecipeDoc(doc));
  }
  
  private mapRecipeDoc(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
      const data = doc.data()!;
      let title = data.title || 'Untitled Recipe';
      
      if (!data.title) {
          if (data.graph?.title) title = data.graph.title;
          else if (data.graph?.originalText) {
              title = data.graph.originalText.split('\n')[0].trim().substring(0, 50);
          } else if (data.graph?.nodes?.length > 0) {
              title = data.graph.nodes[0].text || 'Recipe';
          }
      }

      return {
          id: doc.id,
          title,
          createdAt: data.created_at?.toDate?.()?.toISOString() || null,
          nodeCount: data.graph?.nodes?.length || 0,
          previewIcon: data.graph?.nodes?.find((n: any) => n.iconUrl)?.iconUrl,
          ownerId: data.ownerId,
          visibility: data.visibility || 'unlisted',
          likes: data.likes || 0,
          dislikes: data.dislikes || 0
      };
  }

  async getIngredientByName(name: string) {
    const snapshot = await db.collection('ingredients').get();
    const doc = snapshot.docs.find(d => d.data().name.toLowerCase() === name.toLowerCase());
    return doc ? { id: doc.id, data: doc.data() } : null;
  }
  async createIngredient(name: string) {
    const doc = await db.collection('ingredients').add({ name, embedding: [], created_at: FieldValue.serverTimestamp() });
    return doc.id;
  }
  async incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number) {
      await db.collection('ingredients').doc(ingredientId).collection('icons').doc(iconId).update({
          impressions: FieldValue.increment(1), popularity_score: newScore
      });
      await this.updateStorageMetadata(iconUrl, { impressions: newImpressions, lcb: newScore });
  }
  async getIconsForIngredient(ingredientId: string) {
    const snapshot = await db.collection('ingredients').doc(ingredientId).collection('icons').get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async getAllIcons() {
     try {
         const snapshot = await db.collectionGroup('icons').where('marked_for_deletion', '==', false).limit(1000).get();
         // @ts-ignore
         return snapshot.docs.map(doc => ({ id: doc.id, path: doc.ref.path, ...doc.data() })).sort((a: any, b: any) => (b.popularity_score || 0) - (a.popularity_score || 0));
     } catch (e: any) { return []; }
  }
  async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, imagePrompt: string, fullImagePrompt: string, publicUrl: string, imageBuffer: ArrayBuffer, meta: any) {
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app';
      const bucket = storage.bucket(bucketName);
      const fileName = `icons/${ingredientName.replace(/\s+/g, '-')}-${Date.now()}.png`;
      const file = bucket.file(fileName);
      const token = randomUUID();
      await file.save(Buffer.from(imageBuffer), {
          metadata: { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: token, ...meta } }
      });
      const finalUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
      await db.collection('ingredients').doc(ingredientId).collection('icons').add({
          url: finalUrl, ...meta, ingredient_name: ingredientName, created_at: FieldValue.serverTimestamp(), marked_for_deletion: false, prompt: visualDescription, imagePrompt: imagePrompt, fullImagePrompt: fullImagePrompt
      });
      return finalUrl;
  }
  async recordRejection(iconUrl: string, ingredientName: string, ingredientId: string) {
    const iconsRef = db.collection('ingredients').doc(ingredientId).collection('icons');
    const snapshot = await iconsRef.where('url', '==', iconUrl).get();
    const batch = db.batch();
    for (const doc of snapshot.docs) {
        const data = doc.data();
        const n = (data.impressions || 0);
        const r = (data.rejections || 0) + 1;
        const newLcb = this.calculateWilsonLCB(n, r);
        batch.update(doc.ref, { rejections: FieldValue.increment(1), popularity_score: newLcb });
    }
    await batch.commit();
  }
  async deleteIcon(iconUrl: string, ingredientName?: string) {
    if (ingredientName) {
        const ingSnapshot = await db.collection('ingredients').get();
        const ingDoc = ingSnapshot.docs.find(d => d.data().name.toLowerCase() === ingredientName.toLowerCase());
        
        if (ingDoc) {
            const iconsSnapshot = await ingDoc.ref.collection('icons').get();
            const batch = db.batch();
            iconsSnapshot.docs.forEach(doc => {
                if (this.urlsMatch(doc.data().url, iconUrl)) {
                    batch.delete(doc.ref);
                }
            });
            await batch.commit();
        }
    }
    if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
        const matches = iconUrl.match(new RegExp('/o/([^?]+)'));
        if (matches && matches[1]) {
            const filePath = decodeURIComponent(matches[1]);
            const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
            await bucket.file(filePath).delete().catch(() => {}); 
        }
    }
  }
  async deleteIngredientCategory(ingredientName: string) {
      const ingSnapshot = await db.collection('ingredients').get();
      const ingDoc = ingSnapshot.docs.find(d => d.data().name.toLowerCase() === ingredientName.toLowerCase());

      if (ingDoc) {
          const iconsSnapshot = await ingDoc.ref.collection('icons').get();
          const batch = db.batch();
          const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ? storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) : null;
          const deletes: Promise<any>[] = [];

          for (const iconDoc of iconsSnapshot.docs) {
              const data = iconDoc.data();
              batch.delete(iconDoc.ref);
              if (bucket && data.url) {
                  const matches = data.url.match(new RegExp('/o/([^?]+)'));
                  if (matches && matches[1]) {
                      const filePath = decodeURIComponent(matches[1]);
                      deletes.push(bucket.file(filePath).delete().catch(() => {}));
                  }
              }
          }
          batch.delete(ingDoc.ref);
          await Promise.all(deletes);
          await batch.commit();
      }
  }
  async listDebugFiles() {
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app';
      const bucket = storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix: 'icons/', maxResults: 1000 });
      return files.map(file => ({
          name: file.name,
          updated: file.metadata.updated || null,
          contentType: file.metadata.contentType || null,
          size: file.metadata.size || '0',
          popularityScore: file.metadata.metadata?.lcb || '0',
          impressions: file.metadata.metadata?.impressions || '0',
          rejections: file.metadata.metadata?.rejections || '0',
          mediaLink: file.metadata.mediaLink || null,
          publicUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(file.name)}?alt=media`
      }));
  }

  private calculateWilsonLCB(n: number, r: number): number {
    if (n === 0) return 0;
    const k = n - r; const p = k / n; const z = 1.645;
    const den = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return Math.max(0, (centre - adj) / den);
  }
  private urlsMatch(url1: string, url2: string) {
    if (!url1 || !url2) return false;
    try { return decodeURIComponent(url1.split('?')[0]) === decodeURIComponent(url2.split('?')[0]); } 
    catch { return url1.split('?')[0] === url2.split('?')[0]; }
  }
  private async updateStorageMetadata(iconUrl: string, updates: any) {
      if (!process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) return;
      try {
          const matches = iconUrl.match(new RegExp('/o/([^?]+)'));
          if (matches && matches[1]) {
              const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
              const file = bucket.file(decodeURIComponent(matches[1]));
              const [existing] = await file.getMetadata();
              const metadata = { ...(existing.metadata || {}), ...updates };
              for (const k in metadata) metadata[k] = String(metadata[k]);
              await file.setMetadata({ metadata });
          }
      } catch (e) { console.warn('Meta update failed', e); }
  }
}

export class MemoryDataService implements DataService {
    private recipes = new Map<string, RecipeGraph>();

    async getPublicRecipes(limit: number): Promise<any[]> { return []; }
    async searchPublicRecipes(query: string): Promise<any[]> { return []; }
    async getUserRecipes(userId: string): Promise<any[]> { return []; }
    async getStarredRecipes(userId: string): Promise<any[]> { return []; }
    async voteRecipe(recipeId: string, userId: string, vote: string): Promise<void> {}
    async toggleStar(recipeId: string, userId: string): Promise<boolean> { return false; }
    async copyRecipe(recipeId: string, userId: string): Promise<string> { return 'new-id'; }
    
    async saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility?: string): Promise<string> {
        const id = existingId || randomUUID();
        this.recipes.set(id, graph);
        return id;
    }
    
    async getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, visibility?: string, stats?: any } | null> { 
        const graph = this.recipes.get(id);
        if (!graph) return null;
        return { graph, ownerId: undefined, visibility: 'unlisted', stats: { likes: 0, dislikes: 0 } }; 
    } 

    async getIngredientByName(name: string) {
        const ingredients = memoryStore.getIngredients();
        const match = ingredients.find(i => i.name.toLowerCase() === name.toLowerCase());
        return match ? { id: match.id, data: match } : null;
    }

    async createIngredient(name: string) {
        return memoryStore.addIngredient({ name, embedding: [], created_at: Date.now() });
    }

    async getIconsForIngredient(ingredientId: string) {
        return memoryStore.getIconsForIngredient(ingredientId);
    }

    async getAllIcons() {
        return memoryStore.getAllIcons().sort((a, b) => b.popularity_score - a.popularity_score);
    }

    async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, imagePrompt: string, fullImagePrompt: string, publicUrl: string, imageBuffer: ArrayBuffer, meta: any): Promise<string> {
        memoryStore.addIcon({
            url: publicUrl,
            ingredient: ingredientName,
            ingredientId: ingredientId,
            popularity_score: meta.lcb,
            impressions: meta.impressions,
            rejections: meta.rejections,
            created_at: Date.now(),
            marked_for_deletion: false,
            prompt: visualDescription,
            imagePrompt: imagePrompt,
            fullImagePrompt: fullImagePrompt,
            textModel: meta.textModel,
            imageModel: meta.imageModel
        });
        return publicUrl;
    }

    async recordRejection(iconUrl: string, ingredientName: string, ingredientId: string) {
        const icons = memoryStore.getAllIcons().filter(i => i.url === iconUrl);
        for (const icon of icons) {
            const n = (icon.impressions || 0);
            const r = (icon.rejections || 0) + 1;
            const newLcb = 0; // Simplified
            memoryStore.updateIcon(icon.id, { rejections: r, popularity_score: newLcb });
        }
    }

    async deleteIcon(iconUrl: string, ingredientName?: string) {
        memoryStore.deleteIcon(iconUrl);
    }

    async deleteIngredientCategory(ingredientName: string) {
        memoryStore.deleteIngredient(ingredientName);
    }

    async incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number) {
        memoryStore.updateIcon(iconId, { impressions: newImpressions, popularity_score: newScore });
    }

    async listDebugFiles(): Promise<any[]> {
        const icons = await this.getAllIcons();
        return icons.map((icon: any) => ({
          name: `icons/${icon.ingredient_name || icon.ingredient}-${icon.id}.png`,
          updated: new Date(icon.created_at).toISOString(),
          contentType: 'image/png',
          size: 0,
          popularityScore: String(icon.popularity_score),
          impressions: String(icon.impressions || 0),
          rejections: String(icon.rejections || 0),
          mediaLink: icon.url,
          publicUrl: icon.url
      }));
    }
}

let currentDataService: DataService | null = null;
export function getDataService(): DataService {
  if (currentDataService) return currentDataService;
  currentDataService = new FirebaseDataService();
  return currentDataService;
}
export function setDataService(service: DataService) { currentDataService = service; }
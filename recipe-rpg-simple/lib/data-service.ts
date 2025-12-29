import { db, storage, isFirebaseEnabled } from './firebase-admin';
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
      fullPrompt: string,
      publicUrl: string, 
      imageBuffer: ArrayBuffer | Buffer, 
      meta: { lcb: number, impressions: number, rejections: number, textModel: string, imageModel: string }
  ): Promise<string>;
  
  saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility?: 'private' | 'unlisted' | 'public'): Promise<string>;
  getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, ownerName?: string, visibility?: string, stats?: any } | null>;

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
  checkExistingCopies(originalId: string, userId: string): Promise<any[]>;
  getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }>;
}

// --- Firebase Implementation ---
export class FirebaseDataService implements DataService { 
  
  async getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }> {
      try {
          let q: FirebaseFirestore.Query = db.collectionGroup('icons').where('marked_for_deletion', '==', false);
          
          if (query && query.trim()) {
              // Simple prefix search on ingredient_name. Note: This requires the name to be stored in Title Case if we search that way.
              // We'll try to match case-insensitive by storing/searching a normalized field, but for now assuming strict prefix.
              // To make it robust, let's assume the user types matching case or we capitalize it.
              const term = query.trim();
               // Search by ingredient name prefix
              q = q.where('ingredient_name', '>=', term).where('ingredient_name', '<=', term + '\uf8ff').orderBy('ingredient_name');
          } else {
              q = q.orderBy('created_at', 'desc');
          }

          // Aggregation for total count
          const countSnapshot = await q.count().get();
          const total = countSnapshot.data().count;

          const snapshot = await q.offset((page - 1) * limit).limit(limit).get();
          const icons = snapshot.docs.map(doc => this.mapIconDoc(doc));

          return { icons, total };
      } catch (e: any) {
          console.warn('getPagedIcons failed:', e.message);
          return { icons: [], total: 0 };
      }
  }

  private mapIconDoc(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
      const data = doc.data()!;
      return {
          id: doc.id,
          path: doc.ref.path,
          ...data,
          created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at || null,
      };
  }

  async checkExistingCopies(originalId: string, userId: string): Promise<any[]> {
      try {
          const snapshot = await db.collection('recipes')
              .where('ownerId', '==', userId)
              .where('sourceId', '==', originalId)
              .orderBy('created_at', 'desc')
              .get();
          return this.mapRecipes(snapshot);
      } catch (e: any) {
          console.warn('checkExistingCopies failed:', e.message);
          return [];
      }
  }

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
      
      return snapshot.docs
        .filter(doc => {
            const data = doc.data();
            const title = (data.title || data.graph?.title || '').toLowerCase();
            const content = (data.graph?.originalText || '').toLowerCase();
            const nodes = data.graph?.nodes || [];
            const nodeText = nodes.some((n: any) => n.text?.toLowerCase().includes(term) || n.visualDescription?.toLowerCase().includes(term));
            
            return title.includes(term) || content.includes(term) || nodeText;
        })
        .map(doc => this.mapRecipeDoc(doc));
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
      if (graph.sourceId) data.sourceId = graph.sourceId;

      if (existingId) {
          // Enforce ownership check
          const existingDoc = await db.collection('recipes').doc(existingId).get();
          if (existingDoc.exists) {
              const existingData = existingDoc.data();
              if (existingData?.ownerId && existingData.ownerId !== userId) {
                  throw new Error("You are not the owner of this recipe.");
              }
          }
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
        const graph = data.graph as RecipeGraph;
        if (data.visibility) graph.visibility = data.visibility as any; 
  
        let ownerName = undefined;
        if (data.ownerId) {
            try {
                const userSnap = await db.collection('users').doc(data.ownerId).get();
                if (userSnap.exists) {
                    const userData = userSnap.data();
                    ownerName = userData?.name || userData?.displayName;
                }
            } catch (e) { /* Ignore fetch error */ }
        }

        return { 
            graph, 
            ownerId: data.ownerId, 
            ownerName,
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
    const doc = await db.collection('ingredients').add({ name, created_at: FieldValue.serverTimestamp() });
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
  async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, fullPrompt: string, publicUrl: string, imageBuffer: ArrayBuffer | Buffer, meta: any) {
      // Optimisation: In Mock AI mode (e.g. tests), skip Storage upload to avoid emulator issues.
      // The publicUrl is likely a Data URI or placeholder which fits in Firestore.
      if (process.env.MOCK_AI === 'true') {
          console.log('[saveIcon] Mock AI detected, skipping Storage upload.');
          const finalUrl = publicUrl;
          await db.collection('ingredients').doc(ingredientId).collection('icons').add({
              url: finalUrl, ...meta, ingredient_name: ingredientName, created_at: FieldValue.serverTimestamp(), marked_for_deletion: false, visualDescription: visualDescription, fullPrompt: fullPrompt
          });
          return finalUrl;
      }

      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
      const bucket = storage.bucket(bucketName);
      const fileName = `icons/${ingredientName.replace(/\s+/g, '-')}-${Date.now()}.png`;
      const file = bucket.file(fileName);
      const token = randomUUID();
      const bufferToSave = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer as ArrayBuffer);
      await file.save(bufferToSave, {
          metadata: { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: token, ...meta } }
      });
      const finalUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;
      await db.collection('ingredients').doc(ingredientId).collection('icons').add({
          url: finalUrl, ...meta, ingredient_name: ingredientName, created_at: FieldValue.serverTimestamp(), marked_for_deletion: false, visualDescription: visualDescription, fullPrompt: fullPrompt
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
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
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
    private recipes = new Map<string, {
        graph: RecipeGraph;
        ownerId?: string;
        sourceId?: string;
        visibility: string;
        stats: { likes: number; dislikes: number };
        created_at: number;
    }>();
    
    private userVotes = new Map<string, { liked: Set<string>; disliked: Set<string> }>();
    private userStars = new Map<string, Set<string>>();

    async getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }> {
        let icons = memoryStore.getAllIcons().filter(i => !i.marked_for_deletion);
        
        if (query) {
            const term = query.toLowerCase();
            icons = icons.filter(i => i.ingredient.toLowerCase().includes(term));
        } else {
             // Sort by date desc by default
             icons.sort((a, b) => b.created_at - a.created_at);
        }

        const total = icons.length;
        const paginated = icons.slice((page - 1) * limit, page * limit);
        return { icons: paginated, total };
    }

    async checkExistingCopies(originalId: string, userId: string): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.ownerId === userId && r.sourceId === originalId)
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r));
    }

    async getPublicRecipes(limit: number): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.visibility === 'public')
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r))
            .slice(0, limit);
    }

    async searchPublicRecipes(query: string): Promise<any[]> {
        const term = query.toLowerCase();
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => {
                if (r.visibility !== 'public') return false;
                const title = (r.graph.title || '').toLowerCase();
                const content = (r.graph.originalText || '').toLowerCase();
                const nodes = r.graph.nodes || [];
                const nodeText = nodes.some(n => n.text?.toLowerCase().includes(term) || n.visualDescription?.toLowerCase().includes(term));
                return title.includes(term) || content.includes(term) || nodeText;
            })
            .map(([id, r]) => this.mapMemoryRecipe(id, r));
    }

    async getUserRecipes(userId: string): Promise<any[]> {
        return Array.from(this.recipes.entries())
            .filter(([_, r]) => r.ownerId === userId)
            .sort((a, b) => b[1].created_at - a[1].created_at)
            .map(([id, r]) => this.mapMemoryRecipe(id, r));
    }

    async getStarredRecipes(userId: string): Promise<any[]> {
        const starredIds = this.userStars.get(userId) || new Set();
        return Array.from(starredIds)
            .map(id => {
                const r = this.recipes.get(id);
                return r ? this.mapMemoryRecipe(id, r) : null;
            })
            .filter(Boolean);
    }

    async voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none'): Promise<void> {
        if (!this.recipes.has(recipeId)) return;
        
        let userVote = this.userVotes.get(userId);
        if (!userVote) {
            userVote = { liked: new Set(), disliked: new Set() };
            this.userVotes.set(userId, userVote);
        }

        const recipe = this.recipes.get(recipeId)!;
        
        // Remove existing vote
        if (userVote.liked.has(recipeId)) {
            userVote.liked.delete(recipeId);
            recipe.stats.likes--;
        }
        if (userVote.disliked.has(recipeId)) {
            userVote.disliked.delete(recipeId);
            recipe.stats.dislikes--;
        }

        // Add new vote
        if (vote === 'like') {
            userVote.liked.add(recipeId);
            recipe.stats.likes++;
        } else if (vote === 'dislike') {
            userVote.disliked.add(recipeId);
            recipe.stats.dislikes++;
        }
    }

    async toggleStar(recipeId: string, userId: string): Promise<boolean> {
        if (!this.recipes.has(recipeId)) return false;
        
        let stars = this.userStars.get(userId);
        if (!stars) {
            stars = new Set();
            this.userStars.set(userId, stars);
        }

        if (stars.has(recipeId)) {
            stars.delete(recipeId);
            return false;
        } else {
            stars.add(recipeId);
            return true;
        }
    }

    async copyRecipe(recipeId: string, userId: string): Promise<string> {
        const original = this.recipes.get(recipeId);
        if (!original) throw new Error("Recipe not found");
        
        const newGraph = JSON.parse(JSON.stringify(original.graph));
        if (newGraph.title) newGraph.title = `${newGraph.title} (Copy)`;
        
        return this.saveRecipe(newGraph, undefined, userId, 'unlisted');
    }
    
    async saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility: 'private' | 'unlisted' | 'public' = 'unlisted'): Promise<string> {
        const id = existingId || randomUUID();
        const existing = this.recipes.get(id);
        
        if (existing && existing.ownerId && existing.ownerId !== userId) {
            throw new Error("You are not the owner of this recipe.");
        }

        const stats = existing?.stats || { likes: 0, dislikes: 0 };
        const created_at = existing?.created_at || Date.now();
        const ownerId = existing?.ownerId || userId; // Keep original owner if update
        
        this.recipes.set(id, {
            graph,
            ownerId,
            sourceId: graph.sourceId,
            visibility,
            stats,
            created_at
        });
        return id;
    }
    
    async getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, ownerName?: string, visibility?: string, stats?: any } | null> { 
        const r = this.recipes.get(id);
        if (!r) return null;
        const graph = r.graph;
        if (r.visibility) graph.visibility = r.visibility as any;

        // Mock lookup if needed, but for now just use ownerId as fallback or assume name is not stored in memory recipes unless we expand schema
        const ownerName = r.ownerId ? `User ${r.ownerId}` : undefined;

        return { 
            graph, 
            ownerId: r.ownerId, 
            ownerName,
            visibility: r.visibility, 
            stats: r.stats 
        }; 
    } 

    private mapMemoryRecipe(id: string, r: any) {
        let title = r.graph.title || 'Untitled Recipe';
        if (!title && r.graph.nodes.length > 0) title = r.graph.nodes[0].text;

        return {
            id,
            title,
            createdAt: new Date(r.created_at).toISOString(),
            nodeCount: r.graph.nodes.length,
            previewIcon: r.graph.nodes.find((n: any) => n.iconUrl)?.iconUrl,
            ownerId: r.ownerId,
            visibility: r.visibility,
            likes: r.stats.likes,
            dislikes: r.stats.dislikes
        };
    }

    async getIngredientByName(name: string) {
        const ingredients = memoryStore.getIngredients();
        const match = ingredients.find(i => i.name.toLowerCase() === name.toLowerCase());
        return match ? { id: match.id, data: match } : null;
    }

    async createIngredient(name: string) {
        return memoryStore.addIngredient({ name, created_at: Date.now() });
    }

    async getIconsForIngredient(ingredientId: string) {
        return memoryStore.getIconsForIngredient(ingredientId);
    }

    async getAllIcons() {
        return memoryStore.getAllIcons().sort((a, b) => b.popularity_score - a.popularity_score);
    }

    async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, fullPrompt: string, publicUrl: string, imageBuffer: ArrayBuffer | Buffer, meta: any): Promise<string> {
        memoryStore.addIcon({
            url: publicUrl,
            ingredient: ingredientName,
            ingredientId: ingredientId,
            popularity_score: meta.lcb,
            impressions: meta.impressions,
            rejections: meta.rejections,
            created_at: Date.now(),
            marked_for_deletion: false,
            visualDescription: visualDescription,
            fullPrompt: fullPrompt,
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
  
  // if (process.env.FORCE_MEMORY_DB === 'true' || !isFirebaseEnabled) {
  //     if (process.env.FORCE_MEMORY_DB === 'true') console.warn("Forcing MemoryDataService");
  //     else console.warn("Firebase not enabled, using MemoryDataService");
  //     currentDataService = new MemoryDataService();
  // } else {
      currentDataService = new FirebaseDataService();
  // }
  return currentDataService;
}
export function setDataService(service: DataService) { currentDataService = service; }

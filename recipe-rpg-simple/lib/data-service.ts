import { db, storage, isFirebaseEnabled } from './firebase-admin';
import { memoryStore, IconData, IngredientData } from './store';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { RecipeGraph } from './recipe-lanes/types';
import { DB_COLLECTION_INGREDIENTS, DB_COLLECTION_QUEUE, DB_COLLECTION_RECIPES } from './config';
import { standardizeIngredientName } from './utils';

export interface IconStats {
    iconId: string;
    iconUrl: string;
    score?: number;
    impressions?: number;
    rejections?: number;
}

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
  ): Promise<{ id: string, url: string, path?: string }>;
  
  saveRecipe(graph: RecipeGraph, existingId?: string, userId?: string, visibility?: 'private' | 'unlisted' | 'public'): Promise<string>;
  getRecipe(id: string): Promise<{ graph: RecipeGraph, ownerId?: string, ownerName?: string, visibility?: string, stats?: any } | null>;

  voteRecipe(recipeId: string, userId: string, vote: 'like' | 'dislike' | 'none'): Promise<void>;
  toggleStar(recipeId: string, userId: string): Promise<boolean>;
  copyRecipe(recipeId: string, userId: string): Promise<string>;
  deleteRecipe(recipeId: string, userId: string): Promise<void>;

  searchPublicRecipes(query: string): Promise<any[]>;
  getUserRecipes(userId: string): Promise<any[]>;
  getStarredRecipes(userId: string): Promise<any[]>;
  getPublicRecipes(limit: number): Promise<any[]>;

  recordRejection(iconUrl: string, ingredientName: string, ingredientId: string): Promise<void>;
  recordImpression(ingredientId: string, iconId: string): Promise<void>;

  deleteIcon(iconUrl: string, ingredientName?: string): Promise<void>;
  deleteIngredientCategory(ingredientName: string): Promise<void>;
  
  listDebugFiles(): Promise<any[]>;
  checkExistingCopies(originalId: string, userId: string): Promise<any[]>;
  getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }>;
  retryIconGeneration(ingredientName: string): Promise<void>;
  queueIcons(items: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[]): Promise<Map<string, IconStats>>;
  waitForQueue(ingredientName: string, timeoutMs?: number): Promise<IconStats | null>;
}

// --- Firebase Implementation ---
export class FirebaseDataService implements DataService { 
  
  private calculateWilsonLCB(n: number, r: number): number {
    if (n === 0) return 0;
    const k = n - r; const p = k / n; const z = 1.645;
    const den = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return Math.max(0, (centre - adj) / den);
  }

  async waitForQueue(ingredientName: string, timeoutMs: number = 15000): Promise<IconStats | null> {
      const stdName = standardizeIngredientName(ingredientName);
      const docRef = db.collection(DB_COLLECTION_QUEUE).doc(stdName);
      
      const start = Date.now();
      
      while (Date.now() - start < timeoutMs) {
          const snap = await docRef.get();
          if (snap.exists) {
              const data = snap.data();
              if (data?.status === 'completed' && data.iconId && data.iconUrl) {
                  return { iconId: data.iconId, iconUrl: data.iconUrl };
              }
              if (data?.status === 'failed') {
                  throw new Error(data.error || 'Generation failed');
              }
          }
          await new Promise(r => setTimeout(r, 1000));
      }
      return null;
  }

  async retryIconGeneration(ingredientName: string): Promise<void> {
      try {
          const stdName = standardizeIngredientName(ingredientName);
          await db.collection(DB_COLLECTION_QUEUE).doc(stdName).update({
              status: 'pending',
              error: FieldValue.delete(),
              created_at: FieldValue.serverTimestamp()
          });
      } catch (e: any) {
          console.warn('retryIconGeneration failed:', e.message);
          throw e;
      }
  }

  async getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }> {
      try {
          // Query ingredients_new instead of feed_icons
          // Note: This is an approximation for the "Gallery" debug view.
          // We fetch recently updated ingredients and aggregate their icons.
          
          let q: FirebaseFirestore.Query = db.collection(DB_COLLECTION_INGREDIENTS)
              .orderBy('updated_at', 'desc');
          
          if (!query) {
              q = q.limit(50); // Fetch top 50 active ingredients
          } else {
              // Note: filtering by name requires an index on name, or client-side filter
              // Firestore doesn't support 'contains'. We can use >= prefix if needed.
              // For debug, we'll fetch more and filter in memory if name index missing.
              q = q.limit(100); 
          }

          const snapshot = await q.get();
          let allIcons: any[] = [];
          
          snapshot.forEach(doc => {
              const data = doc.data();
              if (data.icons && Array.isArray(data.icons)) {
                  allIcons.push(...data.icons);
              }
          });

          // Sort all gathered icons by created_at desc
          allIcons.sort((a, b) => {
              const tA = new Date(a.created_at).getTime();
              const tB = new Date(b.created_at).getTime();
              return tB - tA;
          });

          if (query && query.trim()) {
              const term = query.toLowerCase().trim();
              allIcons = allIcons.filter((i: any) => 
                  i.visualDescription?.toLowerCase().includes(term) || 
                  i.ingredient?.toLowerCase().includes(term)
              );
          }

          const total = allIcons.length;
          const paginated = allIcons.slice((page - 1) * limit, page * limit);

          return { icons: paginated, total };
      } catch (e: any) {
          console.warn('getPagedIcons failed:', e.message);
          return { icons: [], total: 0 };
      }
  }

  async checkExistingCopies(originalId: string, userId: string): Promise<any[]> {
      try {
          const snapshot = await db.collection(DB_COLLECTION_RECIPES)
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
          const snapshot = await db.collection(DB_COLLECTION_RECIPES)
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
      const snapshot = await db.collection(DB_COLLECTION_RECIPES)
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
      const snapshot = await db.collection(DB_COLLECTION_RECIPES)
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
          const doc = await db.collection(DB_COLLECTION_RECIPES).doc(id).get();
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
          const existingDoc = await db.collection(DB_COLLECTION_RECIPES).doc(existingId).get();
          if (existingDoc.exists) {
              const existingData = existingDoc.data();
              if (existingData?.ownerId && existingData.ownerId !== userId) {
                  throw new Error("You are not the owner of this recipe.");
              }
          }
          await db.collection(DB_COLLECTION_RECIPES).doc(existingId).set(data, { merge: true });
          return existingId;
      }

      data.created_at = FieldValue.serverTimestamp();
      data.likes = 0;
      data.dislikes = 0;
      
      const doc = await db.collection(DB_COLLECTION_RECIPES).add(data);
      return doc.id;
  }

    async getRecipe(id: string) {
        const doc = await db.collection(DB_COLLECTION_RECIPES).doc(id).get();
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
      const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
      
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

  async deleteRecipe(recipeId: string, userId: string): Promise<void> {
      const docRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
      const doc = await docRef.get();
      if (!doc.exists) throw new Error("Recipe not found");
      const data = doc.data();
      if (data?.ownerId !== userId) throw new Error("Unauthorized");
      await docRef.delete();
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
    const stdName = standardizeIngredientName(name);
    console.log(`[FirebaseDataService] getIngredientByName: ${stdName}`);
    
    const doc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName).get();
    
    if (doc.exists) {
        return { id: doc.id, data: doc.data() };
    }
    return null;
  }

  async createIngredient(name: string) {
    const stdName = standardizeIngredientName(name);
    const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);
    // Initialize if needed
    await docRef.set({ name: stdName, created_at: FieldValue.serverTimestamp(), icons: [] }, { merge: true });
    return stdName;
  }

  async recordImpression(ingredientId: string, iconId: string) {
      // ingredientId is StdName
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
      
      await db.runTransaction(async (t) => {
          const doc = await t.get(docRef);
          if (!doc.exists) return;
          const data = doc.data() || {};
          const icons = data.icons || [];
          
          const index = icons.findIndex((i: any) => i.id === iconId);
          if (index !== -1) {
              const currentImpressions = icons[index].impressions || 0;
              const currentRejections = icons[index].rejections || 0;
              
              icons[index].impressions = currentImpressions + 1;
              icons[index].score = this.calculateWilsonLCB(icons[index].impressions, currentRejections);
              
              // Keep sorted
              icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
              t.update(docRef, { icons });
          }
      });
  }

  async getIconsForIngredient(ingredientId: string) {
    // ingredientId is StdName
    const doc = await db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId).get();
    if (!doc.exists) return [];
    return doc.data()?.icons || [];
  }

  async getAllIcons() {
     try {
         const snapshot = await db.collection(DB_COLLECTION_INGREDIENTS).limit(100).get();
         let all: any[] = [];
         snapshot.forEach(doc => {
             const data = doc.data();
             if (data.icons) all.push(...data.icons);
         });
         return all;
     } catch (e: any) { return []; }
  }

  async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, fullPrompt: string, publicUrl: string, imageBuffer: ArrayBuffer | Buffer, meta: any) {
      // ingredientId is StdName
      const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true' || process.env.FUNCTIONS_EMULATOR === 'true';
      
      // Filename: icons/Kebab-ShortID.png
      const iconId = randomUUID();
      const shortId = iconId.substring(0, 8);
      const kebabName = ingredientName.trim().replace(/\s+/g, '-');
      const fileName = `icons/${kebabName}-${shortId}.png`;
      
      let finalUrl = publicUrl;

      if (!(process.env.MOCK_AI === 'true' && !isEmulator)) {
          const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'recipe-lanes.firebasestorage.app';
          const bucket = storage.bucket(bucketName);
          const file = bucket.file(fileName);
          const bufferToSave = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer as ArrayBuffer);
          
          await file.save(bufferToSave, {
              metadata: { contentType: 'image/png', metadata: { ...meta, iconId } }
          });
          
          await file.makePublic();
          finalUrl = file.publicUrl();
      }

      // Transactional Update
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
      await db.runTransaction(async (t) => {
          const doc = await t.get(docRef);
          let icons = [];
          if (doc.exists) {
              icons = doc.data()?.icons || [];
          } else {
              t.set(docRef, { name: ingredientName, created_at: FieldValue.serverTimestamp() });
          }
          
          const newIcon = {
              id: iconId,
              path: fileName,
              url: finalUrl,
              score: meta.lcb || 0,
              impressions: meta.impressions || 0,
              rejections: meta.rejections || 0,
              visualDescription,
              fullPrompt,
              created_at: new Date().toISOString()
          };
          
          icons.push(newIcon);
          icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
          if (icons.length > 50) icons = icons.slice(0, 50);
          
          t.update(docRef, { icons, updated_at: FieldValue.serverTimestamp() });
      });

      return { id: iconId, url: finalUrl, path: fileName };
  }

  async recordRejection(iconUrl: string, ingredientName: string, ingredientId: string) {
    const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(ingredientId);
    
    await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists) return;
        const icons = doc.data()?.icons || [];
        
        // Find by URL or Path. 
        const index = icons.findIndex((i: any) => i.url === iconUrl || i.path === iconUrl);
        if (index !== -1) {
            const icon = icons[index];
            icon.rejections = (icon.rejections || 0) + 1;
            // Recalculate Score using Wilson LCB
            icon.score = this.calculateWilsonLCB(icon.impressions || 0, icon.rejections);
            
            icons.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
            t.update(docRef, { icons });
        }
    });
  }

  async deleteIcon(iconUrl: string, ingredientName?: string) {
      if (!ingredientName) return; 
      const stdName = standardizeIngredientName(ingredientName);
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);
      
      let deletedId: string | null = null;

      await db.runTransaction(async (t) => {
          const doc = await t.get(docRef);
          if (!doc.exists) return;
          const icons = doc.data()?.icons || [];
          const iconToDelete = icons.find((i: any) => i.url === iconUrl || i.path === iconUrl);
          
          if (iconToDelete) {
              deletedId = iconToDelete.id;
              const newIcons = icons.filter((i: any) => i.id !== deletedId);
              t.update(docRef, { icons: newIcons });
          }
      });
      
      if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
          let path = iconUrl;
          if (iconUrl.includes('/o/')) {
              const match = iconUrl.match(new RegExp('/o/([^?]+)'));
              if (match) path = decodeURIComponent(match[1]);
          }
          if (path) {
              const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
              await bucket.file(path).delete().catch(() => {});
          }
      }
  }

  async deleteIngredientCategory(ingredientName: string) {
      const stdName = standardizeIngredientName(ingredientName);
      const docRef = db.collection(DB_COLLECTION_INGREDIENTS).doc(stdName);
      
      const doc = await docRef.get();
      if (doc.exists) {
          const icons = doc.data()?.icons || [];
          const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!);
          
          icons.forEach((i: any) => {
              const path = i.path || (i.url && i.url.match(new RegExp('/o/([^?]+)'))?.[1] ? decodeURIComponent(i.url.match(new RegExp('/o/([^?]+)'))![1]) : null);
              if (path) bucket.file(path).delete().catch(() => {});
          });
          
          await docRef.delete();
      }
  }

  async listDebugFiles(): Promise<any[]> {
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

  async queueIcons(items: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[]): Promise<Map<string, IconStats>> {
      const immediateHits = new Map<string, IconStats>();
      if (items.length === 0) return immediateHits;
      
      const batch = db.batch();
      let queuedCount = 0;
      
      const uniqueNames = Array.from(new Set(items.map(i => standardizeIngredientName(i.ingredientName))));
      const refs = uniqueNames.map(name => db.collection(DB_COLLECTION_INGREDIENTS).doc(name));
      const snapshots = await db.getAll(...refs);
      
      const cacheMap = new Map<string, any>();
      snapshots.forEach(snap => {
          if (snap.exists) cacheMap.set(snap.id, snap.data());
      });

      const updatesByRecipe = new Map<string, Map<string, { iconId: string, iconUrl: string }>>();

      for (const item of items) {
          const name = standardizeIngredientName(item.ingredientName);
          const rejected = new Set(item.rejectedIds || []);
          
          let foundIcon: IconStats | null = null;

          const ingData = cacheMap.get(name);
          if (ingData && ingData.icons && Array.isArray(ingData.icons)) {
              for (const icon of ingData.icons) {
                  if (!rejected.has(icon.id) && !rejected.has('url:' + icon.url)) {
                      foundIcon = { 
                          iconId: icon.id, 
                          iconUrl: icon.url,
                          score: icon.score,
                          impressions: icon.impressions,
                          rejections: icon.rejections 
                      };
                      break;
                  }
              }
          }

          if (!foundIcon) {
              const docRef = db.collection(DB_COLLECTION_QUEUE).doc(name);
              const docSnap = await docRef.get();
              const existingData = docSnap.data();

              if (existingData?.status === 'completed' && existingData.iconId) {
                  if (!rejected.has(existingData.iconId)) {
                      foundIcon = { iconId: existingData.iconId, iconUrl: existingData.iconUrl };
                  }
              }
              
              if (!foundIcon) {
                  const update: any = {
                      created_at: existingData?.created_at || FieldValue.serverTimestamp()
                  };
                  
                  if (item.recipeId) {
                      update.recipes = FieldValue.arrayUnion(item.recipeId);
                  }
                  
                  if (!existingData || existingData.status === 'completed' || existingData.status === 'failed') {
                       update.status = 'pending';
                       update.error = FieldValue.delete();
                  }
                  
                  batch.set(docRef, update, { merge: true });
                  queuedCount++;
              }
          }

          if (foundIcon) {
              immediateHits.set(name, foundIcon);
              if (item.recipeId) {
                  if (!updatesByRecipe.has(item.recipeId)) {
                      updatesByRecipe.set(item.recipeId, new Map());
                  }
                  updatesByRecipe.get(item.recipeId)!.set(name, { iconId: foundIcon.iconId, iconUrl: foundIcon.iconUrl });
              }
          }
      }

      for (const [recipeId, updates] of updatesByRecipe.entries()) {
          await db.runTransaction(async (t) => {
              const recipeRef = db.collection(DB_COLLECTION_RECIPES).doc(recipeId);
              const doc = await t.get(recipeRef);
              if (!doc.exists) return;
              const data = doc.data();
              if (!data?.graph?.nodes) return;
              
              const nodes = data.graph.nodes;
              let changed = false;
              
              nodes.forEach((n: any) => {
                  if (n.visualDescription) {
                      const nName = standardizeIngredientName(n.visualDescription);
                      if (updates.has(nName)) {
                          const update = updates.get(nName)!;
                          if (n.iconId !== update.iconId) {
                              n.iconId = update.iconId;
                              n.iconUrl = update.iconUrl;
                              changed = true;
                          }
                      }
                  }
              });
              
              if (changed) {
                  t.update(recipeRef, { "graph.nodes": nodes });
              }
          });
      }

      if (queuedCount > 0) {
          await batch.commit();
          console.log(`[DataService] Enqueued ${queuedCount} icons.`);
      }
      
      return immediateHits;
  }
  
  // ... (private helpers)
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

    async queueIcons(items: { ingredientName: string, recipeId?: string, rejectedIds?: string[] }[]): Promise<Map<string, IconStats>> {
        console.log(`[MemoryDataService] Queuing icons (Synchronous Mock)`);
        const hits = new Map<string, IconStats>();
        
        for (const item of items) {
            const stdName = standardizeIngredientName(item.ingredientName);
            const mockUrl = `https://placehold.co/64x64/png?text=${encodeURIComponent(stdName)}&uuid=${randomUUID().substring(0, 6)}`;
            const iconId = memoryStore.addIcon({
                url: mockUrl,
                ingredient: stdName,
                ingredientId: stdName,
                created_at: Date.now(),
                marked_for_deletion: false,
                popularity_score: 0
            });
            
            hits.set(stdName, { iconId, iconUrl: mockUrl, score: 0, impressions: 0, rejections: 0 });
        }
        return hits;
    }
    
    async recordImpression(ingredientId: string, iconId: string): Promise<void> {
        // Simple increment for memory store
        const icons = memoryStore.getIconsForIngredient(ingredientId);
        const icon = icons.find(i => i.id === iconId);
        if (icon) {
            const n = (icon.impressions || 0) + 1;
            const r = (icon.rejections || 0);
            const score = 1.0; // Mock score
            memoryStore.updateIcon(iconId, { impressions: n, popularity_score: score });
        }
    }

    async incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number) {
        // Legacy support - can be removed or alias to recordImpression if needed
        await this.recordImpression(ingredientId, iconId);
    }

    async waitForQueue(ingredientName: string, timeoutMs?: number): Promise<IconStats | null> {
        return null;
    }
    
    // ... (rest of methods)
    async getPagedIcons(page: number, limit: number, query?: string): Promise<{ icons: any[], total: number }> {
        let icons = memoryStore.getAllIcons().filter(i => !i.marked_for_deletion);
        
        if (query) {
            const term = query.toLowerCase();
            icons = icons.filter(i => i.ingredient.toLowerCase().includes(term));
        } else {
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

    async deleteRecipe(recipeId: string, userId: string): Promise<void> {
        const r = this.recipes.get(recipeId);
        if (!r) throw new Error("Recipe not found");
        if (r.ownerId !== userId) throw new Error("Unauthorized");
        this.recipes.delete(recipeId);
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

    async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, fullPrompt: string, publicUrl: string, imageBuffer: ArrayBuffer | Buffer, meta: any): Promise<{ id: string, url: string, path?: string }> {
        const id = memoryStore.addIcon({
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
        return { id, url: publicUrl, path: `icons/${id}.png` };
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

    async retryIconGeneration(ingredientName: string) {
        console.log(`[MemoryDataService] Retry requested for ${ingredientName} (No-op in memory mode)`);
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
import { db, storage } from './firebase-admin';
import { memoryStore, IconData, IngredientData } from './store';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

export interface DataService {
  getIngredientByName(name: string): Promise<{ id: string; data: any } | null>;
  createIngredient(name: string): Promise<string>;
  
  getIconsForIngredient(ingredientId: string): Promise<any[]>;
  getAllIcons(): Promise<any[]>;
  
  saveIcon(
      ingredientId: string, 
      ingredientName: string, 
      visualDescription: string, 
      publicUrl: string, 
      imageBuffer: ArrayBuffer, 
      meta: { lcb: number, impressions: number, rejections: number, textModel: string, imageModel: string }
  ): Promise<string>;

  recordRejection(iconUrl: string, ingredientName: string, ingredientId: string): Promise<void>;
  
  deleteIcon(iconUrl: string, ingredientName?: string): Promise<void>;
  deleteIngredientCategory(ingredientName: string): Promise<void>;
  
  incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number): Promise<void>;

  listDebugFiles(): Promise<any[]>;
}

// --- Firebase Implementation ---
export class FirebaseDataService implements DataService {
  
  async getIngredientByName(name: string) {
    const snapshot = await db.collection('ingredients').get();
    const doc = snapshot.docs.find(d => d.data().name.toLowerCase() === name.toLowerCase());
    return doc ? { id: doc.id, data: doc.data() } : null;
  }

  async createIngredient(name: string) {
    const doc = await db.collection('ingredients').add({
      name,
      embedding: [],
      created_at: FieldValue.serverTimestamp()
    });
    return doc.id;
  }

  async incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number) {
      await db.collection('ingredients').doc(ingredientId).collection('icons').doc(iconId).update({
          impressions: FieldValue.increment(1),
          popularity_score: newScore
      });
      await this.updateStorageMetadata(iconUrl, { impressions: newImpressions, lcb: newScore });
  }

  async getIconsForIngredient(ingredientId: string) {
    const snapshot = await db.collection('ingredients').doc(ingredientId).collection('icons').get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async getAllIcons() {
     // Fetch active icons (up to 1000) for the shared gallery
     const snapshot = await db.collectionGroup('icons')
        .where('marked_for_deletion', '==', false)
        .limit(1000)
        .get();

     const items = snapshot.docs.map(doc => {
         const data = doc.data();
         return {
             id: doc.id,
             path: doc.ref.path,
             ...data,
             created_at: data.created_at?.toDate?.()?.toISOString() || data.created_at
         };
     });
     // @ts-ignore
     return items.sort((a, b) => (b.popularity_score || 0) - (a.popularity_score || 0));
  }

  async saveIcon(
    ingredientId: string, 
    ingredientName: string, 
    visualDescription: string, 
    publicUrl: string, 
    imageBuffer: ArrayBuffer, 
    meta: { lcb: number, impressions: number, rejections: number, textModel: string, imageModel: string }
  ) {
      // 1. Upload to Storage
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ropgcp.firebasestorage.app';
      const bucket = storage.bucket(bucketName);
      const fileName = `icons/${ingredientName.replace(/\s+/g, '-')}-${Date.now()}.png`;
      const file = bucket.file(fileName);
      const token = randomUUID();

      await file.save(Buffer.from(imageBuffer), {
          metadata: { 
              contentType: 'image/png',
              metadata: {
                  firebaseStorageDownloadTokens: token,
                  impressions: String(meta.impressions),
                  rejections: String(meta.rejections),
                  lcb: String(meta.lcb),
                  prompt: visualDescription,
                  textModel: meta.textModel,
                  imageModel: meta.imageModel
              }
          }
      });
      
      const finalUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;

      // 2. Write to Firestore
      await db.collection('ingredients').doc(ingredientId).collection('icons').add({
          url: finalUrl,
          impressions: meta.impressions,
          rejections: meta.rejections,
          popularity_score: meta.lcb,
          ingredient_name: ingredientName,
          created_at: FieldValue.serverTimestamp(),
          marked_for_deletion: false,
          prompt: visualDescription,
          textModel: meta.textModel,
          imageModel: meta.imageModel
      });

      return finalUrl;
  }

  async recordRejection(iconUrl: string, ingredientName: string, ingredientId: string) {
    // We already have the ID, so we can query directly or search
    const iconsRef = db.collection('ingredients').doc(ingredientId).collection('icons');
    const snapshot = await iconsRef.where('url', '==', iconUrl).get();
    
    if (snapshot.empty) throw new Error('Icon not found in Firestore');

    const batch = db.batch();
    for (const doc of snapshot.docs) {
        const data = doc.data();
        const n = (data.impressions || 0);
        const r = (data.rejections || 0) + 1;
        const newLcb = this.calculateWilsonLCB(n, r);

        batch.update(doc.ref, { 
            rejections: FieldValue.increment(1),
            popularity_score: newLcb
        });
        
        await this.updateStorageMetadata(iconUrl, { rejections: r, lcb: newLcb });
    }
    await batch.commit();
  }

  async deleteIcon(iconUrl: string, ingredientName?: string) {
    // 1. Firestore: Targeted Delete
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
    
    // 2. Storage
    if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
        const matches = iconUrl.match(/\/o\/([^?]+)/);
        if (matches && matches[1]) {
            const filePath = decodeURIComponent(matches[1]);
            const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
            await bucket.file(filePath).delete().catch(() => {}); // Ignore missing
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
                  const matches = data.url.match(/\/o\/([^?]+)/);
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
          // @ts-ignore
          popularityScore: file.metadata.metadata?.lcb || '0',
          // @ts-ignore
          impressions: file.metadata.metadata?.impressions || '0',
          // @ts-ignore
          rejections: file.metadata.metadata?.rejections || '0',
          mediaLink: file.metadata.mediaLink || null,
          publicUrl: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(file.name)}?alt=media`
      }));
  }

  // Helpers
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
          const matches = iconUrl.match(/\/o\/([^?]+)/);
          if (matches && matches[1]) {
              const bucket = storage.bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
              const file = bucket.file(decodeURIComponent(matches[1]));
              const [existing] = await file.getMetadata();
              const metadata = { ...(existing.metadata || {}), ...updates };
              // Convert all values to strings
              for (const k in metadata) metadata[k] = String(metadata[k]);
              await file.setMetadata({ metadata });
          }
      } catch (e) { console.warn('Meta update failed', e); }
  }
}

// --- Memory Implementation ---
export class MemoryDataService implements DataService {
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

  async saveIcon(ingredientId: string, ingredientName: string, visualDescription: string, publicUrl: string, buffer: ArrayBuffer, meta: any) {
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
          // Recalculate LCB
          const z = 1.645;
          const k = n - r; const p = k / n; 
          const den = 1 + (z * z) / n;
          const centre = p + (z * z) / (2 * n);
          const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
          const newLcb = Math.max(0, (centre - adj) / den);

          memoryStore.updateIcon(icon.id, { rejections: r, popularity_score: newLcb });
      }
  }

  async incrementImpressions(ingredientId: string, iconId: string, iconUrl: string, newScore: number, newImpressions: number) {
      memoryStore.updateIcon(iconId, { impressions: newImpressions, popularity_score: newScore });
  }

  async deleteIcon(iconUrl: string) {
      memoryStore.deleteIcon(iconUrl);
  }

  async deleteIngredientCategory(name: string) {
      memoryStore.deleteIngredient(name);
  }

  async listDebugFiles() {
      // Return memory icons formatted like storage files
      return memoryStore.getAllIcons().map(icon => ({
          name: `icons/${icon.ingredient}-${icon.id}.png`,
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

// --- Singleton / Factory ---

let currentDataService: DataService | null = null;

export function getDataService(): DataService {
  if (currentDataService) return currentDataService;
  currentDataService = new FirebaseDataService();
  return currentDataService;
}

export function setDataService(service: DataService) {
    currentDataService = service;
}

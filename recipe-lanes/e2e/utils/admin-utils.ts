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

// playwright/admin-utils.ts
import * as admin from 'firebase-admin';

// Ensure we only initialize the app once
if (!admin.apps.length) {
  // 1. Force Admin SDK to talk to the Emulator
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "local-project-id";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"; 
  process.env.GCLOUD_PROJECT = projectId; 

  admin.initializeApp({
    projectId: projectId,
  });
}

/**
 * Creates a user in the emulator and returns a Custom Token for them.
 */
export async function getTestUserToken(uid: string, claims?: object, displayName?: string) {
  const finalDisplayName = displayName || '';

  try {
    // 1. Try to find the user
    await admin.auth().getUser(uid);
    
    // 2. If found, UPDATE them to match the requested name (Crucial for test stability)
    // This fixes the issue where old "User" names persist
    await admin.auth().updateUser(uid, { 
      displayName: finalDisplayName,
      emailVerified: true 
    });
    
  } catch (error) {
    // 3. If not found, CREATE them with the name
    try {
      await admin.auth().createUser({
        uid,
        email: `${uid}@example.com`,
        displayName: finalDisplayName,
        emailVerified: true,
      });
    } catch (createError: any) {
        // If race condition and user now exists, update them instead
        if (createError.code === 'auth/uid-already-exists') {
             await admin.auth().updateUser(uid, { 
                displayName: finalDisplayName,
                emailVerified: true 
             });
        } else {
            throw createError;
        }
    }
  }

  // 4. Return the token (and the name, if you want to verify it later)
  const token = await admin.auth().createCustomToken(uid, claims);
  return { token, displayName: finalDisplayName };
}

export async function promoteToAdmin(uid: string) {
    const db = admin.firestore();
    await db.collection('users').doc(uid).set({
        isAdmin: true,
        updated_at: new Date().toISOString()
    }, { merge: true });
    console.log(`Promoted ${uid} to Admin via admin-utils.`);
}

/**
 * Clears the Firestore Emulator database.
 * Useful for tests that require a clean state (e.g. checking initial generation).
 */
export async function clearFirestore() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "local-project-id";
  const endpoint = `http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`;
  
  try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok) {
          console.error(`Failed to clear Firestore: ${response.statusText}`);
      } else {
          console.log('Firestore Emulator cleared.');
      }
  } catch (e) {
      console.warn('Could not clear Firestore (Emulator might not be running or reachable):', e);
  }
}

/**
 * Clears the Storage Emulator.
 */
export async function clearStorage() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "local-project-id";
  const endpoint = `http://127.0.0.1:9199/v0/b/${projectId}.firebasestorage.app/o`;
  
  try {
      const res = await fetch(endpoint);
      if (res.ok) {
          const data = await res.json();
          if (data.items) {
              await Promise.all(data.items.map(async (item: any) => {
                  await fetch(`${endpoint}/${encodeURIComponent(item.name)}`, { method: 'DELETE' });
              }));
          }
          console.log('Storage Emulator cleared.');
      }
  } catch (e) {
      console.warn('Could not clear Storage:', e);
  }
}
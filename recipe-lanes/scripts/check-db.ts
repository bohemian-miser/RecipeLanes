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

import 'dotenv/config';
import { db } from '../lib/firebase-admin';

async function checkIngredients() {
  console.log('Listing all ingredients...');
  try {
      const snapshot = await db.collection('ingredients').get();
      
      if (snapshot.empty) {
          console.log('No ingredients found in Firestore.');
          return;
      }

      snapshot.docs.forEach(doc => {
          console.log(` - ID: ${doc.id}, Name: "${doc.data().name}"`);
      });
  } catch (e: any) {
      const errString = String(e);
      if (errString.includes('invalid_grant') || errString.includes('invalid_rapt')) {
          console.warn('Warning: Could not connect to Cloud Firestore due to missing or invalid credentials.');
          console.warn('Note: The application is currently running in "fallback mode" using an in-memory store.');
          console.warn('      Since this script runs as a separate process, the in-memory store is empty here.');
      } else {
          console.error('Failed to list ingredients:', e);
      }
  }
}

checkIngredients();
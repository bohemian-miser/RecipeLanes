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

// import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config();
import { auth, db } from '../lib/firebase-admin';

async function makeAdmin(email: string) {
  const args = process.argv.slice(2);
  const stagingIndex = args.indexOf('--staging');
  
  if (stagingIndex !== -1) {
      console.log('✨ Switching to STAGING environment (.env.staging)...');
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          console.log('⚠️  Unsetting GOOGLE_APPLICATION_CREDENTIALS to avoid Prod conflict.');
          delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      }
      dotenv.config({ path: '.env.staging', override: true });
  } else {
      dotenv.config();
  }
  if (!email) {
    console.error('Please provide an email address.');
    process.exit(1);
  }

  console.log(`Looking up user: ${email}...`);
  try {
    const user = await auth.getUserByEmail(email);
    console.log(`Found user: ${user.uid}`);

    await db.collection('users').doc(user.uid).set({
      email: user.email,
      isAdmin: true,
      updated_at: new Date().toISOString()
    }, { merge: true });

    console.log(`SUCCESS: User ${email} (${user.uid}) is now an Admin.`);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.error('Error: User not found. Have they logged in yet?');
    } else {
      console.error('Error:', error);
    }
    process.exit(1);
  }
}

const targetEmail = process.argv[2];
makeAdmin(targetEmail);
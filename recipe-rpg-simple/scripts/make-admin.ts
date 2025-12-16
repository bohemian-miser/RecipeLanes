import 'dotenv/config';
import { auth, db } from '../lib/firebase-admin';

async function makeAdmin(email: string) {
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

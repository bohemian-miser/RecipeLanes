import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';

async function createIndex() {
  const auth = new GoogleAuth({
    keyFile: './staging-service-account.json',
    scopes: ['https://www.googleapis.com/auth/datastore']
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const url = `https://firestore.googleapis.com/v1/projects/recipe-lanes-staging/databases/(default)/collectionGroups/icon_index_browser/indexes`;
  
  const payload = {
    queryScope: "COLLECTION",
    fields: [
      {
        fieldPath: "embedding",
        vectorConfig: {
          dimension: 384,
          flat: {}
        }
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log('Response:', data);
}

createIndex().catch(console.error);

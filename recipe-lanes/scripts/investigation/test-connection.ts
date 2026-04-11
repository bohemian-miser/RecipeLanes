
const path = require('path');
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, '../../staging-service-account.json');

const admin = require('firebase-admin');
admin.initializeApp({
    projectId: 'recipe-lanes-staging'
});

const db = admin.firestore();
db.collection('recipes').limit(1).get()
    .then(snap => {
        console.log('Success! Got', snap.docs.length, 'recipes');
        process.exit(0);
    })
    .catch(err => {
        console.error('Failed:', err);
        process.exit(1);
    });

import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from './firebase-applet-config.json';

async function main() {
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  console.log('Project ID:', firebaseConfig.projectId);
  console.log('Database ID:', firebaseConfig.firestoreDatabaseId);
  console.log('Client Email:', clientEmail);
  console.log('Has Private Key:', !!privateKey);

  try {
    if (admin.apps.length === 0) {
      if (privateKey && clientEmail) {
        console.log('Initializing with Service Account credentials...');
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: firebaseConfig.projectId,
            clientEmail: clientEmail,
            privateKey: privateKey,
          })
        });
      } else {
        console.log('Initializing with default credentials...');
        admin.initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
    }

    const db = getFirestore(admin.apps[0]!, firebaseConfig.firestoreDatabaseId);
    console.log('Querying users...');
    const snap = await db.collection('users').get();
    console.log('Found users count:', snap.size);
    snap.docs.forEach(doc => {
      console.log(`- ${doc.id}:`, doc.data());
    });
  } catch (error: any) {
    console.error('Error during test:', error.stack || error.message);
  }
}

main();

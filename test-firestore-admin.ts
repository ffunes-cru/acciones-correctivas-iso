import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

let firebaseConfig: any = null;
try {
  firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
} catch (err) {
  console.error('Failed to read config:', err);
}

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

console.log('Firebase Config ProjectID:', firebaseConfig?.projectId);
console.log('Firebase Config DatabaseID:', firebaseConfig?.firestoreDatabaseId);

async function testWithDefault() {
  console.log('\n--- Test 1: Default App Credentials (ADC) ---');
  try {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }
    
    const db = getFirestore(admin.apps[0]!, firebaseConfig.firestoreDatabaseId || firebaseConfig.databaseId);
    console.log('Attempting to read collections using ADC...');
    const collections = await db.listCollections();
    console.log('ADC Success! Collections:', collections.map(c => c.id));
  } catch (err: any) {
    console.error('ADC failed:', err.message);
  }
}

async function testWithServiceAccount() {
  console.log('\n--- Test 2: Service Account Credentials from .env ---');
  try {
    if (!email || !privateKey) {
      console.log('Service account email or private key not in env.');
      return;
    }
    
    // Reset/delete apps
    await Promise.all(admin.apps.map(app => app?.delete()));

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebaseConfig.projectId,
        clientEmail: email,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      })
    });
    
    const db = getFirestore(admin.apps[0]!, firebaseConfig.firestoreDatabaseId || firebaseConfig.databaseId);
    console.log('Attempting to read collections using SA...');
    const collections = await db.listCollections();
    console.log('SA Success! Collections:', collections.map(c => c.id));
  } catch (err: any) {
    console.error('SA failed:', err.message);
  }
}

async function run() {
  await testWithDefault();
  await testWithServiceAccount();
}

run();

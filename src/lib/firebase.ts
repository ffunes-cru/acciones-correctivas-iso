import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore, doc, getDocFromServer } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
console.log('Firebase Config Loaded:', {
  projectId: firebaseConfig.projectId,
  databaseId: (firebaseConfig as any).firestoreDatabaseId
});
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, (firebaseConfig as any).firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

// Validation connection test
async function testConnection() {
  console.log('Testing Firestore connection to:', (firebaseConfig as any).firestoreDatabaseId);
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firestore connection successful');
  } catch (error) {
    console.error("Connection test failed:", error);
    if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('Could not reach Cloud Firestore backend'))) {
      console.error("Please check your Firebase configuration or internet connection.");
    }
  }
}
testConnection();

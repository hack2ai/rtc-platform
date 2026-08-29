import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
export const db = firestoreDatabaseId
  ? getFirestore(admin.app(), firestoreDatabaseId)
  : getFirestore(admin.app());
export const storage = admin.storage();
export const auth = admin.auth();
export default admin;

import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithPopup, GoogleAuthProvider, signOut,
  setPersistence, browserLocalPersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ── CRITICAL: persist session across browser restarts ──
// Without this, closing the browser logs the user out → new userId → data appears empty
setPersistence(auth, browserLocalPersistence).catch(err => {
  console.error('Auth persistence error:', err);
});

export const loginWithGoogle = async () => {
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

export const logout = () => signOut(auth);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`Firestore [${operationType}] ${path}: ${msg}`);
  throw new Error(msg);
}

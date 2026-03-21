import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

function resolveServiceAccountPath() {
  const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!p) return null;
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

export function ensureFirebaseApp() {
  if (admin.apps.length > 0) return;
  const resolved = resolveServiceAccountPath();
  if (!resolved || !existsSync(resolved)) {
    throw new Error(
      'Firebase が未設定です。FIREBASE_SERVICE_ACCOUNT_PATH にサービスアカウント JSON のパスを設定し、プロジェクトで Firestore を有効化してください。',
    );
  }
  const sa = JSON.parse(readFileSync(resolved, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

/** @returns {import('firebase-admin/firestore').Firestore} */
export function getAdminFirestore() {
  ensureFirebaseApp();
  return admin.firestore();
}

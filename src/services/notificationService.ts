import { collection, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('[Firestore Error Details]', JSON.stringify(errInfo, null, 2));
  return errInfo;
}

interface NotificationData {
  to: string;
  subject: string;
  body: string;
  htmlBody?: string;
  attachment?: {
    filename: string;
    content: string; // Base64 string
    type: string;
  };
  type: 'creation' | 'assignment' | 'action_assigned' | 'overdue' | 'verification';
  findingId?: string; // ID del hallazgo relacionado
}

export async function sendNotification(data: NotificationData) {
  let docRef: any = null;
  try {
    // 1. Log to Firestore for visibility in UI (exclude large attachment/htmlBody)
    try {
      const { htmlBody, attachment, ...dbData } = data;
      docRef = await addDoc(collection(db, 'notifications'), {
        ...dbData,
        hasAttachment: !!attachment,
        status: 'sending',
        createdAt: serverTimestamp(),
      });
    } catch (dbErr) {
      handleFirestoreError(dbErr, OperationType.CREATE, 'notifications');
      // Continue to API even if DB log fails
    }

    // 2. Call backend for real email
    const response = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    console.log('[NotificationService] Result:', result);

    // 3. Update Firestore log with actual delivery result
    if (docRef) {
      try {
        await updateDoc(docRef, {
          status: result.success ? 'sent' : 'failed',
          via: result.via || null,
          error: result.error || null,
        });
      } catch (updateErr) {
        console.error('Failed to update notification status in DB:', updateErr);
      }
    }

    return result;
  } catch (error) {
    console.error('Failed to send notification via API:', error);
    if (docRef) {
      try {
        await updateDoc(docRef, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (dbErr) {}
    }
    return { success: false, error };
  }
}

export function generateFindingLink(findingId: string, section?: string) {
  const env = (import.meta as any).env;
  const publicUrl = env?.VITE_PUBLIC_URL || (typeof process !== 'undefined' ? process.env?.PUBLIC_APP_URL || process.env?.VITE_PUBLIC_URL : undefined);
  let base = publicUrl;
  if (!base && typeof window !== 'undefined') {
    base = window.location.origin;
  }
  if (!base) base = '';
  // Ensure no trailing slash on base
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const baseUrl = `${cleanBase}/findings/${findingId}`;
  const finalUrl = section ? `${baseUrl}#${section}` : baseUrl;
  console.log('Generating link:', finalUrl, { origin: typeof window !== 'undefined' ? window.location.origin : 'server', publicUrl });
  return finalUrl;
}

export function generateCalendarLink(calendarId: string, taskId?: string) {
  const env = (import.meta as any).env;
  const publicUrl = env?.VITE_PUBLIC_URL || (typeof process !== 'undefined' ? process.env?.PUBLIC_APP_URL || process.env?.VITE_PUBLIC_URL : undefined);
  let base = publicUrl;
  if (!base && typeof window !== 'undefined') {
    base = window.location.origin;
  }
  if (!base) base = '';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (taskId) {
    return `${cleanBase}/iso-calendar/${calendarId}?taskId=${taskId}`;
  }
  return `${cleanBase}/iso-calendar/${calendarId}`;
}

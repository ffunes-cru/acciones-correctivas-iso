import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase';
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { format } from 'date-fns';
import { Finding, CorrectiveAction, CauseAnalysis } from '../types';

const TOKEN_KEY = 'sgc_google_workspace_token';
const TOKEN_TIME_KEY = 'sgc_google_workspace_token_time';

// In-memory access token cache
let memoryToken: string | null = null;
let isSyncing = false;
let syncTimeoutId: any = null;
let isBackendSyncBlocked = false;
let lastSyncTimestamp = 0;

export function getCachedToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const timeStr = localStorage.getItem(TOKEN_TIME_KEY);
    if (token && timeStr) {
      const timestamp = parseInt(timeStr, 10);
      const now = Date.now();
      // Google API access tokens expire in 1 hour. We pre-emptively expire it at 55 minutes.
      if (now - timestamp < 55 * 60 * 1000) {
        memoryToken = token;
        return token;
      } else {
        // Clear expired token proactively
        setCachedToken(null);
      }
    }
  } catch (e) {}
  return null;
}

export function restoreCachedTokenFromFirestore(token: string, timestamp: number) {
  memoryToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_TIME_KEY, timestamp.toString());
    updateSyncState({ status: 'idle', error: null });
  } catch (e) {}
}

export function setCachedToken(token: string | null) {
  memoryToken = token;
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_TIME_KEY, Date.now().toString());
      
      // Persist to user's profile in Firestore as a durable backup
      if (auth.currentUser?.uid) {
        setDoc(doc(db, 'users', auth.currentUser.uid), {
          googleSheetsToken: token,
          googleSheetsTokenTime: Date.now()
        }, { merge: true }).catch(err => {
          console.warn('[GoogleWorkspace] Failed to save token to firestore:', err);
        });
      }
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_TIME_KEY);

      // Clear from firestore
      if (auth.currentUser?.uid) {
        setDoc(doc(db, 'users', auth.currentUser.uid), {
          googleSheetsToken: null,
          googleSheetsTokenTime: null
        }, { merge: true }).catch(err => {
          console.warn('[GoogleWorkspace] Failed to clear token in firestore:', err);
        });
      }
    }
  } catch (e) {}
}

// Global sync state event listener system so UI components can subscribe to sync updates!
export type SyncStatusType = 'idle' | 'syncing' | 'success' | 'error' | 'disconnected';

export interface SyncState {
  status: SyncStatusType;
  lastSyncTime: string | null;
  error: string | null;
  spreadsheetUrl: string | null;
}

let currentSyncState: SyncState = {
  status: 'disconnected',
  lastSyncTime: null,
  error: null,
  spreadsheetUrl: null,
};

// Try to pre-load sync state from local storage for backend-based sync
try {
  const cachedUrl = localStorage.getItem('sgc_backend_sheet_url');
  const cachedTime = localStorage.getItem('sgc_backend_sheet_time');
  if (cachedUrl) {
    currentSyncState = {
      status: 'success',
      lastSyncTime: cachedTime || 'Reciente',
      error: null,
      spreadsheetUrl: cachedUrl
    };
  }
} catch (e) {}

const listeners = new Set<(state: SyncState) => void>();

export function getSyncState(): SyncState {
  // If we have a token or backend sync URL, set status appropriately
  try {
    const cachedUrl = localStorage.getItem('sgc_backend_sheet_url');
    if (cachedUrl && currentSyncState.status === 'disconnected') {
      currentSyncState.status = 'success';
      currentSyncState.spreadsheetUrl = cachedUrl;
      currentSyncState.lastSyncTime = localStorage.getItem('sgc_backend_sheet_time') || 'Reciente';
    } else if (getCachedToken() && currentSyncState.status === 'disconnected') {
      currentSyncState.status = 'idle';
    }
  } catch (e) {}
  return currentSyncState;
}

let serverConfig: { hasServiceAccount: boolean; serviceAccountEmail: string | null } | null = null;

export async function fetchServerConfig(): Promise<{ hasServiceAccount: boolean; serviceAccountEmail: string | null }> {
  if (serverConfig) return serverConfig;
  try {
    const res = await fetch('/api/sheets/config');
    if (res.ok) {
      serverConfig = await res.json();
      return serverConfig!;
    }
  } catch (e) {
    console.error('Failed to fetch sheets config from server:', e);
  }
  return { hasServiceAccount: false, serviceAccountEmail: null };
}

function serializeTimestamps(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  
  // If it's a Firestore Timestamp (has toDate function)
  if (typeof obj.toDate === 'function') {
    return {
      seconds: typeof obj.seconds === 'number' ? obj.seconds : Math.floor(obj.toDate().getTime() / 1000),
      nanoseconds: typeof obj.nanoseconds === 'number' ? obj.nanoseconds : 0
    };
  }
  
  // If it's a Date object
  if (obj instanceof Date) {
    return { seconds: Math.floor(obj.getTime() / 1000), nanoseconds: 0 };
  }
  
  // If it's an array
  if (Array.isArray(obj)) {
    return obj.map(serializeTimestamps);
  }
  
  // If it's an object
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      res[key] = serializeTimestamps(val);
    }
    return res;
  }
  
  return obj;
}

async function gatherAllSyncData(): Promise<any[]> {
  const findingsSnap = await getDocs(collection(db, 'findings'));
  const allFindings = findingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Finding));

  // Sort by findingNumber ascending
  allFindings.sort((a, b) => (a.findingNumber || 0) - (b.findingNumber || 0));

  // Query analyses and corrective actions for each finding in parallel
  const fullData = await Promise.all(
    allFindings.map(async (finding) => {
      try {
        // Fetch cause analysis
        const analysisDoc = await getDoc(doc(db, 'findings', finding.id, 'analysis', 'current'));
        const analysis = analysisDoc.exists() ? analysisDoc.data() : null;

        // Fetch corrective actions
        const actionsSnap = await getDocs(collection(db, 'findings', finding.id, 'correctiveActions'));
        const correctiveActions = actionsSnap.docs.map(
          doc => ({ id: doc.id, ...doc.data() })
        );

        return { finding, analysis, correctiveActions };
      } catch (err) {
        console.error(`[GoogleWorkspace] Error fetching subcollections for finding ${finding.id}:`, err);
        return { finding, analysis: null, correctiveActions: [] };
      }
    })
  );

  return serializeTimestamps(fullData);
}

async function gatherAllIsoCalendars(): Promise<any[]> {
  try {
    const calendarsSnap = await getDocs(collection(db, 'iso_calendars'));
    const calendars = await Promise.all(
      calendarsSnap.docs.map(async (calDoc) => {
        const calData = calDoc.data();
        const tasksSnap = await getDocs(collection(db, 'iso_calendars', calDoc.id, 'tasks'));
        const tasks = tasksSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return { id: calDoc.id, ...calData, tasks };
      })
    );
    return serializeTimestamps(calendars);
  } catch (err) {
    console.error('[GoogleWorkspace] Error gathering ISO calendars:', err);
    return [];
  }
}

async function gatherNotificationHistory(): Promise<any[]> {
  try {
    const historySnap = await getDocs(collection(db, 'notificationHistory'));
    return serializeTimestamps(historySnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) {
    console.error('[GoogleWorkspace] Error gathering notification history:', err);
    return [];
  }
}

async function gatherAllSpecialReleases(): Promise<any[]> {
  try {
    const snap = await getDocs(collection(db, 'special_releases'));
    const releases = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort by releaseNumber ascending
    releases.sort((a: any, b: any) => (a.releaseNumber || 0) - (b.releaseNumber || 0));
    return serializeTimestamps(releases);
  } catch (err) {
    console.error('[GoogleWorkspace] Error gathering special releases:', err);
    return [];
  }
}

async function gatherAllChangeRequests(): Promise<any[]> {
  try {
    const snap = await getDocs(collection(db, 'change_requests'));
    const requests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Sort by changeNumber ascending
    requests.sort((a: any, b: any) => (a.changeNumber || 0) - (b.changeNumber || 0));
    return serializeTimestamps(requests);
  } catch (err) {
    console.error('[GoogleWorkspace] Error gathering change requests:', err);
    return [];
  }
}

export async function syncViaBackendService(isManual: boolean = false): Promise<string> {
  if (isManual) {
    // Manual triggers reset any background blocks to allow clean retries
    isBackendSyncBlocked = false;
  }

  if (isSyncing) {
    return currentSyncState.spreadsheetUrl || '';
  }
  isSyncing = true;
  updateSyncState({ status: 'syncing', error: null });

  try {
    const userEmail = auth.currentUser?.email || '';

    // Gather full dataset from Firestore on the client-side where we have full permissions
    let fullData: any[] | null = null;
    let isoCalendars: any[] = [];
    let notificationHistory: any[] = [];
    let specialReleases: any[] = [];
    let changeRequests: any[] = [];
    let userRole = 'user';
    try {
      fullData = await gatherAllSyncData();
      console.log(`[GoogleWorkspace] Client successfully gathered data: ${fullData?.length || 0} findings.`);

      isoCalendars = await gatherAllIsoCalendars();
      console.log(`[GoogleWorkspace] Client successfully gathered ${isoCalendars.length} ISO calendars.`);

      notificationHistory = await gatherNotificationHistory();
      console.log(`[GoogleWorkspace] Client successfully gathered ${notificationHistory.length} history records.`);

      specialReleases = await gatherAllSpecialReleases();
      console.log(`[GoogleWorkspace] Client successfully gathered ${specialReleases.length} special releases.`);

      changeRequests = await gatherAllChangeRequests();
      console.log(`[GoogleWorkspace] Client successfully gathered ${changeRequests.length} change requests.`);

      if (auth.currentUser) {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          userRole = userDoc.data()?.role || 'user';
          console.log(`[GoogleWorkspace] Client successfully fetched user role: ${userRole}`);
        }
      }
    } catch (gatherErr) {
      console.error('[googleWorkspace] Client-side data gathering failed:', gatherErr);
    }

    if (!fullData || fullData.length === 0) {
      console.warn('[googleWorkspace] Client gathered 0 findings or gathering failed. Skipping backend post to prevent blanking the sheet.');
      throw new Error('No se encontraron hallazgos en la base de datos para sincronizar, o no se pudieron cargar en este momento. Por favor, intente de nuevo.');
    }

    const res = await fetch('/api/sheets/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userEmail, userRole, fullData, isoCalendars, notificationHistory, specialReleases, changeRequests })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errData: any = {};
      try {
        errData = JSON.parse(errText);
      } catch (e) {}

      const isForbidden = res.status === 403 || 
                          errData.error === 'server_permission_denied' ||
                          errText.includes('403') ||
                          errText.toLowerCase().includes('forbidden');

      if (isForbidden) {
        isBackendSyncBlocked = true;
        console.warn('[googleWorkspace] Backend sync is blocked due to access restrictions (403). Background sync is temporarily paused to protect from rate limits.');
        const token = getCachedToken();
        if (token) {
          return await syncAllToGoogleSheets(token);
        } else {
          throw new Error('La sincronización automática del servidor no está disponible debido a restricciones de acceso (Código 403). Por favor, haz clic en "Vincular Google Sheets" para sincronizar directamente y de forma segura utilizando tu propia cuenta de Google.');
        }
      }
      
      console.warn('[googleWorkspace] Backend sync failed with status:', res.status, 'Response:', errText);
      throw new Error(errData.message || errData.error || `Error al sincronizar con el servidor (status: ${res.status}).`);
    }

    const data = await res.json();
    
    // Process offline histories returned by the server and sync them back to Firestore
    if (data.offlineHistories && Array.isArray(data.offlineHistories) && data.offlineHistories.length > 0) {
      console.log(`[GoogleWorkspace] Syncing ${data.offlineHistories.length} offline-generated notification histories back to Firestore...`);
      for (const history of data.offlineHistories) {
        try {
          const docRef = doc(db, 'notificationHistory', history.id);
          const { id, isOfflineGenerated, ...dbData } = history;
          await setDoc(docRef, {
            ...dbData,
            sentAt: serverTimestamp(),
            syncedFromOffline: true
          });
          console.log(`[GoogleWorkspace] Successfully synced offline history: ${history.id}`);
        } catch (dbErr) {
          console.error(`[GoogleWorkspace] Failed to sync offline history ${history.id} back to Firestore:`, dbErr);
        }
      }
    }
    
    if (data.spreadsheetUrl) {
      updateSyncState({
        status: 'success',
        lastSyncTime: data.lastSyncTime,
        error: null,
        spreadsheetUrl: data.spreadsheetUrl
      });
      
      try {
        localStorage.setItem('sgc_backend_sheet_url', data.spreadsheetUrl);
        localStorage.setItem('sgc_backend_sheet_time', data.lastSyncTime);
      } catch (e) {}
    }

    isSyncing = false;
    return data.spreadsheetUrl || '';
  } catch (err: any) {
    isSyncing = false;
    console.warn('[googleWorkspace] Backend sync encountered an expected restriction or config block:', err.message || err);
    
    if (isManual) {
      updateSyncState({
        status: 'error',
        error: err.message || 'Error al sincronizar usando la Cuenta de Servicio.'
      });
    } else {
      // Background auto-sync is silent: keep the previous success state if available, or stay in 'disconnected'
      const cachedUrl = localStorage.getItem('sgc_backend_sheet_url');
      if (cachedUrl) {
        updateSyncState({
          status: 'success',
          spreadsheetUrl: cachedUrl,
          lastSyncTime: localStorage.getItem('sgc_backend_sheet_time') || 'Reciente',
          error: null
        });
      } else {
        updateSyncState({
          status: 'disconnected',
          error: null // Do not populate errors in the UI for background sync
        });
      }
    }
    throw err;
  }
}

export function subscribeToSyncState(listener: (state: SyncState) => void) {
  listeners.add(listener);
  listener(currentSyncState);
  return () => {
    listeners.delete(listener);
  };
}

function updateSyncState(updates: Partial<SyncState>) {
  currentSyncState = { ...currentSyncState, ...updates };
  listeners.forEach(listener => listener(currentSyncState));
}

/**
 * Initiates the Google Sign-In flow specifying the required Workspace scopes
 */
export async function googleSignInForWorkspace(): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  provider.addScope('https://www.googleapis.com/auth/drive.file');

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('No se pudo obtener el token de acceso de Google.');
    }
    setCachedToken(credential.accessToken);
    updateSyncState({ status: 'idle', error: null });
    
    // Auto-trigger sync right after signing in
    setTimeout(() => {
      triggerAutoSync();
    }, 500);

    return credential.accessToken;
  } catch (error: any) {
    console.error('Error in googleSignInForWorkspace:', error);
    updateSyncState({ status: 'error', error: error.message || 'Error al conectar con Google.' });
    throw error;
  }
}

/**
 * Synchronizes 100% of the SGC findings and actions database into a single Google Sheets spreadsheet.
 */
export async function syncAllToGoogleSheets(accessToken: string): Promise<string> {
  if (isSyncing) {
    console.log('[GoogleWorkspace] Sync already in progress, skipping duplicate call.');
    return currentSyncState.spreadsheetUrl || '';
  }
  isSyncing = true;
  updateSyncState({ status: 'syncing', error: null });
  
  try {
    // 1. Fetch all findings from Firestore
    const findingsSnap = await getDocs(collection(db, 'findings'));
    const allFindings = findingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Finding));

    // Sort by findingNumber ascending
    allFindings.sort((a, b) => (a.findingNumber || 0) - (b.findingNumber || 0));

    // Fetch all special releases from Firestore
    const specialReleasesSnap = await getDocs(collection(db, 'special_releases'));
    const allSpecialReleases = specialReleasesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    allSpecialReleases.sort((a, b) => (a.releaseNumber || 0) - (b.releaseNumber || 0));

    // Fetch all change requests from Firestore
    const changeRequestsSnap = await getDocs(collection(db, 'change_requests'));
    const allChangeRequests = changeRequestsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    allChangeRequests.sort((a, b) => (a.changeNumber || 0) - (b.changeNumber || 0));

    // 2. Query analyses and corrective actions for each finding in parallel with individual error resilience
    const fullData = await Promise.all(
      allFindings.map(async (finding) => {
        try {
          // Fetch cause analysis
          const analysisDoc = await getDoc(doc(db, 'findings', finding.id, 'analysis', 'current'));
          const analysis = analysisDoc.exists() ? (analysisDoc.data() as CauseAnalysis) : null;

          // Fetch corrective actions
          const actionsSnap = await getDocs(collection(db, 'findings', finding.id, 'correctiveActions'));
          const correctiveActions = actionsSnap.docs.map(
            doc => ({ id: doc.id, ...doc.data() } as CorrectiveAction)
          );

          return { finding, analysis, correctiveActions };
        } catch (err) {
          console.error(`[GoogleWorkspace] Error fetching subcollections for finding ${finding.id}:`, err);
          return { finding, analysis: null, correctiveActions: [] };
        }
      })
    );

    // Helper to format timestamps or generic dates safely
    const formatFirebaseDate = (val: any): string => {
      if (!val) return '';
      try {
        if (typeof val.toDate === 'function') {
          return format(val.toDate(), 'dd/MM/yyyy');
        }
        if (val && typeof val === 'object') {
          const seconds = val.seconds ?? val._seconds ?? val.secondsValue;
          if (typeof seconds === 'number') {
            return format(new Date(seconds * 1000), 'dd/MM/yyyy');
          }
        }
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
          return format(d, 'dd/MM/yyyy');
        }
      } catch (e) {
        console.error("Error formatting date:", e);
      }
      return '';
    };

    // 3. Flatten findings + analysis + corrective actions into rows for each sheet
    const correctiveRows: any[][] = [];
    const improvementRows: any[][] = [];
    const specialReleaseRows: any[][] = [];
    const mocRows: any[][] = [];
    
    // Headers for Corrective Actions sheet
    correctiveRows.push([
      'Nro. Hallazgo',
      'Empresa',
      'Fecha del Hallazgo',
      'Origen',
      'Tipo de Hallazgo',
      'Proceso que genera el desvío',
      'Descripción del hallazgo',
      'Asignar responsable del análisis',
      'Fecha requerida para análisis',
      'Análisis de Causa',
      'Acciones de Contingencia',
      'Acción correctiva',
      'REsponsable',
      'Fecha REquerida',
      'Fecha de cierre de acción',
      'Fecha de verificación'
    ]);

    // Headers for Improvements sheet
    improvementRows.push([
      'Nro. Mejora',
      'Empresa',
      'Fecha de Carga',
      'Origen',
      'Descripción de la Mejora',
      'Dueño del Registro',
      'Acción de Mejora',
      'Responsable de la Acción',
      'Fecha Requerida',
      'Fecha de Cierre de Acción',
      'Fecha de Verificación'
    ]);

    for (const item of fullData) {
      const f = item.finding;
      const a = item.analysis;
      const actions = item.correctiveActions;

      if (f.findingCategory === 'improvement') {
        const baseFields = [
          f.findingNumber !== undefined ? f.findingNumber : '',
          f.company || '',
          formatFirebaseDate(f.findingDate),
          f.origin || '',
          f.description || '',
          f.ownerEmail || '',
        ];

        if (actions.length === 0) {
          improvementRows.push([
            ...baseFields,
            '', // Acción de mejora
            '', // Responsable
            '', // Fecha Requerida
            '', // Fecha de Cierre de Acción
            formatFirebaseDate(f.verificationDate), // Fecha de Verificación
          ]);
        } else {
          for (const act of actions) {
            improvementRows.push([
              ...baseFields,
              act.description || '',
              act.responsibleEmail || '',
              formatFirebaseDate(act.deadline),
              formatFirebaseDate(act.executionDate),
              formatFirebaseDate(act.verificationDate || f.verificationDate),
            ]);
          }
        }
      } else {
        const baseFields = [
          f.findingNumber !== undefined ? f.findingNumber : '',
          f.company || '',
          formatFirebaseDate(f.findingDate),
          f.origin || '',
          f.type || '',
          f.process || '',
          f.description || '',
          f.analysisResponsibleEmail || '',
          formatFirebaseDate(f.analysisDeadline),
          a?.summary || '',
          a?.contingencyActions || '',
        ];

        if (actions.length === 0) {
          correctiveRows.push([
            ...baseFields,
            '', // Acción correctiva
            '', // REsponsable
            '', // Fecha REquerida
            '', // Fecha de cierre de acción
            formatFirebaseDate(f.verificationDate), // Fecha de verificación
          ]);
        } else {
          for (const act of actions) {
            correctiveRows.push([
              ...baseFields,
              act.description || '',
              act.responsibleEmail || '',
              formatFirebaseDate(act.deadline),
              formatFirebaseDate(act.executionDate),
              formatFirebaseDate(act.verificationDate || f.verificationDate),
            ]);
          }
        }
      }
    }

    // Populate Special Releases Sheet headers and rows
    specialReleaseRows.push([
      'Nro. Liberación',
      'Tipo de Liberación',
      'Empresa',
      'Fecha',
      'Descripción del Desvío',
      'Efecto en el Cliente / Impacto',
      'Creador',
      'Estado',
      'Nro. OC (MP)',
      'Código (MP)',
      'Descripción (MP)',
      'Proveedor (MP)',
      'Nro. OF (PT)',
      'Modelo de Máquina (PT)',
      'Cliente / Distribuidor (PT)',
      'Nro. Nota Venta (PT)',
      'Aprob. Calidad',
      'Aprob. Ingeniería',
      'Aprob. Comercial',
      'Aprob. Operaciones',
      'Conf. Posventa',
      'Nro. Acciones Vinculadas'
    ]);

    for (const sr of allSpecialReleases) {
      const typeLabel = sr.type === 'raw_material' ? 'Materia Prima' : 'Producto Terminado';
      
      const appCalidad = sr.approvals?.calidad ? `${sr.approvals.calidad.status.toUpperCase()} (${sr.approvals.calidad.comments || ''})` : 'PENDIENTE';
      const appIngenieria = sr.approvals?.ingenieria ? `${sr.approvals.ingenieria.status.toUpperCase()} (${sr.approvals.ingenieria.comments || ''})` : 'PENDIENTE';
      const appComercial = sr.approvals?.comercial ? `${sr.approvals.comercial.status.toUpperCase()} (${sr.approvals.comercial.comments || ''})` : 'PENDIENTE';
      const appOperaciones = sr.approvals?.operaciones ? `${sr.approvals.operaciones.status.toUpperCase()} (${sr.approvals.operaciones.comments || ''})` : 'PENDIENTE';
      
      const confPosventa = sr.notifications?.posventa 
        ? (sr.notifications.posventa.confirmed ? `CONFIRMADO (${formatFirebaseDate(sr.notifications.posventa.confirmedDate)})` : 'PENDIENTE DE CONFIRMACIÓN')
        : 'NO ASIGNADO';

      const linkedActionsCount = sr.linkedActions?.length || 0;

      specialReleaseRows.push([
        sr.releaseNumber !== undefined ? `LE-#${sr.releaseNumber}` : '',
        typeLabel,
        sr.company || '',
        formatFirebaseDate(sr.date),
        sr.deviationDescription || '',
        sr.clientImpact || '',
        sr.creatorEmail || sr.creatorName || '',
        sr.status ? sr.status.toUpperCase() : 'DRAFT',
        sr.purchaseOrderNumber || '',
        sr.code || '',
        sr.description || '',
        sr.vendor || '',
        sr.ofNumber || '',
        sr.machineModel || '',
        sr.clientDealer || '',
        sr.salesNoteNumber || '',
        appCalidad,
        appIngenieria,
        appComercial,
        appOperaciones,
        confPosventa,
        linkedActionsCount
      ]);
    }

    // Populate MOC sheet headers and rows
    mocRows.push([
      'Nro. Solicitud',
      'Título',
      'Foco/Misión',
      'Creador',
      'Fecha de Creación',
      'Estado',
      'Descripción',
      'Objetivo',
      'Situación Actual',
      'Propuesta de Cambio',
      'Análisis de Impacto',
      'Rev. Ingeniería y Procesos',
      'Rev. Producción',
      'Rev. Mantenimiento',
      'Rev. Calidad',
      'Rev. Supply Chain',
      'Rev. HSE (Seguridad)',
      'Rev. Infraestructura',
      'Rev. Recursos Humanos',
      'Aprobador Final',
      'Aprobación Final Estado',
      'Comentarios Aprobación',
      'Fecha Aprobación Final'
    ]);

    const getMocStatusLabel = (status: string) => {
      switch (status) {
        case 'draft': return 'Borrador';
        case 'pending_review': return 'En Revisión';
        case 'pending_approval': return 'Pend. Aprobación';
        case 'approved': return 'Aprobado';
        case 'rejected': return 'Rechazado';
        default: return status || '';
      }
    };

    const formatMocReview = (rev: any) => {
      if (!rev || !rev.applies) return 'N/A';
      const statusLabel = rev.status === 'approved' ? 'APROBADO' : rev.status === 'rejected' ? 'RECHAZADO' : 'PENDIENTE';
      const comments = rev.comments ? ` - ${rev.comments}` : '';
      const resp = rev.responsibleName || rev.responsibleEmail ? ` (${rev.responsibleName || rev.responsibleEmail})` : '';
      return `${statusLabel}${resp}${comments}`;
    };

    for (const cr of allChangeRequests) {
      mocRows.push([
        cr.changeNumber !== undefined ? `SC-#${cr.changeNumber}` : '',
        cr.title || '',
        cr.mission || '',
        cr.creatorEmail || cr.creatorName || '',
        formatFirebaseDate(cr.createdAt),
        getMocStatusLabel(cr.status),
        cr.description || '',
        cr.objective || '',
        cr.currentSituation || '',
        cr.proposedSituation || '',
        cr.impactAnalysis || '',
        formatMocReview(cr.reviews?.ingenieriaProcesos),
        formatMocReview(cr.reviews?.produccion),
        formatMocReview(cr.reviews?.mantenimiento),
        formatMocReview(cr.reviews?.calidad),
        formatMocReview(cr.reviews?.supplyChain),
        formatMocReview(cr.reviews?.hse),
        formatMocReview(cr.reviews?.infraestructura),
        formatMocReview(cr.reviews?.recursosHumanos),
        cr.finalApproverEmail || cr.finalApproverName || '',
        cr.finalApprovalStatus ? cr.finalApprovalStatus.toUpperCase() : 'PENDIENTE',
        cr.finalApprovalComments || '',
        formatFirebaseDate(cr.finalApprovalDate)
      ]);
    }

    // 4. Locate or Create the spreadsheet in Google Drive
    let spreadsheetId = '';
    const spreadsheetTitle = 'SGC - Historial Completo de Hallazgos y Acciones';

    try {
      const q = `name = '${spreadsheetTitle}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (searchRes.status === 401) {
        const err = new Error('La sesión de Google Sheets ha expirado. Por favor conéctese nuevamente.');
        (err as any).status = 401;
        throw err;
      }

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          spreadsheetId = searchData.files[0].id;
        }
      }
    } catch (e: any) {
      if (e.status === 401) throw e;
      console.error('Error searching for spreadsheet in Google Drive:', e);
    }

    // Create a new spreadsheet if not found
    if (!spreadsheetId) {
      const createBody = {
        properties: {
          title: spreadsheetTitle
        },
        sheets: [
          { properties: { title: 'Acciones Correctivas' } },
          { properties: { title: 'Acciones de Mejora' } },
          { properties: { title: 'Liberaciones Especiales' } },
          { properties: { title: 'moc' } }
        ]
      };

      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(createBody)
      });

      if (!createRes.ok) {
        if (createRes.status === 401) {
          const err = new Error('La sesión de Google Sheets ha expirado. Por favor conéctese nuevamente.');
          (err as any).status = 401;
          throw err;
        }
        const errText = await createRes.text();
        throw new Error(`No se pudo crear la planilla: ${errText}`);
      }

      const createdSpreadsheet = await createRes.json();
      spreadsheetId = createdSpreadsheet.spreadsheetId;
    } else {
      // Ensure all three tabs exist in the found spreadsheet
      try {
        const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (getRes.status === 401) {
          const err = new Error('La sesión de Google Sheets ha expirado. Por favor conéctese nuevamente.');
          (err as any).status = 401;
          throw err;
        }
        if (getRes.ok) {
          const ssData = await getRes.json();
          const existingTitles = ssData.sheets.map((s: any) => s.properties?.title || '');
          const addRequests: any[] = [];
          if (!existingTitles.includes('Acciones Correctivas')) {
            addRequests.push({ addSheet: { properties: { title: 'Acciones Correctivas' } } });
          }
          if (!existingTitles.includes('Acciones de Mejora')) {
            addRequests.push({ addSheet: { properties: { title: 'Acciones de Mejora' } } });
          }
          if (!existingTitles.includes('Liberaciones Especiales')) {
            addRequests.push({ addSheet: { properties: { title: 'Liberaciones Especiales' } } });
          }
          if (!existingTitles.includes('moc')) {
            addRequests.push({ addSheet: { properties: { title: 'moc' } } });
          }
          if (addRequests.length > 0) {
            await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ requests: addRequests })
            });
          }
        }
      } catch (e: any) {
        if (e.status === 401) throw e;
        console.warn('[GoogleWorkspace] Error ensuring tabs exist:', e);
      }
    }

    // 5. Clear previous spreadsheet data entirely to avoid residual rows
    const sheetsToClear = [
      "'Acciones Correctivas'!A1:Z10000",
      "'Acciones de Mejora'!A1:Z10000",
      "'Liberaciones Especiales'!A1:Z10000",
      "'moc'!A1:Z10000"
    ];

    try {
      const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ranges: sheetsToClear })
      });
      if (clearRes.status === 401) {
        const err = new Error('La sesión de Google Sheets ha expirado. Por favor conéctese nuevamente.');
        (err as any).status = 401;
        throw err;
      }
    } catch (e: any) {
      if (e.status === 401) throw e;
      console.warn(`Could not batch clear ranges before writing, attempting individual clear...`, e);
      // Fallback to individual clears if batchClear fails
      for (const sheet of ['Acciones Correctivas', 'Acciones de Mejora', 'Liberaciones Especiales', 'moc']) {
        try {
          await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`'${sheet}'!A1:Z10000`)}:clear`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            }
          });
        } catch (clearErr) {
          console.warn(`Could not clear range for ${sheet}`, clearErr);
        }
      }
    }

    // 6. Write the fresh datasets to respective ranges
    const updateBody = {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: `'Acciones Correctivas'!A1`,
          values: correctiveRows
        },
        {
          range: `'Acciones de Mejora'!A1`,
          values: improvementRows
        },
        {
          range: `'Liberaciones Especiales'!A1`,
          values: specialReleaseRows
        },
        {
          range: `'moc'!A1`,
          values: mocRows
        }
      ]
    };

    let writeRes: Response | null = null;
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateBody)
      });

      if (writeRes.ok) break;

      if (writeRes.status === 401) {
        const err = new Error('La sesión de Google Sheets ha expirado. Por favor conéctese nuevamente.');
        (err as any).status = 401;
        throw err;
      }

      if (writeRes.status === 503 || writeRes.status === 500 || writeRes.status === 502 || writeRes.status === 429) {
        console.warn(`[GoogleWorkspace] Transient write error (${writeRes.status}), retrying attempt ${attempts}/3...`);
        await new Promise(r => setTimeout(r, attempts * 1000));
        continue;
      }

      break;
    }

    if (!writeRes || !writeRes.ok) {
      const errText = writeRes ? await writeRes.text() : 'No response from Google Sheets';
      if (errText.includes('Unable to parse range')) {
        throw new Error(`La solapa no existe en la planilla actual. Por favor, intente de nuevo.`);
      }
      throw new Error(`Error al actualizar Google Sheets: ${errText}`);
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    const formatTime = format(new Date(), 'HH:mm:ss');
    
    updateSyncState({
      status: 'success',
      lastSyncTime: formatTime,
      error: null,
      spreadsheetUrl
    });

    isSyncing = false;
    return spreadsheetUrl;
  } catch (error: any) {
    isSyncing = false;
    const errorMessage = error.message || 'Error desconocido al sincronizar.';
    
    // Check if it's an authentication error
    const isAuthError = error.status === 401 || 
                        errorMessage.includes('401') || 
                        errorMessage.includes('invalid_grant') || 
                        errorMessage.includes('UNAUTHENTICATED') ||
                        errorMessage.includes('authentication credentials') ||
                        errorMessage.includes('token');

    if (isAuthError) {
      console.warn('La sesión de Google Sheets ha expirado o no cuenta con credenciales válidas:', errorMessage);
      setCachedToken(null);
      updateSyncState({ 
        status: 'disconnected', 
        error: 'Sincronización pausada: Por políticas de seguridad de Google, los permisos de escritura expiran después de 1 hora. Haz clic en "Vincular Google Sheets" para reactivar el enlace al instante.' 
      });
    } else {
      console.error('SGC Google Sheets sync error:', error);
      updateSyncState({ status: 'error', error: errorMessage });
    }
    
    throw error;
  }
}

/**
 * Automatically triggers the Sheets sync in the background if a token is cached or a service account is active.
 */
export function triggerAutoSync() {
  // 1. If backend sync is blocked/forbidden, fallback immediately to client token if available, otherwise skip silently
  if (isBackendSyncBlocked) {
    const token = getCachedToken();
    if (token) {
      if (syncTimeoutId) clearTimeout(syncTimeoutId);
      syncTimeoutId = setTimeout(() => {
        syncAllToGoogleSheets(token).catch(err => {
          console.warn('[GoogleWorkspace] Client-side auto sync fallback error:', err.message || err);
        });
      }, 5000);
    }
    return;
  }

  // 2. Enforce rate-limiting: minimum of 15 seconds between background triggers
  const now = Date.now();
  if (now - lastSyncTimestamp < 15000) {
    console.log('[GoogleWorkspace] Skipping background sync trigger to prevent rate limit (last sync was <15s ago).');
    return;
  }
  lastSyncTimestamp = now;

  fetchServerConfig().then(config => {
    if (config.hasServiceAccount) {
      if (syncTimeoutId) {
        clearTimeout(syncTimeoutId);
      }
      
      syncTimeoutId = setTimeout(() => {
        syncViaBackendService().catch(err => {
          console.warn("Auto Sync background warning (service account):", err.message || err);
        });
      }, 3000);
      return;
    }

    // Fallback: Token-based client-side sync
    const token = getCachedToken();
    if (!token) {
      updateSyncState({ status: 'disconnected' });
      return;
    }
    
    if (syncTimeoutId) {
      clearTimeout(syncTimeoutId);
    }
    
    syncTimeoutId = setTimeout(() => {
      syncAllToGoogleSheets(token).catch(err => {
        const errMsg = err.message || '';
        const isAuthError = err.status === 401 || 
                            errMsg.includes('401') || 
                            errMsg.includes('invalid_grant') || 
                            errMsg.includes('UNAUTHENTICATED') ||
                            errMsg.includes('authentication credentials') ||
                            errMsg.includes('token');
                            
        if (isAuthError) {
          console.warn("Auto Sync background authentication warning:", errMsg);
        } else {
          console.warn("Auto Sync background warning:", err.message || err);
        }
      });
    }, 3000); // Debounce for 3 seconds to avoid blocking/overlapping
  });
}

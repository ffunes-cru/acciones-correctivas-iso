import express from "express";
import path from "path";
import dotenv from 'dotenv';
import { google } from "googleapis";
import admin from 'firebase-admin';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import cron from 'node-cron';
import { format, startOfDay } from 'date-fns';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const serverDirname = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

let firebaseConfig: any = null;
try {
  // Using path.join with serverDirname statically so Vercel's bundler (@vercel/nft) 
  // successfully traces and bundles this file into the serverless function zip.
  const staticPath = path.join(serverDirname, "firebase-applet-config.json");
  if (fs.existsSync(staticPath)) {
    const configStr = fs.readFileSync(staticPath, 'utf8');
    firebaseConfig = JSON.parse(configStr);
    console.log(`[Server] Loaded firebase config from static path: ${staticPath}`);
  } else {
    const cwdPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(cwdPath)) {
      const configStr = fs.readFileSync(cwdPath, 'utf8');
      firebaseConfig = JSON.parse(configStr);
      console.log(`[Server] Loaded firebase config from process.cwd: ${cwdPath}`);
    } else {
      const parentPath = path.join(serverDirname, "..", "firebase-applet-config.json");
      if (fs.existsSync(parentPath)) {
        const configStr = fs.readFileSync(parentPath, 'utf8');
        firebaseConfig = JSON.parse(configStr);
        console.log(`[Server] Loaded firebase config from parent path: ${parentPath}`);
      }
    }
  }
} catch (err: any) {
  console.error("[Server Error] Failed to read firebase-applet-config.json:", err.message);
}

// Robust fallback to environment variables
if (!firebaseConfig) {
  console.warn("[Server Warning] firebase-applet-config.json not found. Checking environment variables...");
  if (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID) {
    firebaseConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
      appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
      apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
      firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "ai-studio-f7ed44b5-07a0-4614-b9f8-9ba007cb36e4",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      measurementId: process.env.FIREBASE_MEASUREMENT_ID || process.env.VITE_FIREBASE_MEASUREMENT_ID || ""
    };
    console.log("[Server] Loaded Firebase configuration from process environment variables.");
  }
}

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

    // Initialize Firebase Admin SDK on server
    let db: any;
    try {
      if (!firebaseConfig) {
        throw new Error('firebase-applet-config.json is missing or invalid');
      }
      
      if (admin.apps.length === 0) {
        admin.initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
      
      const databaseId = firebaseConfig.databaseId || firebaseConfig.firestoreDatabaseId;
      db = getFirestore(admin.apps[0]!, databaseId);
      console.log(`[Server] Firebase Admin SDK initialized. Project: ${firebaseConfig.projectId}, DB: ${databaseId}`);
      
      // Test connection (non-blocking in background, only if NOT on Vercel to avoid slow cold starts)
      if (!process.env.VERCEL) {
        db.doc('test/connection').get()
          .then(() => console.log(`[Server] Firestore connection verified via Admin SDK.`))
          .catch((testErr: any) => {
            if (testErr.message?.includes('PERMISSION_DENIED') || testErr.code === 7) {
              console.log(`[Server Info] Firebase Admin initialized in client-delegated mode.`);
            } else {
              console.warn('[Server Warning] Firestore connection test note:', testErr.message);
            }
          });
      }
    } catch (err: any) {
      console.error('[Server Critical] Failed to initialize Firebase Admin:', err.message);
    }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.use((req, res, next) => {
    // Vercel & proxy original URL / path restoration helper
    const originalPathHeader = req.headers['x-vercel-forwarded-path'] || req.headers['x-original-url'];
    const originalUrlHeader = req.headers['x-vercel-original-url'] || req.headers['x-forwarded-url'];

    if (originalPathHeader) {
      req.url = originalPathHeader as string;
    } else if (originalUrlHeader) {
      try {
        const urlStr = originalUrlHeader as string;
        if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
          const parsed = new URL(urlStr);
          req.url = parsed.pathname + parsed.search;
        } else {
          // It's a relative path containing target route info
          req.url = urlStr;
        }
      } catch (err) {
        console.error('[Vercel Express Helper] Failed to restore req.url from originalUrlHeader:', err);
      }
    }

    console.log(`[Server Request] Method: ${req.method} | URL: ${req.url} | OriginalURL: ${req.originalUrl}`);
    next();
  });

  // In-memory caches to prevent duplicate database lookups during a single cron run
  const userCache = new Map<string, string | null>();
  const stringUserCache = new Map<string, string>();
  const debugLogsToSave: any[] = [];

  const resolveEmailByString = async (recipient: string): Promise<string> => {
    if (!recipient) return '';
    if (recipient.includes('@')) return recipient.trim();
    
    const rLower = recipient.toLowerCase().trim();

    // 1. Reconstruct sanitized user IDs from imported sheets
    if (rLower.endsWith('_crucianelli_com')) {
      return rLower.replace(/_crucianelli_com$/, '@crucianelli.com');
    }
    if (rLower.endsWith('_fertecsa_com')) {
      return rLower.replace(/_fertecsa_com$/, '@fertecsa.com');
    }
    if (rLower.endsWith('_metallo_com')) {
      return rLower.replace(/_metallo_com$/, '@metallo.com');
    }
    if (rLower.endsWith('_leaf_com')) {
      return rLower.replace(/_leaf_com$/, '@leaf.com');
    }
    if (rLower.endsWith('_fabril_com')) {
      return rLower.replace(/_fabril_com$/, '@fabril.com');
    }

    // 2. Explicit fallback mappings for known displayNames / usernames
    if (rLower.includes('forniglia') || rLower === 'teo') {
      return 'tforniglia@crucianelli.com';
    }
    if (rLower.includes('monti') || rLower === 'sergio') {
      return 'smonti@fertecsa.com';
    }
    if (rLower.includes('santilli') || rLower === 'pedro') {
      return 'psantilli@crucianelli.com';
    }

    if (stringUserCache.has(recipient)) {
      return stringUserCache.get(recipient)!;
    }

    try {
      if (!db) return recipient;
      const usersRef = db.collection('users');
      
      // Try resolving as direct document ID (UID) first
      try {
        const docSnap = await usersRef.doc(recipient).get();
        if (docSnap.exists) {
          const uData = docSnap.data();
          let email = null;
          if (uData.email && uData.email.includes('@')) email = uData.email.trim();
          else if (uData.displayName && uData.displayName.includes('@')) email = uData.displayName.trim();
          if (email) {
            stringUserCache.set(recipient, email);
            return email;
          }
        }
      } catch (err: any) {
        // Safe to ignore if recipient is not a valid doc ID format
      }
      
      // Match displayName
      const snap1 = await usersRef.where('displayName', '==', recipient).get();
      if (!snap1.empty) {
        const uData = snap1.docs[0].data();
        let email = recipient;
        if (uData.email && uData.email.includes('@')) email = uData.email.trim();
        else if (uData.displayName && uData.displayName.includes('@')) email = uData.displayName.trim();
        stringUserCache.set(recipient, email);
        return email;
      }

      // Match email address directly (handles database cases where email field contains name)
      const snap2 = await usersRef.where('email', '==', recipient).get();
      if (!snap2.empty) {
        const uData = snap2.docs[0].data();
        let email = recipient;
        if (uData.displayName && uData.displayName.includes('@')) email = uData.displayName.trim();
        else if (uData.email && uData.email.includes('@')) email = uData.email.trim();
        stringUserCache.set(recipient, email);
        return email;
      }

      // Fallback: Case-insensitive scan
      const allUsersSnap = await usersRef.get();
      for (const uDoc of allUsersSnap.docs) {
        const uData = uDoc.data();
        const dispName = (uData.displayName || '').toLowerCase().trim();
        const emailVal = (uData.email || '').toLowerCase().trim();
        const searchVal = recipient.toLowerCase().trim();
        if (dispName === searchVal || emailVal === searchVal) {
          let email = recipient;
          if (uData.email && uData.email.includes('@')) email = uData.email.trim();
          else if (uData.displayName && uData.displayName.includes('@')) email = uData.displayName.trim();
          stringUserCache.set(recipient, email);
          return email;
        }
      }
    } catch (e: any) {
      console.error('[resolveEmailByString] Error resolving user by name:', e.message);
    }

    stringUserCache.set(recipient, recipient);
    return recipient;
  };

  const sendEmail = async (to: string, subject: string, body: string, htmlBody?: string, attachment?: { filename: string; content: string; type: string }) => {
    const webhookUrl = process.env.NOTIFIER_WEBHOOK_URL;
    
    let resolvedTo = to;
    if (to && !to.includes('@')) {
      resolvedTo = await resolveEmailByString(to);
    }
    
    // Ensure subject has "[SGC Crucianelli]" prefix to prevent spam filters from flagging it
    let formattedSubject = (subject || '').trim();
    if (formattedSubject && !formattedSubject.startsWith('[SGC Crucianelli]')) {
      formattedSubject = `[SGC Crucianelli] ${formattedSubject}`;
    }

    // Determine branding and generate HTML wrapper if htmlBody is not present
    let finalHtmlBody = htmlBody;
    if (!finalHtmlBody) {
      const isFertec = (subject + ' ' + body).toLowerCase().includes('fertec');
      const brandColor = isFertec ? '#1E3A8A' : '#C9252C';
      const companyName = isFertec ? 'Fertec S.A.' : 'Crucianelli S.A.';
      
      let formattedBody = body.replace(/\n/g, '<br/>');
      
      // Attempt to extract dynamic link/URL to render a button
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = body.match(urlRegex);
      let ctaButtonHtml = '';
      if (urls && urls.length > 0) {
        let cleanUrl = urls[0];
        if (cleanUrl.endsWith('.') || cleanUrl.endsWith(',') || cleanUrl.endsWith(')')) {
          cleanUrl = cleanUrl.slice(0, -1);
        }
        ctaButtonHtml = `
          <div style="text-align: center; margin: 24px 0;">
            <a href="${cleanUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${brandColor}; color: #FFFFFF; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center;">Acceder al Sistema SGC</a>
          </div>
        `;
        formattedBody = formattedBody.replace(cleanUrl, `<a href="${cleanUrl}" style="color: ${brandColor}; text-decoration: underline; font-weight: 500;">${cleanUrl}</a>`);
      }

      finalHtmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1F2937; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px;">
          <!-- Header -->
          <div style="background-color: ${brandColor}; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; color: #FFFFFF;">
            <h2 style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; opacity: 0.9;">Sistema de Gestión de la Calidad (SGC)</h2>
            <h1 style="margin: 6px 0 0 0; font-size: 18px; font-weight: 700;">Notificación del Sistema</h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.8;">SGC • ${companyName}</p>
          </div>

          <!-- Message Body -->
          <div style="padding: 24px; background-color: #FFFFFF; border-radius: 0 0 8px 8px; border-left: 1px solid #E5E7EB; border-right: 1px solid #E5E7EB; border-bottom: 1px solid #E5E7EB; font-size: 14px; line-height: 1.6; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="margin-bottom: 20px;">
              ${formattedBody}
            </div>
            ${ctaButtonHtml}
          </div>

          <!-- Footer -->
          <div style="margin-top: 20px; text-align: center; font-size: 11px; color: #9CA3AF;">
            Este es un correo automático generado por el SGC de ${companyName}.<br/>
            Por favor, no responda directamente a este remitente.
          </div>
        </div>
      `;
    }
    
    if (webhookUrl) {
      try {
        console.log(`[Email] Enviando vía Webhook a: ${resolvedTo} (Original: ${to}) (Subject: ${formattedSubject})`);
        
        const payload: any = { to: resolvedTo, subject: formattedSubject, body };
        if (finalHtmlBody) {
          payload.htmlBody = finalHtmlBody;
        }
        if (attachment) {
          payload.attachment = attachment;
        }

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'No error body');
          console.error(`[Email Error] Webhook devolvió estado ${response.status}. Body: ${errorText}`);
          return { success: false, error: `HTTP error! status: ${response.status}`, via: 'webhook' };
        }
        
        return { success: true, via: 'webhook' };
      } catch (err: any) {
        console.error("[Email Error] Error en Webhook:", err.message);
        return { success: false, error: err.message, via: 'webhook' };
      }
    }

    console.error(`[Email Error] No se ha configurado NOTIFIER_WEBHOOK_URL. No se puede enviar el correo a: ${resolvedTo}`);
    return { success: false, error: 'Falta configurar la variable NOTIFIER_WEBHOOK_URL (Google Apps Script Webhook) en las variables de entorno del servidor.', via: 'unconfigured' };
  };

  const logToFile = (msg: string) => {
    const logMsg = `[${new Date().toISOString()}] ${msg}\n`;
    try {
      const logPath = process.env.VERCEL ? path.join('/tmp', 'cron.log') : 'cron.log';
      fs.appendFileSync(logPath, logMsg);
    } catch (err: any) {
      // Ignorar de forma segura si el sistema de archivos es de solo lectura (Vercel)
      // Ajuste de compatibilidad para evitar el error 500 de Vercel en la escritura local de archivos
    }
    console.log(msg);
  };

  const resolveEmail = async (id: string, emailInField: string): Promise<string | null> => {
    if (emailInField && emailInField.includes('@')) return emailInField.trim();
    
    // Leverage the unified resolveEmailByString resolver
    if (id) {
      const resolved = await resolveEmailByString(id);
      if (resolved && resolved.includes('@')) return resolved;
    }
    if (emailInField) {
      const resolved = await resolveEmailByString(emailInField);
      if (resolved && resolved.includes('@')) return resolved;
    }

    if (!id) return null;
    
    if (userCache.has(id)) {
      return userCache.get(id)!;
    }
    
    // Fallback: Look up in users collection (if db is authorized)
    try {
      const uRef = db.collection('users').doc(id);
      const uSnap = await uRef.get();
      if (uSnap.exists) {
        const uData = uSnap.data();
        // Check both email and displayName since they might be swapped
        let email = null;
        if (uData.email && uData.email.includes('@')) email = uData.email;
        else if (uData.displayName && uData.displayName.includes('@')) email = uData.displayName;
        userCache.set(id, email);
        return email;
      }
    } catch (e: any) {
      console.error('[resolveEmail] Error looking up user by ID:', e.message);
    }
    
    // If still no email, check if the emailInField is actually a name we can search for? 
    // Usually irresponsible to do fuzzy search, but let's try a simple ID fallback if it looks like an email
    if (id && id.includes('_')) {
       // logic...
    }

    userCache.set(id, null);
    return null;
  };

  const getAppPublicUrl = () => {
    const publicUrl = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_URL;
    if (publicUrl) {
      return publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
    }
    if (process.env.VERCEL_URL) {
      const vUrl = process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`;
      return vUrl.endsWith('/') ? vUrl.slice(0, -1) : vUrl;
    }
    return '';
  };

  const buildItemLink = (itemType: string, findingOrCalendarId: string) => {
    const baseUrl = getAppPublicUrl();
    if (!baseUrl || !findingOrCalendarId) return '';
    if (itemType === 'finding') {
      return `${baseUrl}/findings/${findingOrCalendarId}#analysis`;
    }
    if (itemType === 'action') {
      return `${baseUrl}/findings/${findingOrCalendarId}#actions`;
    }
    if (itemType === 'iso_task') {
      return `${baseUrl}/iso-calendar/${findingOrCalendarId}`;
    }
    return `${baseUrl}/findings/${findingOrCalendarId}`;
  };

  const checkDeadlinesCached = async () => {
    logToFile('[Cron Cache] Iniciando verificación de vencimientos usando caché local offline...');
    const today = startOfDay(new Date());
    const dateKey = format(today, 'yyyy-MM-dd');

    // 1. Read caches
    let findings: any[] = [];
    let isoCalendars: any[] = [];
    let notificationHistory: any[] = [];

    try {
      if (fs.existsSync('./findings_cache.json')) {
        findings = JSON.parse(fs.readFileSync('./findings_cache.json', 'utf8'));
      }
      if (fs.existsSync('./iso_calendars_cache.json')) {
        isoCalendars = JSON.parse(fs.readFileSync('./iso_calendars_cache.json', 'utf8'));
      }
      if (fs.existsSync('./notification_history_cache.json')) {
        notificationHistory = JSON.parse(fs.readFileSync('./notification_history_cache.json', 'utf8'));
      }
    } catch (e: any) {
      logToFile(`[Cron Cache Error] No se pudo leer la caché local: ${e.message}`);
      return;
    }

    logToFile(`[Cron Cache] Leídos ${findings.length} hallazgos, ${isoCalendars.length} calendarios ISO, ${notificationHistory.length} registros de historial.`);

    const historyMap = new Map<string, any>(notificationHistory.map(h => [h.id, h]));

    // Helper to evaluate deadline offline
    const evaluateDeadlineCached = async (
      itemId: string,
      itemType: string,
      deadlineVal: any,
      recipientEmail: string,
      context: string,
      description: string,
      fNum: number,
      findingId: string
    ) => {
      if (!recipientEmail || !recipientEmail.includes('@')) {
        return;
      }

      // Parse deadline
      let deadline: Date;
      if (deadlineVal && typeof deadlineVal.seconds === 'number') {
        deadline = new Date(deadlineVal.seconds * 1000);
      } else if (deadlineVal) {
        deadline = new Date(deadlineVal);
      } else {
        return;
      }

      const target = startOfDay(deadline);
      const now = startOfDay(new Date());
      const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let milestone: string | null = null;
      let label: string = '';

      if (diff === 30 || (diff <= 30 && diff >= 28)) {
        milestone = 'pre_30';
        label = 'vence en 1 mes (30 días)';
      } else if (diff === 3) {
        milestone = 'pre_3';
        label = 'vence en 3 días';
      } else if (diff === 0) {
        milestone = 'day_of';
        label = 'vence HOY';
      } else if (diff < 0) {
        const overdueDays = Math.abs(diff);

        // Catch-up milestone if no notifications exist at all for this item
        if (overdueDays >= 1 && overdueDays <= 6) {
          const hasAnyHistory = notificationHistory.some(h => h.itemId === itemId);
          if (!hasAnyHistory) {
            milestone = 'overdue_initial';
            label = `se encuentra VENCIDO hace ${overdueDays} ${overdueDays === 1 ? 'día' : 'días'}`;
          }
        }

        // Weekly reminder
        if (overdueDays > 0 && overdueDays % 7 === 0) {
          const weeks = overdueDays / 7;
          milestone = `overdue_week_${weeks}`;
          label = `se encuentra VENCIDO hace ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
        }
      }

      if (milestone) {
        const historyId = `${itemId}_${milestone}`;
        if (historyMap.has(historyId)) {
          logToFile(`[Cron Cache Skipped] Milestone ${milestone} ya enviado para ${itemId}.`);
          return;
        }

        logToFile(`[Cron Cache Milestone] Enviando mail: ${milestone} para ${itemType} ${itemId} (${recipientEmail})`);
        const subject = `[RECORDATORIO] ${context} ${label}`;
        const itemLink = buildItemLink(itemType, findingId);
        const linkText = itemLink ? `\n\nPuede acceder al registro aquí:\n${itemLink}` : '';

        const body = `Estimado responsable,

Este es un recordatorio automático del sistema de gestión de calidad.

${context} ${label}.
Descripción: ${description}
Fecha límite: ${format(deadline, 'dd/MM/yyyy')}${linkText}

Por favor, ingrese al sistema para completar la tarea.

Atentamente,
SGC Crucianelli`;

        const result = await sendEmail(recipientEmail, subject, body);

        if (result && result.success) {
          const newHistory = {
            id: historyId,
            itemId,
            itemType,
            milestone,
            dateKey,
            sentAt: new Date().toISOString(),
            status: 'sent',
            isOfflineGenerated: true // Mark as offline generated so client can sync it back!
          };
          notificationHistory.push(newHistory);
          historyMap.set(historyId, newHistory);

          // Save back to notification_history_cache.json
          try {
            fs.writeFileSync('./notification_history_cache.json', JSON.stringify(notificationHistory, null, 2), 'utf8');
            logToFile(`[Cron Cache History] Guardado historial para ${historyId}`);
          } catch (writeErr: any) {
            logToFile(`[Cron Cache Error] No se pudo escribir historial cache: ${writeErr.message}`);
          }
        } else {
          logToFile(`[Cron Cache Error] Falló el envío de mail para ${itemId}: ${result.error}`);
        }
      }
    };

    // 2. Process findings
    for (const item of findings) {
      const f = item.finding;
      if (!f) continue;
      const status = f.status;
      const isPending = status === 'pending_analysis' || status === 'Análisis Pendiente' || status === 'Pendiente de Análisis';

      if (isPending && f.analysisDeadline) {
        const email = f.analysisResponsibleEmail || f.ownerEmail || '';
        await evaluateDeadlineCached(
          f.id,
          'finding',
          f.analysisDeadline,
          email,
          `Investigación pendiente #${f.findingNumber}`,
          f.description,
          f.findingNumber,
          f.id
        );
      }

      // Process corrective actions
      if (item.correctiveActions) {
        for (const action of item.correctiveActions) {
          const actStatus = action.status;
          const isActPending = actStatus === 'pending' || actStatus === 'Pendiente';

          if (isActPending && action.deadline) {
            const email = action.responsibleEmail || '';
            const isImprovement = f.findingCategory === 'improvement' || f.type === 'Mejora';
            const contextTitle = isImprovement 
              ? `Acción de mejora pendiente (Mejora #${f.findingNumber})` 
              : `Acción correctiva pendiente (Hallazgo #${f.findingNumber})`;

            await evaluateDeadlineCached(
              action.id,
              'action',
              action.deadline,
              email,
              contextTitle,
              action.description,
              f.findingNumber,
              f.id
            );
          }
        }
      }
    }

    // 3. Process ISO Calendars and Tasks
    for (const cal of isoCalendars) {
      if (cal.tasks) {
        for (const task of cal.tasks) {
          const isTaskPending = task.status !== 'Finalizada' && task.status !== 'Finalizado';
          if (isTaskPending && task.deadline) {
            const email = task.responsibleEmail || '';
            await evaluateDeadlineCached(
              task.id,
              'iso_task',
              task.deadline,
              email,
              `Tarea ISO pendiente: ${task.name}`,
              `Calendario: ${cal.name}\nFrecuencia: ${task.frequency}\nComentarios: ${task.comments || 'Ninguno'}`,
              0,
              cal.id
            );
          }
        }
      }
    }

    logToFile('[Cron Cache] Verificación de vencimientos offline finalizada.');
  };

  const checkDeadlines = async () => {
    if (!db) {
      logToFile('[Cron] Error: El motor de base de datos no está inicializado. Intentando verificación offline...');
      await checkDeadlinesCached();
      return;
    }

    // Check if server actually has access to Firestore before attempting query
    try {
      await db.doc('test/connection').get();
    } catch (err: any) {
      logToFile(`[Cron] El servidor no puede acceder a Firestore directamente (${err.message || err}). Iniciando verificación offline usando caché local...`);
      await checkDeadlinesCached();
      return;
    }

    logToFile('[Cron] Verificando vencimientos (Modo Altamente Optimizado)...');
    const today = startOfDay(new Date());
    const dateKey = format(today, 'yyyy-MM-dd');

    // Reset caches and logs array for this run
    userCache.clear();
    stringUserCache.clear();
    debugLogsToSave.length = 0;

    try {
      // 1. Findings
      logToFile('[Cron] Obteniendo hallazgos...');
      let findingsSnap;
      try {
        findingsSnap = await db.collection('findings').get();
      } catch (e: any) {
        logToFile(`[Cron Error] Falló db.collection('findings').get(): ${e.message}`);
        throw e;
      }
      
      logToFile(`[Cron] Encontrados ${findingsSnap.docs.length} hallazgos totales.`);
      const findingsMap = new Map<string, any>(findingsSnap.docs.map((doc: any) => [doc.id, doc.data()]));
      
      const findingsToProcess = findingsSnap.docs.filter((d: any) => {
        const s = d.data().status;
        return s === 'pending_analysis' || s === 'Análisis Pendiente' || s === 'Pendiente de Análisis';
      });

      logToFile(`[Cron] Procesando ${findingsToProcess.length} hallazgos con análisis pendientes...`);
      for (const fDoc of findingsToProcess) {
        const data = fDoc.data();
        if (data.analysisDeadline) {
          const deadline = (data.analysisDeadline && typeof data.analysisDeadline.toDate === 'function') ? data.analysisDeadline.toDate() : new Date(data.analysisDeadline);
          const email = await resolveEmail(data.analysisResponsibleId || data.ownerId, data.analysisResponsibleEmail || data.ownerEmail);
          await evaluateDeadline(fDoc.id, 'finding', deadline, email || '', `Investigación pendiente #${data.findingNumber}`, data.description, data.findingNumber, dateKey, fDoc.id);
        }
      }

      // 2. Actions (Optimized via parallel subcollection queries to avoid collectionGroup index & security rule issues!)
      logToFile('[Cron] Obteniendo acciones correctivas de todos los hallazgos en paralelo...');
      let allActionsDocs: any[] = [];
      try {
        const actionsPromises = findingsSnap.docs.map(async (fDoc: any) => {
          try {
            const actionsColRef = db.collection('findings').doc(fDoc.id).collection('correctiveActions');
            const actionsSnap = await actionsColRef.get();
            return actionsSnap.docs;
          } catch (err: any) {
            logToFile(`[Cron Warning] No se pudieron obtener acciones para hallazgo ${fDoc.id}: ${err.message}`);
            return [];
          }
        });
        const actionsResults = await Promise.all(actionsPromises);
        allActionsDocs = actionsResults.flat();
      } catch (e: any) {
        logToFile(`[Cron Error] Falló la obtención paralela de acciones: ${e.message}`);
        throw e;
      }

      const actionsToProcess = allActionsDocs.filter(d => {
        const s = d.data().status;
        return s === 'pending' || s === 'Pendiente';
      });

      logToFile(`[Cron] Encontradas ${actionsToProcess.length} acciones correctivas pendientes totales.`);
      
      let actionCount = 0;
      for (const aDoc of actionsToProcess) {
        const data = aDoc.data();
        // Find the parent finding from the document path
        // path is: findings/{findingId}/correctiveActions/{actionId}
        const fId = aDoc.ref.parent.parent?.id;
        if (!fId) {
          logToFile(`[Cron Warning] No se pudo encontrar el ID del hallazgo padre para la acción correctiva: ${aDoc.id}`);
          continue;
        }

        const parentFinding = findingsMap.get(fId);
        const fNum = parentFinding?.findingNumber || 0;
        const isImprovement = parentFinding?.findingCategory === 'improvement' || parentFinding?.type === 'Mejora';

        if (data.deadline) {
          actionCount++;
          const deadline = (data.deadline && typeof data.deadline.toDate === 'function') ? data.deadline.toDate() : new Date(data.deadline);
          const email = await resolveEmail(data.responsibleId, data.responsibleEmail);
          
          const contextTitle = isImprovement 
            ? `Acción de mejora pendiente (Mejora #${fNum})` 
            : `Acción correctiva pendiente (Hallazgo #${fNum})`;

          await evaluateDeadline(aDoc.id, 'action', deadline, email || '', contextTitle, data.description, fNum, dateKey, fId);
        }
      }
      logToFile(`[Cron] Procesadas ${actionCount} acciones pendientes totales.`);

      // 2.5. ISO Tasks checking
      try {
        logToFile('[Cron] Obteniendo calendarios ISO...');
        const calendarsSnap = await db.collection('iso_calendars').get();
        logToFile(`[Cron] Encontrados ${calendarsSnap.docs.length} calendarios ISO.`);

        let isoTaskCount = 0;
        for (const calDoc of calendarsSnap.docs) {
          const calData = calDoc.data();
          const calTasksSnap = await db.collection('iso_calendars').doc(calDoc.id).collection('tasks').get();
          const pendingTasks = calTasksSnap.docs.filter((d: any) => d.data().status !== 'Finalizada');

          for (const tDoc of pendingTasks) {
            const task = tDoc.data();
            if (task.deadline) {
              isoTaskCount++;
              const deadline = (task.deadline && typeof task.deadline.toDate === 'function') 
                ? task.deadline.toDate() 
                : new Date(task.deadline);
              const email = task.responsibleEmail;
              if (email) {
                await evaluateDeadline(
                  tDoc.id, 
                  'iso_task', 
                  deadline, 
                  email, 
                  `Tarea ISO pendiente: ${task.name}`, 
                  `Calendario: ${calData.name}\nFrecuencia: ${task.frequency}\nComentarios: ${task.comments || 'Ninguno'}`, 
                  0, 
                  dateKey, 
                  calDoc.id
                );
              }
            }
          }
        }
        logToFile(`[Cron] Procesadas ${isoTaskCount} tareas ISO pendientes.`);
      } catch (isoErr: any) {
        logToFile(`[Cron Error] Error procesando calendarios ISO: ${isoErr.message}`);
      }

      // 3. Parallel Batch Debug Log Writing
      if (debugLogsToSave.length > 0) {
        logToFile(`[Cron] Guardando ${debugLogsToSave.length} registros de depuración en paralelo...`);
        // We write them in chunks of 10 to avoid hitting rate limits or crashing
        const chunkArray = <T>(arr: T[], size: number): T[][] => {
          const chunked: T[][] = [];
          for (let i = 0; i < arr.length; i += size) {
            chunked.push(arr.slice(i, i + size));
          }
          return chunked;
        };
        const chunks = chunkArray(debugLogsToSave, 10);
        for (const chunk of chunks) {
          await Promise.all(chunk.map(log => 
            db.collection('cron_debug').add({
              ...log,
              checkedAt: FieldValue.serverTimestamp()
            }).catch((e: any) => console.error('[Cron Error] No se pudo guardar registro debug:', e.message))
          ));
        }
        logToFile(`[Cron] Registros de depuración guardados.`);
      }

      logToFile('[Cron] Verificación completada.');
    } catch (err: any) {
      logToFile(`[Cron Error] Error fatal en checkDeadlines: ${err.message}`);
    }
  };

  const evaluateDeadline = async (itemId: string, itemType: string, deadline: Date, recipientEmail: string, context: string, description: string, fNum: number, dateKey: string, findingId: string) => {
    if (!recipientEmail || !recipientEmail.includes('@')) {
      if (recipientEmail) logToFile(`[DeadlineCheck] Saltando envío para #${fNum}: Email inválido (${recipientEmail})`);
      return;
    }

    const target = startOfDay(deadline);
    const now = startOfDay(new Date());
    
    const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    // logToFile(`[DeadlineCheck] Item: ${fNum} (${itemType}) | Target: ${format(target, 'yyyy-MM-dd')} | Now: ${format(now, 'yyyy-MM-dd')} | Diff: ${diff}`);

    let milestone: string | null = null;
    let label: string = '';

    if (diff === 30 || (diff <= 30 && diff >= 28)) {
      milestone = 'pre_30';
      label = 'vence en 1 mes (30 días)';
    } else if (diff === 3) {
      milestone = 'pre_3';
      label = 'vence en 3 días';
    } else if (diff === 0) {
      milestone = 'day_of';
      label = 'vence HOY';
    } else if (diff < 0) {
      const overdueDays = Math.abs(diff);
      
      // NEW: Catch items that just became overdue but haven't been notified yet (catch-up)
      // Check if day_of was missed, and treat first overdue day as high priority
      if (overdueDays >= 1 && overdueDays <= 6) {
         // Only trigger this special "catch-up" if no notifications exist at all for this item
         const histSnap = await db.collection('notificationHistory').where('itemId', '==', itemId).get();
         if (histSnap.empty) {
           milestone = 'overdue_initial';
           label = `se encuentra VENCIDO hace ${overdueDays} ${overdueDays === 1 ? 'día' : 'días'}`;
         }
      }

      // regular weekly reminder
      if (overdueDays > 0 && overdueDays % 7 === 0) {
        const weeks = overdueDays / 7;
        milestone = `overdue_week_${weeks}`;
        label = `se encuentra VENCIDO hace ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
      }
    }

    // debug log
    debugLogsToSave.push({
      itemId,
      itemType,
      fNum,
      target: format(target, 'yyyy-MM-dd'),
      now: format(now, 'yyyy-MM-dd'),
      diff,
      milestoneFound: milestone || 'none'
    });

    if (milestone) {
      const historyId = `${itemId}_${milestone}`;
      const historyRef = db.collection('notificationHistory').doc(historyId);
      const historySnap = await historyRef.get();

      if (historySnap.exists) {
        logToFile(`[NotificationSkipped] Milestone ${milestone} ya fue enviado anteriormente para este item (${itemId}).`);
        return;
      }

      logToFile(`[MilestoneReached] Preparando envío: ${milestone} para Hallazgo #${fNum} (${itemType}) - Email: ${recipientEmail}`);
      const subject = `[RECORDATORIO] ${context} ${label}`;
      const itemLink = buildItemLink(itemType, findingId);
      const linkText = itemLink ? `\n\nPuede acceder al registro aquí:\n${itemLink}` : '';

      const body = `Estimado responsable,
          
Este es un recordatorio automático del sistema de gestión de calidad.
          
${context} ${label}.
Descripción: ${description}
Fecha límite: ${format(deadline, 'dd/MM/yyyy')}${linkText}

Por favor, ingrese al sistema para completar la tarea.

Atentamente,
SGC Crucianelli`;

      const result = await sendEmail(recipientEmail, subject, body);
      
      await db.collection('notifications').add({
        to: recipientEmail,
        subject,
        body,
        type: 'Recordatorio',
        milestone,
        itemId,
        itemType,
        findingId,
        status: result.success ? 'sent' : 'failed',
        error: result.error || null,
        via: result.via,
        createdAt: FieldValue.serverTimestamp()
      });

      if (result && result.success) {
        await historyRef.set({
          itemId,
          itemType,
          milestone,
          dateKey,
          sentAt: FieldValue.serverTimestamp(),
          status: 'sent'
        });
        logToFile(`[NotificationSent] Milestone ${milestone} registrado exitosamente para ${recipientEmail}`);
      } else {
        logToFile(`[NotificationFailed] Error enviando mail: ${result.error}`);
      }
    }
  };

  // Only schedule background crons and timeouts if we are NOT on Vercel
  if (!process.env.VERCEL) {
    // Cron schedule: Daily at 03:00 AM
    cron.schedule('0 3 * * *', () => {
      checkDeadlines();
    });

    // Also run 30 seconds after startup
    setTimeout(checkDeadlines, 30000);
  }

  // Helper to obtain a Google Service Account Authenticated client
  const getGoogleAuthClient = () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    const isConfigured = !!(
      email &&
      privateKey &&
      email.trim() !== '' &&
      email !== 'undefined' &&
      !email.includes('PLACEHOLDER') &&
      !email.startsWith('<') &&
      privateKey.trim() !== '' &&
      privateKey !== 'undefined' &&
      !privateKey.includes('PLACEHOLDER') &&
      !privateKey.startsWith('<')
    );

    if (!isConfigured) {
      return null;
    }

    try {
      return new google.auth.JWT({
        email,
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive'
        ]
      });
    } catch (err: any) {
      console.error('[Server Error] Failed to create Google Service Account Auth:', err.message);
      return null;
    }
  };

  // API endpoint to retrieve sheets synchronization configuration
  app.get("/api/sheets/config", (req: any, res: any) => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    const hasServiceAccount = !!(
      email &&
      privateKey &&
      email.trim() !== '' &&
      email !== 'undefined' &&
      !email.includes('PLACEHOLDER') &&
      !email.startsWith('<') &&
      privateKey.trim() !== '' &&
      privateKey !== 'undefined' &&
      !privateKey.includes('PLACEHOLDER') &&
      !privateKey.startsWith('<')
    );

    res.json({
      hasServiceAccount,
      serviceAccountEmail: hasServiceAccount ? email : null
    });
  });

  // API endpoint to synchronize everything using Google Service Account (Never expires!)
  app.post("/api/sheets/sync", async (req: any, res: any) => {
    const { userEmail } = req.body;
    const authClient = getGoogleAuthClient();

    if (!authClient) {
      return res.status(400).json({
        success: false,
        error: 'Service Account not configured',
        message: 'La Cuenta de Servicio de Google no está configurada en las variables de entorno del servidor. Por favor, agregue GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.'
      });
    }

    try {
      const sheets = google.sheets({ version: 'v4', auth: authClient });
      const drive = google.drive({ version: 'v3', auth: authClient });

      if (!db) {
        throw new Error('Base de datos no inicializada.');
      }

      let fullData = req.body.fullData;
      let specialReleases = req.body.specialReleases;
      let changeRequests = req.body.changeRequests;

      // Smart cache writing for offline-first background check processing
      if (req.body.fullData) {
        try {
          fs.writeFileSync('./findings_cache.json', JSON.stringify(req.body.fullData, null, 2), 'utf8');
          console.log(`[Cache] Successfully cached ${req.body.fullData.length} findings.`);
        } catch (err: any) {
          console.error('[Cache Error] Failed to write findings cache:', err.message);
        }
      }

      if (req.body.specialReleases) {
        try {
          fs.writeFileSync('./special_releases_cache.json', JSON.stringify(req.body.specialReleases, null, 2), 'utf8');
          console.log(`[Cache] Successfully cached ${req.body.specialReleases.length} special releases.`);
        } catch (err: any) {
          console.error('[Cache Error] Failed to write special releases cache:', err.message);
        }
      }

      if (req.body.changeRequests) {
        try {
          fs.writeFileSync('./change_requests_cache.json', JSON.stringify(req.body.changeRequests, null, 2), 'utf8');
          console.log(`[Cache] Successfully cached ${req.body.changeRequests.length} change requests.`);
        } catch (err: any) {
          console.error('[Cache Error] Failed to write change requests cache:', err.message);
        }
      }

      if (req.body.isoCalendars) {
        try {
          fs.writeFileSync('./iso_calendars_cache.json', JSON.stringify(req.body.isoCalendars, null, 2), 'utf8');
          console.log(`[Cache] Successfully cached ${req.body.isoCalendars.length} ISO calendars.`);
        } catch (err: any) {
          console.error('[Cache Error] Failed to write ISO calendars cache:', err.message);
        }
      }

      if (req.body.notificationHistory) {
        try {
          let mergedHistory = [...req.body.notificationHistory];
          if (fs.existsSync('./notification_history_cache.json')) {
            try {
              const oldHistory = JSON.parse(fs.readFileSync('./notification_history_cache.json', 'utf8'));
              if (Array.isArray(oldHistory)) {
                const offlineGenerated = oldHistory.filter((h: any) => h.isOfflineGenerated === true);
                const clientIds = new Set(mergedHistory.map((h: any) => h.id));
                for (const off of offlineGenerated) {
                  if (!clientIds.has(off.id)) {
                    mergedHistory.push(off);
                  }
                }
              }
            } catch (parseErr) {}
          }
          fs.writeFileSync('./notification_history_cache.json', JSON.stringify(mergedHistory, null, 2), 'utf8');
          console.log(`[Cache] Successfully cached ${mergedHistory.length} history records (merged).`);
        } catch (err: any) {
          console.error('[Cache Error] Failed to write history cache:', err.message);
        }
      }

      if (!specialReleases && db) {
        try {
          const snap = await db.collection('special_releases').get();
          specialReleases = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
          specialReleases.sort((a: any, b: any) => (a.releaseNumber || 0) - (b.releaseNumber || 0));
        } catch (err: any) {
          console.error('[Backend Sheets Sync] Error retrieving special_releases from Firestore:', err.message);
          specialReleases = [];
        }
      }

      if (!changeRequests && db) {
        try {
          const snap = await db.collection('change_requests').get();
          changeRequests = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
          changeRequests.sort((a: any, b: any) => (a.changeNumber || 0) - (b.changeNumber || 0));
        } catch (err: any) {
          console.error('[Backend Sheets Sync] Error retrieving change_requests from Firestore:', err.message);
          changeRequests = [];
        }
      }

      if (!fullData) {
        // 0. Verify Firestore read permission before querying
        try {
          await db.doc('test/connection').get();
        } catch (err: any) {
          console.warn('[Backend Sheets Sync] Server cannot read from Firestore:', err.message || err);
          return res.status(403).json({
            success: false,
            error: 'server_permission_denied',
            message: `El servidor no tiene permisos directos para leer de Firestore (Error: ${err.message || err}). Se requiere sincronización del lado del cliente.`
          });
        }

        // 1. Fetch all findings from Firestore
        const findingsSnap = await db.collection('findings').get();
        const allFindings = findingsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as any));

        // Sort by findingNumber ascending
        allFindings.sort((a, b) => (a.findingNumber || 0) - (b.findingNumber || 0));

        // 2. Query analyses and corrective actions for each finding in parallel with individual error resilience
        fullData = await Promise.all(
          allFindings.map(async (finding) => {
            try {
              // Fetch cause analysis
              const analysisDoc = await db.collection('findings').doc(finding.id).collection('analysis').doc('current').get();
              const analysis = analysisDoc.exists ? analysisDoc.data() : null;

              // Fetch corrective actions
              const actionsSnap = await db.collection('findings').doc(finding.id).collection('correctiveActions').get();
              const correctiveActions = actionsSnap.docs.map(
                (doc: any) => ({ id: doc.id, ...doc.data() } as any)
              );

              return { finding, analysis, correctiveActions };
            } catch (err) {
              console.error(`[Backend Sheets Sync] Error fetching subcollections for finding ${finding.id}:`, err);
              return { finding, analysis: null, correctiveActions: [] };
            }
          })
        );
      }

      // Helper to format timestamps or generic dates safely
      const formatFirebaseDate = (val: any): string => {
        if (!val) return '';
        try {
          if (val instanceof Timestamp) {
            return format(val.toDate(), 'dd/MM/yyyy');
          }
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
        'Responsable',
        'Fecha Requerida',
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
        const a = item.analysis as any;
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
              '', // Responsable
              '', // Fecha Requerida
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

      if (Array.isArray(specialReleases)) {
        for (const sr of specialReleases) {
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

      if (Array.isArray(changeRequests)) {
        for (const cr of changeRequests) {
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
      }

      // 4. Locate or Create the spreadsheet in Google Drive
      let spreadsheetId = '';
      const spreadsheetTitle = 'SGC - Historial Completo de Hallazgos y Acciones';

      try {
        const q = `name = '${spreadsheetTitle}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
        const searchRes = await drive.files.list({
          q,
          fields: 'files(id,name)'
        });

        if (searchRes.data.files && searchRes.data.files.length > 0) {
          spreadsheetId = searchRes.data.files[0].id!;
        }
      } catch (e) {
        console.error('Error searching for spreadsheet on backend:', e);
      }

      if (!spreadsheetId) {
        // Create a new spreadsheet owned by the service account
        const created = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: spreadsheetTitle },
            sheets: [
              { properties: { title: 'Acciones Correctivas' } },
              { properties: { title: 'Acciones de Mejora' } },
              { properties: { title: 'Liberaciones Especiales' } },
              { properties: { title: 'moc' } }
            ]
          }
        });
        spreadsheetId = created.data.spreadsheetId!;
      } else {
        // Ensure all tabs exist
        try {
          const getRes = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties.title'
          });
          const existingTitles = getRes.data.sheets?.map(s => s.properties?.title || '') || [];
          const existingTitlesNormalized = existingTitles.map(t => t.trim().toLowerCase());
          
          const addRequests: any[] = [];
          if (!existingTitlesNormalized.includes('acciones correctivas')) {
            addRequests.push({ addSheet: { properties: { title: 'Acciones Correctivas' } } });
          }
          if (!existingTitlesNormalized.includes('acciones de mejora')) {
            addRequests.push({ addSheet: { properties: { title: 'Acciones de Mejora' } } });
          }
          if (!existingTitlesNormalized.includes('liberaciones especiales')) {
            addRequests.push({ addSheet: { properties: { title: 'Liberaciones Especiales' } } });
          }
          if (!existingTitlesNormalized.includes('moc')) {
            addRequests.push({ addSheet: { properties: { title: 'moc' } } });
          }
          
          for (const req of addRequests) {
            try {
              await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests: [req] }
              });
            } catch (err: any) {
              const errMsg = err.message || '';
              if (errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('ya existe')) {
                console.log(`[Sheets Sync] Sheet "${req.addSheet.properties.title}" already exists, skipping addition.`);
              } else {
                throw err;
              }
            }
          }
        } catch (e) {
          console.warn('Error ensuring tabs exist on backend:', e);
        }
      }

      // Helper for exponential backoff on transient Google API errors (503, 500, 429)
      const executeWithRetry = async <T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> => {
        let lastErr: any;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await fn();
          } catch (err: any) {
            lastErr = err;
            const status = err?.status || err?.code || err?.response?.status;
            const msg = err?.message || err?.toString() || '';
            const isTransient = status === 503 || status === 500 || status === 502 || status === 504 || status === 429 || msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('rate limit');
            if (attempt < maxRetries && isTransient) {
              const delay = initialDelay * Math.pow(2, attempt - 1);
              console.warn(`[Google Sheets Backend] Transient error (${status || msg}), retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`);
              await new Promise(r => setTimeout(r, delay));
            } else {
              throw err;
            }
          }
        }
        throw lastErr;
      };

      // 5. Clear previous spreadsheet data entirely using batchClear with properly quoted ranges
      try {
        await executeWithRetry(async () => {
          await sheets.spreadsheets.values.batchClear({
            spreadsheetId,
            requestBody: {
              ranges: [
                "'Acciones Correctivas'!A1:Z10000",
                "'Acciones de Mejora'!A1:Z10000",
                "'Liberaciones Especiales'!A1:Z10000",
                "'moc'!A1:Z10000"
              ]
            }
          });
        });
      } catch (e) {
        console.warn('Could not batch clear ranges on backend, attempting individual clear fallback...', e);
        for (const sheet of ['Acciones Correctivas', 'Acciones de Mejora', 'Liberaciones Especiales', 'moc']) {
          try {
            await sheets.spreadsheets.values.clear({
              spreadsheetId,
              range: `'${sheet}'!A1:Z10000`
            });
          } catch (clearErr) {
            console.warn(`Could not clear range for ${sheet} on backend`, clearErr);
          }
        }
      }

      // 6. Write the fresh datasets
      await executeWithRetry(async () => {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
              { range: "'Acciones Correctivas'!A1", values: correctiveRows },
              { range: "'Acciones de Mejora'!A1", values: improvementRows },
              { range: "'Liberaciones Especiales'!A1", values: specialReleaseRows },
              { range: "'moc'!A1", values: mocRows }
            ]
          }
        });
      });

      // 7. Grant access/sharing permissions
      // Retrieve the triggering user's role to determine editing permissions
      let userRole = req.body.userRole || 'user';
      if (!req.body.userRole && userEmail) {
        try {
          const usersRef = db.collection('users');
          const querySnap = await usersRef.where('email', '==', userEmail).get();
          if (!querySnap.empty) {
            const userDoc = querySnap.docs[0];
            const userData = userDoc.data();
            userRole = userData.role || 'user';
          }
        } catch (roleErr: any) {
          console.warn('[Backend Sheets Sync] Database role lookup bypassed/failed (using fallback reader role):', roleErr.message);
        }
      }

      // Share as reader to anyone with link so it is read-only (not editable) for the general team
      try {
        await drive.permissions.create({
          fileId: spreadsheetId,
          requestBody: {
            type: 'anyone',
            role: 'reader'
          }
        });
      } catch (permErr: any) {
        console.error('Error sharing spreadsheet to anyone on backend:', permErr.message);
      }

      // Specifically invite the user's email if they are signed in, so they get an explicit invitation / in Drive list
      // Option B: We pass `sendNotificationEmail: false` to silence the email notification.
      // We also restrict editing (writer) only to Admin users.
      if (userEmail && userEmail.includes('@')) {
        try {
          const roleToGrant = userRole === 'admin' ? 'writer' : 'reader';
          await drive.permissions.create({
            fileId: spreadsheetId,
            sendNotificationEmail: false,
            requestBody: {
              type: 'user',
              role: roleToGrant,
              emailAddress: userEmail
            }
          });
          console.log(`[Backend Sheets Sync] Shared spreadsheet directly with user email: ${userEmail} as ${roleToGrant} (silently)`);
        } catch (userPermErr: any) {
          console.warn(`Could not share specifically with user ${userEmail}:`, userPermErr.message);
        }
      }

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      const formatTime = format(new Date(), 'HH:mm:ss');

      // Extract offline generated histories
      let offlineHistories: any[] = [];
      try {
        if (fs.existsSync('./notification_history_cache.json')) {
          const history = JSON.parse(fs.readFileSync('./notification_history_cache.json', 'utf8'));
          if (Array.isArray(history)) {
            offlineHistories = history.filter((h: any) => h.isOfflineGenerated === true);
          }
        }
      } catch (err: any) {
        console.error('[Backend Sheets Sync] Error reading offline histories:', err.message);
      }

      res.json({
        success: true,
        spreadsheetUrl,
        lastSyncTime: formatTime,
        offlineHistories
      });

    } catch (error: any) {
      console.error('[Backend Sheets Sync Error]', error);
      res.status(500).json({
        success: false,
        error: error.message || String(error)
      });
    }
  });

  // API routes FIRST
  const healthHandler = (req: any, res: any) => {
    res.json({ 
      status: "ok", 
      firebase: !!db,
      notifications: {
        appsScript: !!process.env.NOTIFIER_WEBHOOK_URL
      }
    });
  };
  app.get("/api/health", healthHandler);
  app.get("/health", healthHandler);

  // API Route for notifications (used by client-side if needed)
  const notifyHandler = async (req: any, res: any) => {
    const { to, subject, body, htmlBody, attachment } = req.body;
    const result = await sendEmail(to, subject, body, htmlBody, attachment);
    res.json(result);
  };
  app.post("/api/notify", notifyHandler);
  app.post("/notify", notifyHandler);

  // Manual trigger endpoint
  const cronHandler = async (req: any, res: any) => {
    try {
      console.log('[Cron API] Starting manual check...');
      await checkDeadlines();
      res.json({ 
        status: "Check triggered successfully",
        dbInitialized: !!db
      });
    } catch (error: any) {
      console.error('[Cron API Error]', error);
      res.status(500).json({ 
        status: "error",
        error: error.message || String(error), 
        stack: error.stack || null,
        dbInitialized: !!db 
      });
    }
  };
  app.get("/api/cron/check", cronHandler);
  app.get("/cron/check", cronHandler);

  app.get("/api/debug-user", async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: "DB not initialized" });
      const snap = await db.collection('users').get();
      const uList = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      res.json({ users: uList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware
  const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
  if (!process.env.VERCEL && (process.env.NODE_ENV !== "production" || !fs.existsSync(distIndexPath))) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.VERCEL) {
    return app;
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  return app;
}

export { startServer };

if (!process.env.VERCEL) {
  startServer().catch(err => {
    console.error("[Server Error] Failed to start:", err);
  });
}

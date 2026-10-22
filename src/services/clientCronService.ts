import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sendNotification, generateFindingLink, generateCalendarLink } from './notificationService';
import { format, startOfDay } from 'date-fns';

// Cache for users to minimize reads
const userEmailCache = new Map<string, string | null>();

async function resolveUserEmail(userId: string, defaultEmail?: string): Promise<string | null> {
  if (defaultEmail && defaultEmail.includes('@')) return defaultEmail.trim();
  if (!userId) return null;

  if (userEmailCache.has(userId)) {
    return userEmailCache.get(userId)!;
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (userDoc.exists()) {
      const data = userDoc.data();
      let email: string | null = null;
      if (data.email && data.email.includes('@')) {
        email = data.email.trim();
      } else if (data.displayName && data.displayName.includes('@')) {
        email = data.displayName.trim();
      }
      userEmailCache.set(userId, email);
      return email;
    }
  } catch (err) {
    console.error(`[ClientCron] Error resolving user ${userId}:`, err);
  }

  userEmailCache.set(userId, null);
  return null;
}

interface MilestoneResult {
  milestone: string;
  label: string;
}

function calculateMilestone(deadline: Date): MilestoneResult | null {
  const target = startOfDay(deadline);
  const now = startOfDay(new Date());
  const diff = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diff === 30 || (diff <= 30 && diff >= 28)) {
    return { milestone: 'pre_30', label: 'vence en 1 mes (30 días)' };
  } else if (diff === 3) {
    return { milestone: 'pre_3', label: 'vence en 3 días' };
  } else if (diff === 0) {
    return { milestone: 'day_of', label: 'vence HOY' };
  } else if (diff < 0) {
    const overdueDays = Math.abs(diff);

    // Weekly reminder
    if (overdueDays > 0 && overdueDays % 7 === 0) {
      const weeks = overdueDays / 7;
      return {
        milestone: `overdue_week_${weeks}`,
        label: `se encuentra VENCIDO hace ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`
      };
    }
  }
  return null;
}

export async function runClientDeadlineCheck(force = false) {
  // Prevent running more than once per hour unless forced
  const nowTime = Date.now();
  const lastRun = localStorage.getItem('last_client_cron_run');
  if (!force && lastRun && nowTime - parseInt(lastRun) < 60 * 60 * 1000) {
    return;
  }

  console.log('[ClientCron] Starting client-side deadline check...');
  localStorage.setItem('last_client_cron_run', nowTime.toString());

  const today = startOfDay(new Date());
  const dateKey = format(today, 'yyyy-MM-dd');

  try {
    // 1. Process Findings
    const findingsSnap = await getDocs(collection(db, 'findings'));
    const findingsToProcess = findingsSnap.docs.filter(doc => {
      const status = doc.data().status;
      return status === 'pending_analysis' || status === 'Análisis Pendiente' || status === 'Pendiente de Análisis';
    });

    for (const fDoc of findingsToProcess) {
      const data = fDoc.data();
      if (data.analysisDeadline) {
        const deadline = data.analysisDeadline.toDate ? data.analysisDeadline.toDate() : new Date(data.analysisDeadline);
        const milestoneInfo = calculateMilestone(deadline);
        
        if (milestoneInfo) {
          const email = await resolveUserEmail(data.analysisResponsibleId || data.ownerId, data.analysisResponsibleEmail || data.ownerEmail);
          if (email) {
            await handleMilestone(
              fDoc.id,
              'finding',
              milestoneInfo.milestone,
              milestoneInfo.label,
              deadline,
              email,
              `Investigación pendiente #${data.findingNumber}`,
              data.description,
              dateKey,
              fDoc.id
            );
          }
        }
      }
    }

    // 2. Process Corrective Actions
    for (const fDoc of findingsSnap.docs) {
      const parentFinding = fDoc.data();
      const fNum = parentFinding.findingNumber || 0;
      
      const actionsSnap = await getDocs(collection(db, 'findings', fDoc.id, 'correctiveActions'));
      const actionsToProcess = actionsSnap.docs.filter(doc => {
        const status = doc.data().status;
        return status === 'pending' || status === 'Pendiente';
      });

      for (const aDoc of actionsToProcess) {
        const data = aDoc.data();
        if (data.deadline) {
          const deadline = data.deadline.toDate ? data.deadline.toDate() : new Date(data.deadline);
          const milestoneInfo = calculateMilestone(deadline);

          if (milestoneInfo) {
            const email = await resolveUserEmail(data.responsibleId, data.responsibleEmail);
            if (email) {
              await handleMilestone(
                aDoc.id,
                'action',
                milestoneInfo.milestone,
                milestoneInfo.label,
                deadline,
                email,
                `Acción correctiva pendiente (Hallazgo #${fNum})`,
                data.description,
                dateKey,
                fDoc.id
              );
            }
          }
        }
      }
    }

    // 3. Process ISO Tasks
    const calendarsSnap = await getDocs(collection(db, 'iso_calendars'));
    for (const calDoc of calendarsSnap.docs) {
      const calData = calDoc.data();
      const tasksSnap = await getDocs(collection(db, 'iso_calendars', calDoc.id, 'tasks'));
      const pendingTasks = tasksSnap.docs.filter(doc => {
        const status = doc.data().status;
        return status !== 'Finalizada' && status !== 'Finalizado';
      });

      for (const tDoc of pendingTasks) {
        const task = tDoc.data();
        if (task.deadline) {
          const deadline = task.deadline.toDate ? task.deadline.toDate() : new Date(task.deadline);
          const milestoneInfo = calculateMilestone(deadline);

          if (milestoneInfo) {
            const email = task.responsibleEmail;
            if (email && email.includes('@')) {
              await handleMilestone(
                tDoc.id,
                'iso_task',
                milestoneInfo.milestone,
                milestoneInfo.label,
                deadline,
                email,
                `Tarea ISO pendiente: ${task.name}`,
                `Calendario: ${calData.name}\nFrecuencia: ${task.frequency}\nComentarios: ${task.comments || 'Ninguno'}`,
                dateKey,
                calDoc.id
              );
            }
          }
        }
      }
    }

    console.log('[ClientCron] Client-side deadline check completed successfully.');
  } catch (err) {
    console.error('[ClientCron] Error running client-side deadline check:', err);
  }
}

async function handleMilestone(
  itemId: string,
  itemType: string,
  milestone: string,
  label: string,
  deadline: Date,
  recipientEmail: string,
  context: string,
  description: string,
  dateKey: string,
  findingOrCalendarId: string
) {
  const historyId = `${itemId}_${milestone}`;
  const historyRef = doc(db, 'notificationHistory', historyId);

  try {
    const historySnap = await getDoc(historyRef);
    if (historySnap.exists()) {
      return; // Already notified
    }

    console.log(`[ClientCron] Milestone ${milestone} reached for ${itemType} ${itemId}. Sending notification to ${recipientEmail}...`);

    const subject = `[RECORDATORIO] ${context} ${label}`;
    let linkStr = '';
    if (itemType === 'finding') {
      linkStr = `\n\nPuede acceder a la investigación aquí:\n${generateFindingLink(findingOrCalendarId, 'analysis')}`;
    } else if (itemType === 'action') {
      linkStr = `\n\nPuede acceder a la acción del hallazgo aquí:\n${generateFindingLink(findingOrCalendarId, 'actions')}`;
    } else if (itemType === 'iso_task') {
      linkStr = `\n\nPuede acceder a la tarea aquí:\n${generateCalendarLink(findingOrCalendarId)}`;
    }

    const body = `Estimado responsable,

Este es un recordatorio automático del sistema de gestión de calidad.

${context} ${label}.
Descripción: ${description}
Fecha límite: ${format(deadline, 'dd/MM/yyyy')}${linkStr}

Por favor, ingrese al sistema para completar la tarea.

Atentamente,
SGC Crucianelli`;

    // Send the notification
    const result = await sendNotification({
      to: recipientEmail,
      subject,
      body,
      type: 'overdue',
      findingId: itemType === 'iso_task' ? undefined : findingOrCalendarId
    });

    if (result && result.success) {
      // Record in history to avoid sending again
      await setDoc(historyRef, {
        itemId,
        itemType,
        milestone,
        dateKey,
        sentAt: serverTimestamp(),
        status: 'sent'
      });
      console.log(`[ClientCron] Notification history created for ${historyId}`);
    } else {
      console.error(`[ClientCron] Failed to send email to ${recipientEmail}:`, result?.error);
    }
  } catch (err) {
    console.error(`[ClientCron] Error handling milestone for ${historyId}:`, err);
  }
}

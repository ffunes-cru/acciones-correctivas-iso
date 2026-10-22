import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, getDocs, doc, getDoc, updateDoc, deleteDoc, addDoc, setDoc, serverTimestamp, writeBatch, runTransaction, arrayUnion } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, UserRole, ISOCalendar, ISOTask } from '../types';
import { UserSelect } from './UserSelect';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { sendNotification, generateCalendarLink, generateFindingLink } from '../services/notificationService';
import { triggerAutoSync } from '../lib/googleWorkspace';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, CalendarDays, ClipboardList, CheckCircle2, AlertCircle, Clock, 
  User, MessageSquare, ChevronRight, ChevronDown, Edit3, Trash2, PlusCircle, Loader2, Filter, 
  Search, ExternalLink, Calendar, CheckSquare, X, ShieldAlert, BadgeCheck, FileCheck2, LayoutList, AlertTriangle, Eye,
  TrendingUp, BarChart3, Minimize2, Maximize2, Mail, FileText, Download, Send, Printer
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';
import { generateAuditReportPDF, getAuditScopeDefault, DEFAULT_AUDIT_CRITERIA } from '../utils/auditReportPDF';
import { generateAuditTemplatePDF } from '../utils/auditTemplatePDF';
import { AuditProcessDetail, getAuditProcessName, getAuditProcessDetails, getAuditConclusionDefault } from '../utils/auditProcessDetails';

const PROCESSES = [
  'Administración y Finanzas', 'Calidad', 'Comercial', 'Compras', 'Dirección',
  'Gestión General', 'Ingeniería', 'IT', 'Logística', 'Mantenimiento',
  'Marketing', 'PCP', 'Posventa', 'Producción', 'Repuestos', 'RRHH', 'Otros'
];

interface ISOCalendarDetailsProps {
  user: UserProfile;
}

export default function ISOCalendarDetails({ user }: ISOCalendarDetailsProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [calendar, setCalendar] = useState<ISOCalendar | null>(null);
  const [tasks, setTasks] = useState<ISOTask[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Segmented Tabs to organize information
  const [activeTab, setActiveTab] = useState<'all' | 'audits' | 'sgc'>('all');
  const [showSCurve, setShowSCurve] = useState(true);

  // Filters state
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [respFilter, setRespFilter] = useState<string>('All');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Editing state for General User (Status/Comments) & Admin Editing (Dates/Responsible)
  const [selectedTask, setSelectedTask] = useState<ISOTask | null>(null);
  const [taskStatus, setTaskStatus] = useState<'No iniciado' | 'En proceso' | 'Finalizado' | 'No iniciada' | 'Finalizada'>('No iniciado');
  const [taskComments, setTaskComments] = useState('');
  const [auditedPersonnel, setAuditedPersonnel] = useState('');
  const [auditReportLink, setAuditReportLink] = useState('');
  const [realExecutionDate, setRealExecutionDate] = useState<string>('');
  const [savingTask, setSavingTask] = useState(false);

  // Extra fields for Internal Audit
  const [auditScope, setAuditScope] = useState('');
  const [auditCriteria, setAuditCriteria] = useState('');
  const [strengths, setStrengths] = useState('');
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [minorNonConformities, setMinorNonConformities] = useState<any[]>([]);
  const [majorNonConformities, setMajorNonConformities] = useState<any[]>([]);

  // Admin: Add Task specifically to this Calendar
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomName, setNewCustomName] = useState('');
  const [newCustomFreq, setNewCustomFreq] = useState('Anual');
  const [newCustomResp, setNewCustomResp] = useState('');
  const [newCustomDeadline, setNewCustomDeadline] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);

  // Admin: Edit Date & Responsible of a task
  const [showAdminEditModal, setShowAdminEditModal] = useState(false);
  const [adminEditTask, setAdminEditTask] = useState<ISOTask | null>(null);
  const [adminEditResp, setAdminEditResp] = useState('');
  const [adminEditDeadline, setAdminEditDeadline] = useState('');
  const [savingAdminEdit, setSavingAdminEdit] = useState(false);

  // Deletion state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Admin: Rename Calendar / Edit Metadata
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [newCalendarDescription, setNewCalendarDescription] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  // Email sharing state for Audit Reports
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTask, setEmailTask] = useState<ISOTask | null>(null);
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [customEmailInput, setCustomEmailInput] = useState('');
  const [emailCustomMessage, setEmailCustomMessage] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailUserSearch, setEmailUserSearch] = useState('');

  const filteredEmailUsers = users.filter(u => 
    (u.displayName || '').toLowerCase().includes(emailUserSearch.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(emailUserSearch.toLowerCase())
  );

  const isAdmin = user.role === UserRole.ADMIN;

  // State for risks migration
  const [migratingRiesgos, setMigratingRiesgos] = useState(false);

  // Detect old single tasks for risks
  const risksTasksToMigrate = tasks.filter(t => 
    (t.name.toLowerCase().includes('riesgos') || t.originalTaskName?.toLowerCase().includes('riesgos')) &&
    !t.name.toLowerCase().includes('- it') &&
    !t.name.toLowerCase().includes('- calidad') &&
    !t.name.toLowerCase().includes('- comercial') &&
    !t.name.toLowerCase().includes('- ingeniería') &&
    !t.name.toLowerCase().includes('- ingenieria') &&
    !t.name.toLowerCase().includes('- producción') &&
    !t.name.toLowerCase().includes('- produccion') &&
    !t.name.toLowerCase().includes('- rrhh') &&
    !t.name.toLowerCase().includes('- supply chain')
  );
  const isAuditTask = !!(selectedTask && (selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor')));
  const isBlockedAudit = !!(selectedTask && (
    ((selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor')) &&
     (selectedTask.status === 'Finalizado' || selectedTask.status === 'Finalizada') &&
     !isAdmin) ||
    (selectedTask.responsibleId !== user.id && !isAdmin)
  ));
  const checkAuditAccess = (task: ISOTask) => {
    const isAudit = task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor');
    if (!isAudit) return true;

    const isAssignee = task.responsibleId === user.id || task.responsibleEmail.toLowerCase() === user.email.toLowerCase();
    const isShared = task.sharedEmails && task.sharedEmails.some(email => email.toLowerCase() === user.email.toLowerCase());
    
    return isAdmin || isAssignee || isShared;
  };
  const isDocumentedInfo = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('información documentada') || 
    selectedTask.name.toLowerCase().includes('informacion documentada') ||
    selectedTask.originalTaskName?.toLowerCase().includes('información documentada') ||
    selectedTask.originalTaskName?.toLowerCase().includes('informacion documentada')
  ));
  const isRRHHAudit = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('recursos humanos') || 
    selectedTask.name.toLowerCase().includes('rrhh') ||
    selectedTask.originalTaskName?.toLowerCase().includes('recursos humanos') ||
    selectedTask.originalTaskName?.toLowerCase().includes('rrhh')
  ));
  const isRevisionDireccion = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('dirección') || 
    selectedTask.name.toLowerCase().includes('direccion') ||
    selectedTask.originalTaskName?.toLowerCase().includes('dirección') ||
    selectedTask.originalTaskName?.toLowerCase().includes('direccion')
  ));
  const isInvestigacionDesarrollo = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('investigación y desarrollo') || 
    selectedTask.name.toLowerCase().includes('investizacion y desarrollo') ||
    selectedTask.name.toLowerCase().includes('diseño') ||
    selectedTask.name.toLowerCase().includes('diseno') ||
    selectedTask.name.toLowerCase().includes('i+d') ||
    selectedTask.name.toLowerCase().includes('desarrollo') ||
    selectedTask.originalTaskName?.toLowerCase().includes('investigación y desarrollo') ||
    selectedTask.originalTaskName?.toLowerCase().includes('investizacion y desarrollo') ||
    selectedTask.originalTaskName?.toLowerCase().includes('diseño') ||
    selectedTask.originalTaskName?.toLowerCase().includes('diseno') ||
    selectedTask.originalTaskName?.toLowerCase().includes('i+d') ||
    selectedTask.originalTaskName?.toLowerCase().includes('desarrollo')
  ));
  const isProduccion = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('producción') || 
    selectedTask.name.toLowerCase().includes('produccion') ||
    selectedTask.originalTaskName?.toLowerCase().includes('producción') ||
    selectedTask.originalTaskName?.toLowerCase().includes('produccion')
  ));
  const isCalidad = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('calidad') || 
    selectedTask.name.toLowerCase().includes('recepción') ||
    selectedTask.name.toLowerCase().includes('recepcion') ||
    selectedTask.name.toLowerCase().includes('reclamos') ||
    selectedTask.originalTaskName?.toLowerCase().includes('calidad') ||
    selectedTask.originalTaskName?.toLowerCase().includes('recepción') ||
    selectedTask.originalTaskName?.toLowerCase().includes('recepcion') ||
    selectedTask.originalTaskName?.toLowerCase().includes('reclamos')
  ));
  const isMedicion = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('medición') || 
    selectedTask.name.toLowerCase().includes('medicion') ||
    selectedTask.originalTaskName?.toLowerCase().includes('medición') ||
    selectedTask.originalTaskName?.toLowerCase().includes('medicion')
  ));
  const isMantenimiento = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('mantenimiento') || 
    selectedTask.originalTaskName?.toLowerCase().includes('mantenimiento')
  ));
  const isComercializacion = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('comercialización') || 
    selectedTask.name.toLowerCase().includes('comercializacion') || 
    selectedTask.name.toLowerCase().includes('ventas') || 
    selectedTask.name.toLowerCase().includes('pedidos') ||
    selectedTask.originalTaskName?.toLowerCase().includes('comercialización') ||
    selectedTask.originalTaskName?.toLowerCase().includes('comercializacion') ||
    selectedTask.originalTaskName?.toLowerCase().includes('ventas') ||
    selectedTask.originalTaskName?.toLowerCase().includes('pedidos')
  ));
  const isContextoRiesgos = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('contexto') || 
    selectedTask.name.toLowerCase().includes('partes interesadas') || 
    selectedTask.name.toLowerCase().includes('riesgos') || 
    selectedTask.name.toLowerCase().includes('oportunidades') ||
    selectedTask.originalTaskName?.toLowerCase().includes('contexto') ||
    selectedTask.originalTaskName?.toLowerCase().includes('partes interesadas') ||
    selectedTask.originalTaskName?.toLowerCase().includes('riesgos') ||
    selectedTask.originalTaskName?.toLowerCase().includes('oportunidades')
  ));
  const isPosventa = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('posventa') || 
    selectedTask.name.toLowerCase().includes('postventa') || 
    selectedTask.name.toLowerCase().includes('garantía') || 
    selectedTask.name.toLowerCase().includes('garantia') ||
    selectedTask.originalTaskName?.toLowerCase().includes('posventa') ||
    selectedTask.originalTaskName?.toLowerCase().includes('postventa') ||
    selectedTask.originalTaskName?.toLowerCase().includes('garantía') ||
    selectedTask.originalTaskName?.toLowerCase().includes('garantia')
  ));
  const isCompras = !!(selectedTask && (
    selectedTask.name.toLowerCase().includes('compras') || 
    selectedTask.name.toLowerCase().includes('proveedores') ||
    selectedTask.originalTaskName?.toLowerCase().includes('compras') ||
    selectedTask.originalTaskName?.toLowerCase().includes('proveedores')
  ));

  const handleRenameCalendar = async () => {
    if (!id || !calendar || !newCalendarName.trim()) return;
    setSavingRename(true);
    try {
      const calendarRef = doc(db, 'iso_calendars', id);
      await updateDoc(calendarRef, {
        name: newCalendarName.trim(),
        description: newCalendarDescription.trim(),
        updatedAt: serverTimestamp()
      });
      setCalendar(prev => prev ? { 
        ...prev, 
        name: newCalendarName.trim(),
        description: newCalendarDescription.trim()
      } : null);
      setShowRenameModal(false);
    } catch (err: any) {
      console.error('Error renaming calendar:', err);
      alert('Error al intentar cambiar el nombre/descripción del calendario: ' + err.message);
    } finally {
      setSavingRename(false);
    }
  };

  const generateEmailReportBody = (calendarObj: ISOCalendar, taskObj: ISOTask, companyName: string, customMsg: string) => {
    return customMsg.trim();
  };

  const generateEmailReportHtmlBody = (calendarObj: ISOCalendar, taskObj: ISOTask, companyName: string, customMsg: string) => {
    const brandColor = companyName === 'Fertec' ? '#1E3A8A' : '#C9252C';
    const auditLink = generateCalendarLink(calendarObj.id, taskObj.id);

    let html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1F2937; background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px;">
        <!-- Header -->
        <div style="background-color: ${brandColor}; padding: 24px; border-radius: 8px 8px 0 0; text-align: center; color: #FFFFFF;">
          <h2 style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; opacity: 0.9;">Sistema de Gestión de la Calidad (SGC)</h2>
          <h1 style="margin: 6px 0 0 0; font-size: 20px; font-weight: 700;">Informe de Auditoría Interna</h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.8;">Planificación ISO ${calendarObj.year} • ${companyName}</p>
        </div>

        <!-- Custom Message -->
        ${customMsg ? `
        <div style="padding: 16px; margin: 16px 0; background-color: #FFFFFF; border-left: 4px solid ${brandColor}; border-radius: 4px; font-size: 14px; line-height: 1.5; color: #374151; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          ${customMsg.trim().replace(/\n/g, '<br/>')}
        </div>
        ` : ''}

        <!-- Action / Attachment Message -->
        <div style="text-align: center; margin-bottom: 24px; padding: 16px; background-color: #F3F4F6; border-radius: 8px;">
          <p style="margin: 0 0 12px 0; font-size: 13px; color: #4B5563;">El reporte de auditoría completo y formateado oficialmente ha sido generado y <strong>se adjunta de manera automática a este correo</strong> como un archivo PDF.</p>
          <a href="${auditLink}" style="display: inline-block; padding: 10px 20px; background-color: ${brandColor}; color: #FFFFFF; text-decoration: none; font-size: 13px; font-weight: 600; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">Ver Detalle de la Auditoría</a>
        </div>

        <!-- Footer -->
        <div style="border-top: 1px solid #E5E7EB; padding-top: 16px; text-align: center; font-size: 11px; color: #9CA3AF;">
          Este correo fue generado de forma automática por el Sistema de Gestión de Calidad SGC Crucianelli / Fertec.<br/>
          Por favor, no responda directamente a este remitente.
        </div>
      </div>
    `;
    return html;
  };

  const handleDownloadPDF = (taskObj: ISOTask) => {
    if (!calendar) return;
    const company = calendar.name.toLowerCase().includes('fertec') ? 'Fertec' : 'Crucianelli';
    const docPdf = generateAuditReportPDF(calendar, taskObj, company);
    const processName = getAuditProcessName(taskObj.name);
    docPdf.save(`Informe_Auditoria_${processName.replace(/\s+/g, '_')}_${calendar.year}.pdf`);
  };

  const handleDownloadTemplatePDF = (taskObj: ISOTask) => {
    if (!calendar) return;
    const company = calendar.name.toLowerCase().includes('fertec') ? 'Fertec' : 'Crucianelli';
    const details = getAuditProcessDetails(taskObj.name);
    const auditorName = user?.displayName || user?.email || 'Auditor Interno';
    const docPdf = generateAuditTemplatePDF(calendar, taskObj, company, auditorName, details);
    const processName = getAuditProcessName(taskObj.name);
    docPdf.save(`Lista_Verificacion_${processName.replace(/\s+/g, '_')}_${calendar.year}.pdf`);
  };

  const handleOpenEmailModal = (taskObj: ISOTask) => {
    setEmailTask(taskObj);
    setEmailRecipients([]);
    setCustomEmailInput('');
    const auditLink = generateCalendarLink(calendar?.id || '', taskObj.id);
    setEmailCustomMessage(`Hola, adjunto encontrarás el link para descargar el reporte final de auditoría correspondiente al proceso de ${getAuditProcessName(taskObj.name)} de la planificación anual ISO ${calendar?.year || ''}.\n\nLink a la auditoría: ${auditLink}`);
    setEmailSuccess(false);
    setEmailError(null);
    setEmailUserSearch('');
    setShowEmailModal(true);
  };

  const handleSendEmailReport = async () => {
    if (!calendar || !emailTask) return;
    
    const customEmails = customEmailInput
      .split(',')
      .map(e => e.trim())
      .filter(e => e.includes('@') && e.length > 4);
      
    const allRecipients = [...emailRecipients, ...customEmails];
    
    if (allRecipients.length === 0) {
      setEmailError('Por favor especifique al menos un destinatario válido.');
      return;
    }
    
    setEmailSending(true);
    setEmailError(null);
    
    try {
      const company = calendar.name.toLowerCase().includes('fertec') ? 'Fertec' : 'Crucianelli';
      const companyName = company === 'Fertec' ? 'Fertec' : 'Crucianelli';
      const subject = `Informe de Auditoría Interna - ${getAuditProcessName(emailTask.name)} (${calendar.year})`;
      const body = generateEmailReportBody(calendar, emailTask, companyName, emailCustomMessage);
      const htmlBody = generateEmailReportHtmlBody(calendar, emailTask, companyName, emailCustomMessage);

      // Generate PDF attachment dynamically
      const docPdf = generateAuditReportPDF(calendar, emailTask, company);
      const pdfDataUri = docPdf.output('datauristring');
      const base64Content = pdfDataUri.split(';base64,')[1];
      const processNameClean = getAuditProcessName(emailTask.name).replace(/\s+/g, '_');
      const filename = `Informe_Auditoria_${processNameClean}_${calendar.year}.pdf`;

      const attachment = {
        filename: filename,
        content: base64Content,
        type: 'application/pdf'
      };
      
      for (const recipient of allRecipients) {
        await sendNotification({
          to: recipient,
          subject: subject,
          body: body,
          htmlBody: htmlBody,
          attachment: attachment,
          type: 'verification',
        });
      }

      // Guardar destinatarios notificados para control de acceso (solo para auditorías)
      const isAudit = emailTask.name.toLowerCase().includes('auditor') || emailTask.originalTaskName?.toLowerCase().includes('auditor');
      if (isAudit) {
        const taskRef = doc(db, 'iso_calendars', id, 'tasks', emailTask.id);
        const lowerRecipients = allRecipients.map(r => r.toLowerCase());
        await updateDoc(taskRef, {
          sharedEmails: arrayUnion(...lowerRecipients),
          updatedAt: serverTimestamp()
        });

        // Actualizar el estado local
        setTasks(prevTasks => prevTasks.map(t => {
          if (t.id === emailTask.id) {
            const currentShared = t.sharedEmails || [];
            const merged = Array.from(new Set([...currentShared, ...lowerRecipients]));
            return {
              ...t,
              sharedEmails: merged
            };
          }
          return t;
        }));
      }
      
      setEmailSuccess(true);
      setEmailSending(false);
    } catch (err: any) {
      console.error('Error sending audit report email:', err);
      setEmailError('Error al enviar el reporte de auditoría por email: ' + (err.message || String(err)));
      setEmailSending(false);
    }
  };

  const handleDeleteCalendar = async () => {
    if (!id || !calendar) return;
    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      tasks.forEach(task => {
        batch.delete(doc(db, 'iso_calendars', id, 'tasks', task.id));
      });
      batch.delete(doc(db, 'iso_calendars', id));
      await batch.commit();
      setShowDeleteModal(false);
      navigate('/');
    } catch (err: any) {
      console.error('Error deleting calendar:', err);
      alert('Error al intentar eliminar el calendario: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      // 1. Fetch Calendar
      const calSnap = await getDoc(doc(db, 'iso_calendars', id));
      if (!calSnap.exists()) {
        setError('El calendario solicitado no existe.');
        setLoading(false);
        return;
      }
      setCalendar({ id: calSnap.id, ...calSnap.data() } as ISOCalendar);

      // 2. Fetch Tasks subcollection
      const tasksSnap = await getDocs(collection(db, 'iso_calendars', id, 'tasks'));
      const tasksList = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() } as ISOTask));
      // Sort tasks by required date
      tasksList.sort((a, b) => {
        const dateA = (a.deadline && typeof a.deadline.toDate === 'function') ? a.deadline.toDate() : new Date(a.deadline);
        const dateB = (b.deadline && typeof b.deadline.toDate === 'function') ? b.deadline.toDate() : new Date(b.deadline);
        return dateA.getTime() - dateB.getTime();
      });
      setTasks(tasksList);

      // 3. Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersList = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
      usersList.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setUsers(usersList);

    } catch (err: any) {
      console.error('Error fetching ISO calendar details:', err);
      setError('Ocurrió un error al cargar la planificación ISO.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  useEffect(() => {
    if (!loading && tasks.length > 0 && !hasAutoOpened) {
      const searchParams = new URLSearchParams(window.location.search);
      const queryTaskId = searchParams.get('taskId');
      if (queryTaskId) {
        const foundTask = tasks.find(t => t.id === queryTaskId);
        if (foundTask) {
          handleOpenTaskModal(foundTask);
          setHasAutoOpened(true);
        }
      }
    }
  }, [loading, tasks, hasAutoOpened]);

  const getCompletionDateString = (dl: any) => {
    if (!dl) return new Date().toISOString().split('T')[0];
    const date = (dl && typeof dl.toDate === 'function') ? dl.toDate() : new Date(dl);
    return date.toISOString().split('T')[0];
  };

  const handleUpdateTaskInline = async (task: ISOTask, newStatus: any, newDateStr: string, newComments?: string) => {
    if (!id) return;

    // Security check: once an internal audit task is marked completed, only admins can modify it.
    const isAudit = task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor');
    const isAlreadyFinalized = task.status === 'Finalizado' || task.status === 'Finalizada';
    if (isAudit && isAlreadyFinalized && !isAdmin) {
      alert('Error: Un reporte de auditoría interna finalizado no puede ser modificado (solo administradores pueden realizar cambios).');
      return;
    }
    
    const isFinalizado = newStatus === 'Finalizado' || newStatus === 'Finalizada';
    const commentsToUse = newComments !== undefined ? newComments : (task.comments || '');

    try {
      const taskRef = doc(db, 'iso_calendars', id, 'tasks', task.id);
      
      let completedAtDate = null;
      if (isFinalizado) {
        completedAtDate = new Date(newDateStr + 'T12:00:00');
      }

      const updates: any = {
        status: newStatus,
        comments: commentsToUse,
        completedAt: completedAtDate,
        updatedAt: serverTimestamp()
      };

      await updateDoc(taskRef, updates);

      // Update local state
      setTasks(prev => prev.map(t => {
        if (t.id === task.id) {
          return {
            ...t,
            status: newStatus,
            comments: commentsToUse,
            completedAt: completedAtDate
          };
        }
        return t;
      }));

      // Notify admin when a user completes a task
      if (isFinalizado && task.responsibleId === user.id) {
        await sendNotification({
          to: 'psantilli@crucianelli.com',
          subject: `Tarea ISO Completada por ${user.displayName}`,
          body: `Hola, se informa que el usuario ${user.displayName} ha completado la tarea ISO "${task.name}" de la planificación ${calendar?.year}.\n\nComentarios provistos:\n"${commentsToUse}"`,
          type: 'verification'
        }).catch(err => console.error('Notification failed:', err));
      }
    } catch (err) {
      console.error('Error updating task inline:', err);
      alert('Error al guardar la actualización de la tarea.');
    }
  };

  const handleOpenTaskModal = (task: ISOTask) => {
    setSelectedTask(task);
    setTaskStatus(task.status);
    
    const isAudit = task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor');
    if (isAudit && (!task.comments || !task.comments.trim())) {
      setTaskComments(getAuditConclusionDefault(task.originalTaskName || task.name));
    } else {
      setTaskComments(task.comments || '');
    }
    
    setAuditedPersonnel(task.auditedPersonnel || '');
    setAuditReportLink(task.auditReportLink || '');
    
    // Extra fields for Internal Audits (Alcance, Criterios, Fortalezas, OM, NC)
    const defaultScope = getAuditScopeDefault(calendar?.company, calendar?.name);
    setAuditScope(task.auditScope !== undefined ? task.auditScope : defaultScope);
    setAuditCriteria(task.auditCriteria !== undefined ? task.auditCriteria : DEFAULT_AUDIT_CRITERIA);
    setStrengths((task as any).strengths || '');
    setOpportunities((task as any).opportunities || []);
    setMinorNonConformities((task as any).minorNonConformities || []);
    setMajorNonConformities((task as any).majorNonConformities || []);
    if (task.completedAt) {
      const d = (task.completedAt && typeof task.completedAt.toDate === 'function') ? task.completedAt.toDate() : new Date(task.completedAt);
      setRealExecutionDate(d.toISOString().split('T')[0]);
    } else {
      setRealExecutionDate(new Date().toISOString().split('T')[0]);
    }
  };

  const handleSaveTaskStatus = async () => {
    if (!selectedTask || !id) return;

    // Security check: once an internal audit task is marked completed, only admins can modify it.
    const isAudit = selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor');
    const isAlreadyFinalized = selectedTask.status === 'Finalizado' || selectedTask.status === 'Finalizada';
    if (isAudit && isAlreadyFinalized && !isAdmin) {
      alert('Error: Un reporte de auditoría interna finalizado no puede ser modificado por usuarios que no son administradores.');
      return;
    }

    const isFinalizado = taskStatus === 'Finalizado' || taskStatus === 'Finalizada';

    const isCommentRequired = isFinalizado && (!taskComments.trim() || (isAuditTask && !auditedPersonnel.trim()));

    if (isCommentRequired) {
      if (isAuditTask) {
        if (!taskComments.trim() && !auditedPersonnel.trim()) {
          alert('Error: Debe ingresar la conclusión de auditoría y completar el campo de Personal Auditado antes de guardar la tarea como Finalizado.');
        } else if (!taskComments.trim()) {
          alert('Error: Debe ingresar la conclusión de auditoría antes de guardar la tarea como Finalizado.');
        } else {
          alert('Error: Debe completar el campo de Personal Auditado antes de guardar la tarea como Finalizado.');
        }
      } else {
        alert('Error: Debe agregar un comentario explicativo/registro antes de guardar la tarea como Finalizado.');
      }
      return;
    }

    setSavingTask(true);
    try {
      const taskRef = doc(db, 'iso_calendars', id, 'tasks', selectedTask.id);
      const updates: any = {
        status: taskStatus,
        comments: taskComments,
        auditedPersonnel: auditedPersonnel.trim(),
        auditReportLink: '',
        auditScope: auditScope,
        auditCriteria: auditCriteria,
        updatedAt: serverTimestamp(),
        strengths: strengths,
        opportunities: opportunities,
        minorNonConformities: minorNonConformities,
        majorNonConformities: majorNonConformities
      };

      if (isFinalizado) {
        updates.completedAt = new Date(realExecutionDate + 'T12:00:00');
      } else {
        updates.completedAt = null;
      }

      await updateDoc(taskRef, updates);

      // Update local state
      setTasks(tasks.map(t => {
        if (t.id === selectedTask.id) {
          return { 
            ...t, 
            status: taskStatus, 
            comments: taskComments, 
            auditedPersonnel: auditedPersonnel.trim(),
            auditReportLink: '',
            auditScope: auditScope,
            auditCriteria: auditCriteria,
            completedAt: isFinalizado ? new Date(realExecutionDate + 'T12:00:00') : null,
            strengths: strengths,
            opportunities: opportunities,
            minorNonConformities: minorNonConformities,
            majorNonConformities: majorNonConformities
          };
        }
        return t;
      }));

      // Notify admin when a user completes a task
      if ((taskStatus === 'Finalizada' || taskStatus === 'Finalizado') && selectedTask.responsibleId === user.id) {
        let auditDetailsText = '';
        if (auditedPersonnel.trim()) {
          auditDetailsText += `Personal auditado: ${auditedPersonnel.trim()}\n`;
        }
        
        await sendNotification({
          to: 'psantilli@crucianelli.com',
          subject: `Tarea ISO Completada por ${user.displayName}`,
          body: `Hola, se informa que el usuario ${user.displayName} ha completado la tarea ISO "${selectedTask.name}" de la planificación ${calendar?.year}.\n\n${auditDetailsText}Comentarios provistos:\n"${taskComments}"`,
          type: 'verification'
        }).catch(err => console.error('Notification failed:', err));
      }

      setSelectedTask(null);
    } catch (err) {
      console.error('Error updating task:', err);
      alert('Error al guardar la actualización de la tarea.');
    } finally {
      setSavingTask(false);
    }
  };

  // Helper to parse local date string to Date object
  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  };

  const handleAddOpportunity = () => {
    setOpportunities(prev => [
      ...prev,
      { id: crypto.randomUUID(), text: '', isConfirmed: false, responsibleId: '', deadline: '' }
    ]);
  };

  const handleRemoveOpportunity = (itemId: string) => {
    setOpportunities(prev => prev.filter(o => o.id !== itemId));
  };

  const handleUpdateOpportunityText = (itemId: string, val: string) => {
    setOpportunities(prev => prev.map(o => o.id === itemId ? { ...o, text: val } : o));
  };

  const handleAddMinorNonConformity = () => {
    setMinorNonConformities(prev => [
      ...prev,
      { id: crypto.randomUUID(), text: '', process: '', isConfirmed: false, responsibleId: '', deadline: '' }
    ]);
  };

  const handleRemoveMinorNonConformity = (itemId: string) => {
    setMinorNonConformities(prev => prev.filter(m => m.id !== itemId));
  };

  const handleUpdateMinorText = (itemId: string, val: string) => {
    setMinorNonConformities(prev => prev.map(m => m.id === itemId ? { ...m, text: val } : m));
  };

  const handleAddMajorNonConformity = () => {
    setMajorNonConformities(prev => [
      ...prev,
      { id: crypto.randomUUID(), text: '', process: '', isConfirmed: false, responsibleId: '', deadline: '' }
    ]);
  };

  const handleRemoveMajorNonConformity = (itemId: string) => {
    setMajorNonConformities(prev => prev.filter(m => m.id !== itemId));
  };

  const handleUpdateMajorText = (itemId: string, val: string) => {
    setMajorNonConformities(prev => prev.map(m => m.id === itemId ? { ...m, text: val } : m));
  };

  const handleConfirmFinding = async (
    type: 'opportunity' | 'minorNonConformity' | 'majorNonConformity',
    itemId: string,
    itemText: string,
    processName: string,
    responsibleId: string,
    deadlineDate: string
  ) => {
    if (!selectedTask || !id) return;

    const textToUse = (itemText || '').trim();
    if (!textToUse) {
      alert('Error: Por favor escriba una descripción antes de vincular el hallazgo.');
      return;
    }
    if (!responsibleId) {
      alert('Error: Por favor seleccione un responsable.');
      return;
    }
    if (!deadlineDate) {
      alert('Error: Por favor seleccione una fecha límite.');
      return;
    }

    const processToUse = (processName || '').trim();
    if ((type === 'minorNonConformity' || type === 'majorNonConformity') && !processToUse) {
      alert('Error: Por favor complete el proceso que genera el desvío.');
      return;
    }

    try {
      const counterRef = doc(db, 'config', 'counters');
      const responsibleUser = users.find(u => u.id === responsibleId);
      const isImprovement = type === 'opportunity';
      const company = calendar?.name?.toLowerCase().includes('fertec') ? 'Fertec' : 'TMC';

      const result = await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        let nextNumber = 1;
        const counterData = counterDoc.exists() ? counterDoc.data() : {};

        if (isImprovement) {
          nextNumber = (counterData.lastImprovementNumber || 0) + 1;
        } else {
          nextNumber = (counterData.lastCorrectiveNumber || counterData.lastFindingNumber || 0) + 1;
        }

        const newFindingRef = doc(collection(db, 'findings'));

        if (isImprovement) {
          const findingData = {
            findingNumber: nextNumber,
            findingCategory: 'improvement',
            company: company,
            findingDate: new Date(),
            origin: 'Auditoría Interna',
            type: 'Mejora',
            process: 'Mejora',
            description: `Oportunidades de mejora detectadas durante el proceso de auditoría interna (${selectedTask.name})`,
            ownerId: user.id,
            ownerEmail: user.email,
            status: 'pending_action',
            involvedUserIds: [user.id, responsibleId].filter(uid => !!uid),
            pendingActionUserIds: [responsibleId].filter(uid => !!uid),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          const actionRef = doc(collection(db, 'findings', newFindingRef.id, 'correctiveActions'));
          const actionData = {
            description: itemText,
            responsibleId: responsibleId,
            responsibleEmail: responsibleUser?.email || '',
            deadline: parseLocalDate(deadlineDate),
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          transaction.set(newFindingRef, findingData);
          transaction.set(actionRef, actionData);
          transaction.set(counterRef, { lastImprovementNumber: nextNumber }, { merge: true });
        } else {
          const findingData = {
            findingNumber: nextNumber,
            findingCategory: 'corrective',
            company: company,
            findingDate: new Date(),
            origin: 'Auditoría Interna',
            type: type === 'minorNonConformity' ? 'No conformidad menor' : 'No conformidad mayor',
            process: processToUse,
            description: `${type === 'minorNonConformity' ? 'No conformidades menores' : 'No conformidades mayores'} detectadas durante el proceso de auditoría interna (${selectedTask.name}) - Detalle: ${textToUse}`,
            ownerId: user.id,
            ownerEmail: user.email,
            analysisResponsibleId: responsibleId,
            analysisResponsibleEmail: responsibleUser?.email || '',
            analysisDeadline: parseLocalDate(deadlineDate),
            status: 'pending_analysis',
            involvedUserIds: [user.id, responsibleId].filter(uid => !!uid),
            pendingActionUserIds: [user.id, responsibleId].filter(uid => !!uid),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          transaction.set(newFindingRef, findingData);
          transaction.set(counterRef, { lastCorrectiveNumber: nextNumber, lastFindingNumber: nextNumber }, { merge: true });
        }

        return { id: newFindingRef.id, number: nextNumber };
      });

      // Update local task document fields
      if (type === 'opportunity') {
        const updatedOpportunities = opportunities.map(o => {
          if (o.id === itemId) {
            return {
              ...o,
              isConfirmed: true,
              linkedFindingId: result.id,
              linkedFindingNumber: result.number,
              responsibleId,
              deadline: deadlineDate
            };
          }
          return o;
        });
        setOpportunities(updatedOpportunities);
        const taskRef = doc(db, 'iso_calendars', id, 'tasks', selectedTask.id);
        await updateDoc(taskRef, {
          opportunities: updatedOpportunities
        });
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, opportunities: updatedOpportunities } as any : t));
      } else if (type === 'minorNonConformity') {
        const updatedMinor = minorNonConformities.map(m => {
          if (m.id === itemId) {
            return {
              ...m,
              isConfirmed: true,
              linkedFindingId: result.id,
              linkedFindingNumber: result.number,
              process: processToUse,
              responsibleId,
              deadline: deadlineDate
            };
          }
          return m;
        });
        setMinorNonConformities(updatedMinor);
        const taskRef = doc(db, 'iso_calendars', id, 'tasks', selectedTask.id);
        await updateDoc(taskRef, {
          minorNonConformities: updatedMinor
        });
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, minorNonConformities: updatedMinor } as any : t));
      } else if (type === 'majorNonConformity') {
        const updatedMajor = majorNonConformities.map(m => {
          if (m.id === itemId) {
            return {
              ...m,
              isConfirmed: true,
              linkedFindingId: result.id,
              linkedFindingNumber: result.number,
              process: processToUse,
              responsibleId,
              deadline: deadlineDate
            };
          }
          return m;
        });
        setMajorNonConformities(updatedMajor);
        const taskRef = doc(db, 'iso_calendars', id, 'tasks', selectedTask.id);
        await updateDoc(taskRef, {
          majorNonConformities: updatedMajor
        });
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, majorNonConformities: updatedMajor } as any : t));
      }

      // Send email notifications
      const link = generateFindingLink(result.id);
      console.log(`[ISOCalendarDetails] Enviando mails para Hallazgo #${result.number} (${isImprovement ? 'improvement' : 'corrective'})`);

      const notificationPromises = [];

      if (isImprovement) {
        // Mail to owner
        notificationPromises.push(
          sendNotification({
            to: user.email,
            subject: `Hallazgo de Mejora #${result.number} - Registro Exitoso`,
            body: `Hola ${user.displayName}, el hallazgo de mejora #${result.number} ha sido cargado exitosamente. Puede realizar el seguimiento y ver los detalles aquí: ${link}`,
            type: 'creation',
            findingId: result.id
          })
        );

        // Mail to action executor
        const toEmail = responsibleUser?.email || responsibleUser?.displayName || responsibleId;
        if (toEmail) {
          notificationPromises.push(
            sendNotification({
              to: toEmail,
              subject: `Asignación de Acción de Mejora - Hallazgo #${result.number}`,
              body: `Estimado/a ${responsibleUser?.displayName || 'Usuario'}, se le ha asignado una acción de mejora relacionada al hallazgo Número: ${result.number}. Por favor, ingrese al siguiente enlace para ver los detalles: ${link}`,
              type: 'action_assigned',
              findingId: result.id
            })
          );
        }
      } else {
        // Mail to owner
        notificationPromises.push(
          sendNotification({
            to: user.email,
            subject: `Hallazgo #${result.number} - Registro Exitoso`,
            body: `Hola ${user.displayName}, el hallazgo ha sido cargado exitosamente. Puede realizar el seguimiento y ver los detalles aquí: ${link}`,
            type: 'creation',
            findingId: result.id
          })
        );

        // Mail to analysis responsible
        const toEmail = responsibleUser?.email || responsibleUser?.displayName || responsibleId;
        if (toEmail) {
          notificationPromises.push(
            sendNotification({
              to: toEmail,
              subject: `ASIGNACIÓN: Investigación de Causa Raíz - Hallazgo #${result.number}`,
              body: `Estimado/a ${responsibleUser?.displayName || 'Usuario'}, se le ha asignado la investigación de causa raíz del hallazgo Número: ${result.number}. Por favor, ingrese al siguiente enlace para completar el análisis: ${generateFindingLink(result.id, 'analysis')}`,
              type: 'assignment',
              findingId: result.id
            })
          );
        }
      }

      // Execute notifications in background
      Promise.allSettled(notificationPromises).then(results => {
        results.forEach((res, idx) => {
          if (res.status === 'rejected') {
            console.error(`[ISOCalendarDetails] Error en notificación ${idx}:`, res.reason);
          } else {
            console.log(`[ISOCalendarDetails] Notificación ${idx} enviada:`, res.value);
          }
        });
      });

      triggerAutoSync();

      alert(`¡Éxito! El hallazgo #${result.number} ha sido generado y vinculado automáticamente.`);
    } catch (err: any) {
      console.error('Error confirming finding:', err);
      alert('Error al generar el hallazgo: ' + err.message);
    }
  };

  // Admin Action: Delete task instance
  const handleDeleteTask = async (taskId: string) => {
    if (!id || !window.confirm('¿Está completamente seguro de eliminar esta instancia de tarea de la planificación?')) return;

    try {
      await deleteDoc(doc(db, 'iso_calendars', id, 'tasks', taskId));
      setTasks(tasks.filter(t => t.id !== taskId));
    } catch (err) {
      console.error('Error deleting task:', err);
      alert('No se pudo eliminar la tarea.');
    }
  };

  // Admin Action: Add Custom Task Instance
  const handleAddCustomTask = async () => {
    if (!id || !newCustomName.trim() || !newCustomResp || !newCustomDeadline) {
      alert('Por favor complete todos los campos requeridos para la nueva tarea.');
      return;
    }

    setAddingCustom(true);
    try {
      const respUser = users.find(u => u.id === newCustomResp);
      if (!respUser) return;

      const taskId = `custom_added_${Date.now()}`;
      const taskDocRef = doc(db, 'iso_calendars', id, 'tasks', taskId);
      const targetDate = new Date(newCustomDeadline + 'T12:00:00'); // set mid-day to avoid TZ shifts

      const isAudit = newCustomName.toLowerCase().includes('auditoría') || newCustomName.toLowerCase().includes('auditoria');

      const newTaskData: any = {
        id: taskId,
        calendarId: id,
        year: calendar?.year || new Date().getFullYear(),
        name: newCustomName.trim(),
        originalTaskName: isAudit ? 'Auditoría Interna' : newCustomName.trim(),
        frequency: newCustomFreq,
        instanceLabel: 'Ad-hoc',
        responsibleId: respUser.id,
        responsibleEmail: respUser.email,
        responsibleName: respUser.displayName,
        deadline: targetDate,
        status: 'No iniciado',
        comments: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(taskDocRef, newTaskData);

      // Local update
      setTasks([...tasks, { ...newTaskData, deadline: targetDate }].sort((a, b) => {
        const dateA = (a.deadline && typeof a.deadline.toDate === 'function') ? a.deadline.toDate() : new Date(a.deadline);
        const dateB = (b.deadline && typeof b.deadline.toDate === 'function') ? b.deadline.toDate() : new Date(b.deadline);
        return dateA.getTime() - dateB.getTime();
      }));

      // Send email notification to responsible
      const calendarLink = id ? generateCalendarLink(id, newTaskData.id) : '';
      await sendNotification({
        to: respUser.email,
        subject: `[SGC Crucianelli] Nueva Tarea ISO Asignada - Planificación ${calendar?.year}`,
        body: `Estimado responsable,\n\nLe informamos que el administrador del SGC le ha asignado una nueva tarea personalizada en la planificación ISO ${calendar?.year}:\n\n• Tarea: ${newCustomName.trim()}\n• Fecha de entrega requerida: ${newCustomDeadline}\n\nPor favor, ingrese al sistema a través del siguiente enlace para realizar el seguimiento y registrar los avances:\n${calendarLink}\n\nAtentamente,\nSistema de Gestión de Calidad (SGC)\nCrucianelli`,
        type: 'assignment'
      }).catch(err => console.error('Notification failed:', err));

      // Reset
      setNewCustomName('');
      setNewCustomResp('');
      setNewCustomDeadline('');
      setShowAddModal(false);
    } catch (err) {
      console.error('Error adding custom task:', err);
      alert('No se pudo guardar la tarea personalizada.');
    } finally {
      setAddingCustom(false);
    }
  };

  // Admin Action: Migrate Risks task into 7 area tasks
  const handleMigrateRiesgos = async () => {
    if (!id || risksTasksToMigrate.length === 0) return;
    if (!window.confirm('¿Desea dividir la tarea de "Gestión de Riesgos y oportunidades" en las 7 áreas predeterminadas (IT, Calidad, Comercial, Ingeniería, Producción, RRHH, Supply Chain) de forma automática?')) return;

    setMigratingRiesgos(true);
    try {
      const areas = [
        'IT',
        'Calidad',
        'Comercial',
        'Ingeniería',
        'Producción',
        'RRHH',
        'Supply Chain'
      ];

      for (const oldTask of risksTasksToMigrate) {
        const deadlineDate = (oldTask.deadline && typeof oldTask.deadline.toDate === 'function') 
          ? oldTask.deadline.toDate() 
          : new Date(oldTask.deadline);

        for (let i = 0; i < areas.length; i++) {
          const areaName = areas[i];
          const newTaskId = `riesgos_migrated_${oldTask.id}_${i}_${Date.now()}`;
          const newTaskRef = doc(db, 'iso_calendars', id, 'tasks', newTaskId);

          const newTaskData = {
            id: newTaskId,
            calendarId: id,
            year: oldTask.year || calendar?.year || new Date().getFullYear(),
            name: `Gestión de Riesgos y oportunidades - ${areaName}`,
            originalTaskName: `Gestión de Riesgos y oportunidades - ${areaName}`,
            frequency: oldTask.frequency || 'Anual',
            instanceLabel: oldTask.instanceLabel || 'Instancia Anual',
            responsibleId: oldTask.responsibleId,
            responsibleEmail: oldTask.responsibleEmail,
            responsibleName: oldTask.responsibleName,
            deadline: deadlineDate,
            status: 'No iniciado',
            comments: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          await setDoc(newTaskRef, newTaskData);
        }

        // Delete original task
        await deleteDoc(doc(db, 'iso_calendars', id, 'tasks', oldTask.id));
      }

      alert('¡Migración completada con éxito! La tarea única de Riesgos ha sido dividida en las 7 áreas independientes.');
      await loadData();
    } catch (err) {
      console.error('Error migrating risks:', err);
      alert('Ocurrió un error al intentar migrar las tareas de riesgos.');
    } finally {
      setMigratingRiesgos(false);
    }
  };

  // Admin Action: Open Admin Edit Modal
  const handleOpenAdminEdit = (task: ISOTask) => {
    // Once finalized, tasks can no longer be edited
    const isCompleted = task.status === 'Finalizada' || task.status === 'Finalizado';
    if (isCompleted) return;

    setAdminEditTask(task);
    setAdminEditResp(task.responsibleId);
    
    const dVal = (task.deadline && typeof task.deadline.toDate === 'function') ? task.deadline.toDate() : new Date(task.deadline);
    setAdminEditDeadline(dVal.toISOString().split('T')[0]);
    setShowAdminEditModal(true);
  };

  // Admin Action: Save Date & Responsible
  const handleSaveAdminEdit = async () => {
    if (!adminEditTask || !id) return;

    setSavingAdminEdit(true);
    try {
      const respUser = users.find(u => u.id === adminEditResp);
      if (!respUser) return;

      const targetDate = new Date(adminEditDeadline + 'T12:00:00');
      const taskRef = doc(db, 'iso_calendars', id, 'tasks', adminEditTask.id);

      await updateDoc(taskRef, {
        responsibleId: respUser.id,
        responsibleEmail: respUser.email,
        responsibleName: respUser.displayName,
        deadline: targetDate,
        updatedAt: serverTimestamp()
      });

      // Local update
      setTasks(tasks.map(t => {
        if (t.id === adminEditTask.id) {
          return {
            ...t,
            responsibleId: respUser.id,
            responsibleEmail: respUser.email,
            responsibleName: respUser.displayName,
            deadline: targetDate
          };
        }
        return t;
      }).sort((a, b) => {
        const dateA = (a.deadline && typeof a.deadline.toDate === 'function') ? a.deadline.toDate() : new Date(a.deadline);
        const dateB = (b.deadline && typeof b.deadline.toDate === 'function') ? b.deadline.toDate() : new Date(b.deadline);
        return dateA.getTime() - dateB.getTime();
      }));

      // Notify the updated user if changed
      if (respUser.id !== adminEditTask.responsibleId) {
        const calendarLink = id ? generateCalendarLink(id, adminEditTask.id) : '';
        await sendNotification({
          to: respUser.email,
          subject: `[SGC Crucianelli] Reasignación de Tarea ISO - Planificación ${calendar?.year}`,
          body: `Estimado responsable,\n\nLe informamos que se le ha reasignado la tarea ISO "${adminEditTask.name}" con fecha límite de entrega para el ${adminEditDeadline}.\n\nPor favor, ingrese al sistema a través del siguiente enlace para realizar el seguimiento, reportar avances y registrar los comentarios correspondientes:\n${calendarLink}\n\nAtentamente,\nSistema de Gestión de Calidad (SGC)\nCrucianelli`,
          type: 'assignment'
        }).catch(err => console.error('Notification failed:', err));
      }

      setShowAdminEditModal(false);
      setAdminEditTask(null);
    } catch (err) {
      console.error('Error saving admin edits:', err);
      alert('Error al guardar las modificaciones administrativas.');
    } finally {
      setSavingAdminEdit(false);
    }
  };

  // Format Helpers
  const formatDeadline = (dl: any) => {
    if (!dl) return 'Sin fecha';
    const d = (dl && typeof dl.toDate === 'function') ? dl.toDate() : new Date(dl);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatCompletionDate = (dl: any) => {
    if (!dl) return '';
    const d = (dl && typeof dl.toDate === 'function') ? dl.toDate() : new Date(dl);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getDeadlineBadge = (dl: any, status: string) => {
    if (status === 'Finalizada' || status === 'Finalizado') {
      return { text: 'Completada', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (!dl) return { text: 'Sin fecha', className: 'bg-slate-50 text-slate-500 border-slate-200' };
    
    const target = new Date((dl && typeof dl.toDate === 'function') ? dl.toDate() : dl);
    target.setHours(0,0,0,0);
    const now = new Date();
    now.setHours(0,0,0,0);
    
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { 
        text: `Vencida por ${Math.abs(diffDays)} ${Math.abs(diffDays) === 1 ? 'día' : 'días'}`, 
        className: 'bg-red-50 text-red-700 border border-red-200 font-bold' 
      };
    } else if (diffDays === 0) {
      return { 
        text: 'Vence HOY', 
        className: 'bg-amber-50 text-amber-700 border border-amber-300 font-bold animate-pulse' 
      };
    } else if (diffDays <= 5) {
      return { 
        text: `Vence en ${diffDays} d`, 
        className: 'bg-orange-50 text-orange-700 border border-orange-200 font-medium' 
      };
    } else {
      return { 
        text: `A tiempo (${diffDays} d)`, 
        className: 'bg-slate-100 text-slate-600 border border-slate-200' 
      };
    }
  };

  // Stats calculation
  const totalTasksCount = tasks.length;
  const completedCount = tasks.filter(t => t.status === 'Finalizada' || t.status === 'Finalizado').length;
  const progressPercent = totalTasksCount > 0 ? Math.round((completedCount / totalTasksCount) * 100) : 0;

  // Split tasks into groups for statistics overview
  const totalAudits = tasks.filter(t => t.originalTaskName === 'Auditoría Interna' || t.name.startsWith('Auditoría Interna')).length;
  const completedAudits = tasks.filter(t => (t.originalTaskName === 'Auditoría Interna' || t.name.startsWith('Auditoría Interna')) && (t.status === 'Finalizada' || t.status === 'Finalizado')).length;
  
  const totalSgc = tasks.filter(t => t.originalTaskName !== 'Auditoría Interna' && !t.name.startsWith('Auditoría Interna')).length;
  const completedSgc = tasks.filter(t => t.originalTaskName !== 'Auditoría Interna' && !t.name.startsWith('Auditoría Interna') && (t.status === 'Finalizada' || t.status === 'Finalizado')).length;

  // S-Curve Plan vs. Actual progress calculation
  const currentCalendarYear = calendar?.year || new Date().getFullYear();
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  
  const sCurveData = monthNames.map((month, index) => {
    let plannedCumulative = 0;
    let actualCumulative = 0;

    tasks.forEach(task => {
      // 1. Calculate Planned Cumulative (how many tasks should be completed on or before this month)
      if (task.deadline) {
        const dDate = typeof task.deadline.toDate === 'function' ? task.deadline.toDate() : new Date(task.deadline);
        const dYear = dDate.getFullYear();
        const dMonth = dDate.getMonth();
        if (dYear < currentCalendarYear) {
          plannedCumulative++;
        } else if (dYear === currentCalendarYear && dMonth <= index) {
          plannedCumulative++;
        }
      }

      // 2. Calculate Actual Cumulative (how many tasks were actually completed on or before this month)
      if (task.status === 'Finalizado' || task.status === 'Finalizada') {
        if (task.completedAt) {
          const compDate = typeof task.completedAt.toDate === 'function' ? task.completedAt.toDate() : new Date(task.completedAt);
          const compYear = compDate.getFullYear();
          const compMonth = compDate.getMonth();
          if (compYear < currentCalendarYear) {
            actualCumulative++;
          } else if (compYear === currentCalendarYear && compMonth <= index) {
            actualCumulative++;
          }
        } else {
          // Fallback if status is finished but no completedAt timestamp exists
          if (task.deadline) {
            const dDate = typeof task.deadline.toDate === 'function' ? task.deadline.toDate() : new Date(task.deadline);
            const dYear = dDate.getFullYear();
            const dMonth = dDate.getMonth();
            if (dYear < currentCalendarYear) {
              actualCumulative++;
            } else if (dYear === currentCalendarYear && dMonth <= index) {
              actualCumulative++;
            }
          } else {
            actualCumulative++;
          }
        }
      }
    });

    const plannedPercent = totalTasksCount > 0 ? Math.round((plannedCumulative / totalTasksCount) * 100) : 0;
    const actualPercent = totalTasksCount > 0 ? Math.round((actualCumulative / totalTasksCount) * 100) : 0;

    return {
      name: month,
      'Planificado (unidades)': plannedCumulative,
      'Real (unidades)': actualCumulative,
      'Planificado (%)': plannedPercent,
      'Real (%)': actualPercent,
    };
  });

  // Filter tasks locally based on search, active filters, AND ACTIVE TAB
  const filteredTasks = tasks.filter(task => {
    // 1. Tab segregation
    const isAudit = task.originalTaskName === 'Auditoría Interna' || task.name.startsWith('Auditoría Interna');
    if (activeTab === 'audits' && !isAudit) return false;
    if (activeTab === 'sgc' && isAudit) return false;

    // 2. Status Filter
    if (statusFilter !== 'All') {
      const matchNoIniciado = statusFilter === 'No iniciado' && (task.status === 'No iniciado' || task.status === 'No iniciada');
      const matchEnProceso = statusFilter === 'En proceso' && task.status === 'En proceso';
      const matchFinalizado = statusFilter === 'Finalizado' && (task.status === 'Finalizado' || task.status === 'Finalizada');
      if (!matchNoIniciado && !matchEnProceso && !matchFinalizado) return false;
    }

    // 3. Responsibility Filter
    if (respFilter === 'mine' && task.responsibleId !== user.id) return false;

    // 4. Search query
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      const matchesName = task.name.toLowerCase().includes(q);
      const matchesResp = task.responsibleName.toLowerCase().includes(q);
      const matchesLabel = (task.instanceLabel || '').toLowerCase().includes(q);
      if (!matchesName && !matchesResp && !matchesLabel) return false;
    }

    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-slate-500 gap-3">
        <Loader2 className="animate-spin text-purple-600" size={36} />
        <p className="font-semibold text-sm">Cargando planificación detallada e instancias...</p>
      </div>
    );
  }

  if (error || !calendar) {
    return (
      <div className="max-w-md mx-auto p-8 bg-white border border-red-100 rounded-3xl text-center shadow-lg space-y-4">
        <AlertCircle size={48} className="text-red-500 mx-auto" />
        <h2 className="text-xl font-extrabold text-slate-800">Error en la carga</h2>
        <p className="text-slate-500 text-sm leading-relaxed">{error || 'No se pudo cargar la planificación ISO.'}</p>
        <button
          onClick={() => navigate('/')}
          className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-6 py-2 rounded-xl text-sm transition-colors cursor-pointer"
        >
          Volver
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      {/* Navigation header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-semibold transition-colors cursor-pointer w-fit"
        >
          <ArrowLeft size={16} />
          Volver a Planificaciones
        </button>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors shadow-md shadow-purple-100 cursor-pointer"
            >
              <PlusCircle size={15} />
              Añadir Tarea Ad-Hoc
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              title="Eliminar planificación completa"
            >
              <Trash2 size={15} />
              Eliminar Calendario
            </button>
          </div>
        )}
      </div>

      {/* Hero Header Card */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-visible">
        <div className="p-8 bg-gradient-to-r from-purple-700 via-indigo-700 to-indigo-800 text-white rounded-t-3xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-white/10 rounded-2xl shrink-0">
                <CalendarDays size={32} className="text-purple-100" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-black tracking-tight">{calendar.name}</h1>
                  {calendar.company && (
                    <span className="bg-white/20 text-white text-[11px] font-bold px-2.5 py-1 rounded-full border border-white/25">
                      {calendar.company}
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => {
                        setNewCalendarName(calendar.name);
                        setNewCalendarDescription(calendar.description || '');
                        setShowRenameModal(true);
                      }}
                      className="p-1 text-purple-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                      title="Editar Nombre del Calendario"
                    >
                      <Edit3 size={16} />
                    </button>
                  )}
                </div>
                <p className="text-purple-100 text-xs mt-1">
                  Creado por {calendar.createdBy === user.id ? 'Ti' : (calendar as any).createdByName || 'Administrador'} • Planificación de Auditorías y Rutinas SGC
                </p>
                {calendar.description && (
                  <p className="text-sm text-purple-100/90 mt-2 font-medium italic border-l-2 border-purple-300 pl-3.5 py-0.5 max-w-3xl">
                    {calendar.description}
                  </p>
                )}
                <div className="flex gap-4 mt-3 text-xs text-purple-200 font-medium">
                  <span>Auditorías: <strong>{completedAudits} de {totalAudits}</strong></span>
                  <span>|</span>
                  <span>Actividades SGC: <strong>{completedSgc} de {totalSgc}</strong></span>
                </div>
              </div>
            </div>

            {/* Quick Progress Indicator */}
            <div className="bg-white/10 border border-white/10 p-4 rounded-2xl flex items-center gap-4 shrink-0">
              <div className="space-y-1">
                <span className="text-xs font-bold text-purple-200 uppercase tracking-wider block">Avance de Calendario</span>
                <span className="text-2xl font-black">{progressPercent}%</span>
                <span className="text-[10px] text-purple-100 block">{completedCount} de {totalTasksCount} completados</span>
              </div>
              <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                {/* SVG Radial Progress */}
                <svg className="w-12 h-12 transform -rotate-90">
                  <circle cx="24" cy="24" r="20" fill="transparent" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                  <circle cx="24" cy="24" r="20" fill="transparent" stroke="#fff" strokeWidth="4" 
                    strokeDasharray={2 * Math.PI * 20}
                    strokeDashoffset={2 * Math.PI * 20 * (1 - progressPercent / 100)}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Panel */}
        <div className="p-6 bg-slate-50 border-t border-slate-100">
          <div className="flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center">
            {/* Left: Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase">
                <Filter size={14} />
                Filtrar:
              </div>

              {/* Assignment Filter */}
              <select
                value={respFilter}
                onChange={(e) => setRespFilter(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="All">Todos los responsables</option>
                <option value="mine">Asignadas a Mí</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="All">Todos los estados</option>
                <option value="No iniciado">No iniciados</option>
                <option value="En proceso">En proceso</option>
                <option value="Finalizado">Finalizados</option>
              </select>
            </div>

            {/* Right: Search Input */}
            <div className="relative w-full lg:w-80 shrink-0">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Buscar tarea o responsable..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800"
              />
            </div>
          </div>
        </div>
      </div>

      {/* S-Curve Performance Tracking Card */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden transition-all duration-300">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl mt-0.5">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-800">
                Curva S de Avance (Plan vs. Real)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Porcentaje de avance acumulado mensual en base a plazos comprometidos y ejecuciones reales de la planificación del año {calendar?.year}.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSCurve(!showSCurve)}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            title={showSCurve ? "Contraer gráfico" : "Expandir gráfico"}
          >
            {showSCurve ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showSCurve && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="p-6">
                {totalTasksCount === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                    <BarChart3 size={32} className="text-slate-300" />
                    <span>Aún no hay tareas registradas para generar el gráfico de avance.</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="h-[280px] w-full">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                        <LineChart
                          data={sCurveData}
                          margin={{ top: 20, right: 25, left: -15, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis 
                            dataKey="name" 
                            stroke="#94a3b8" 
                            fontSize={11} 
                            tickLine={false} 
                          />
                          <YAxis 
                            stroke="#94a3b8" 
                            fontSize={11} 
                            tickLine={false} 
                            domain={[0, 100]}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <Tooltip 
                            content={({ active, payload, label }) => {
                              if (active && payload && payload.length) {
                                const data = payload[0].payload;
                                return (
                                  <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-800 shadow-2xl text-xs space-y-2">
                                    <p className="font-extrabold text-slate-300 uppercase tracking-wider">{label}</p>
                                    <div className="space-y-1">
                                      <p className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                                        <span>Planificado Acumulado:</span>
                                        <strong className="text-indigo-300">{data['Planificado (%)']}%</strong>
                                        <span className="text-slate-400">({data['Planificado (unidades)']} de {totalTasksCount})</span>
                                      </p>
                                      <p className="flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                        <span>Real Ejecutado Acumulado:</span>
                                        <strong className="text-emerald-300">{data['Real (%)']}%</strong>
                                        <span className="text-slate-400">({data['Real (unidades)']} de {totalTasksCount})</span>
                                      </p>
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Legend 
                            verticalAlign="top" 
                            height={36} 
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          />
                          {calendar && calendar.year === new Date().getFullYear() && (
                            <ReferenceLine 
                              x={monthNames[new Date().getMonth()]} 
                              stroke="#f59e0b" 
                              strokeDasharray="3 3"
                              label={{ 
                                value: 'Mes Actual', 
                                fill: '#d97706', 
                                position: 'top', 
                                fontSize: 10, 
                                fontWeight: 'bold' 
                              }} 
                            />
                          )}
                          <Line 
                            type="monotone" 
                            dataKey="Planificado (%)" 
                            stroke="#6366f1" 
                            strokeWidth={3} 
                            dot={{ stroke: '#6366f1', strokeWidth: 2, r: 3, fill: '#fff' }}
                            activeDot={{ r: 6 }} 
                            name="Planificado (%)"
                          />
                          <Line 
                            type="monotone" 
                            dataKey="Real (%)" 
                            stroke="#10b981" 
                            strokeWidth={3} 
                            dot={{ stroke: '#10b981', strokeWidth: 2, r: 3, fill: '#fff' }}
                            activeDot={{ r: 6 }} 
                            name="Real Ejecutado (%)"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Dynamic helper legend / insight stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-2xl text-center">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Avance de la Planificación</span>
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-base font-extrabold text-slate-700">{progressPercent}%</span>
                          <span className="text-xs text-slate-400">completado</span>
                        </div>
                      </div>
                      <div className="space-y-0.5 border-t sm:border-t-0 sm:border-x border-slate-200 py-2 sm:py-0">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Brecha de Desempeño (Plan vs Real)</span>
                        <div className="flex items-center justify-center gap-1">
                          {(() => {
                            const currentMonthIdx = new Date().getMonth();
                            const currentMonthData = sCurveData[currentMonthIdx];
                            const planVal = currentMonthData ? currentMonthData['Planificado (%)'] : 100;
                            const realVal = currentMonthData ? currentMonthData['Real (%)'] : progressPercent;
                            const gap = realVal - planVal;
                            
                            return (
                              <>
                                <span className={`text-base font-extrabold ${gap >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                  {gap > 0 ? `+${gap}%` : `${gap}%`}
                                </span>
                                <span className="text-xs text-slate-400">
                                  {gap >= 0 ? 'al día / adelantado' : 'de desvío'}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total de Tareas ISO</span>
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-base font-extrabold text-slate-700">{totalTasksCount}</span>
                          <span className="text-xs text-slate-400">instancias anuales</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* SEGMENTED TAB PANEL to separate Audits and SGC routine activities (Huge readability/visibility improvement) */}
      <div className="flex border-b border-slate-200 bg-slate-100 p-1.5 rounded-2xl gap-1">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center justify-center gap-2 flex-1 py-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'all'
              ? 'bg-white text-slate-800 shadow-md'
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
          }`}
        >
          <LayoutList size={14} />
          Todas las Tareas ({tasks.length})
        </button>
        <button
          onClick={() => setActiveTab('audits')}
          className={`flex items-center justify-center gap-2 flex-1 py-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'audits'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-purple-600 hover:bg-purple-50'
          }`}
        >
          <FileCheck2 size={14} />
          1. Programa de Auditorías Internas ({totalAudits})
        </button>
        <button
          onClick={() => setActiveTab('sgc')}
          className={`flex items-center justify-center gap-2 flex-1 py-3 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'sgc'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-indigo-600 hover:bg-indigo-50'
          }`}
        >
          <ClipboardList size={14} />
          2. Otras Actividades del SGC ({totalSgc})
        </button>
      </div>

      {/* Task Grid / Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h2 className="text-sm sm:text-base font-bold text-slate-800 flex items-center gap-2">
            {activeTab === 'audits' ? (
              <>
                <FileCheck2 size={18} className="text-purple-600" />
                Programa de Auditorías Internas (12 Procesos)
              </>
            ) : activeTab === 'sgc' ? (
              <>
                <ClipboardList size={18} className="text-indigo-600" />
                Planilla de Actividades Rutinarias del SGC
              </>
            ) : (
              <>
                <LayoutList size={18} className="text-slate-600" />
                Planilla Consolidada de Control y Responsabilidad
              </>
            )}
          </h2>
          <span className="text-xs text-slate-400 font-semibold">{filteredTasks.length} de {tasks.length} listados</span>
        </div>

        {filteredTasks.length === 0 ? (
          <div className="p-16 text-center text-slate-400">
            <CheckCircle2 size={36} className="mx-auto text-slate-300 mb-2" />
            <p className="font-semibold text-sm">No se encontraron tareas con los filtros aplicados.</p>
            <p className="text-xs text-slate-400 mt-1">Pruebe modificando su búsqueda o filtros activos.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredTasks.map((task) => {
              const dlBadge = getDeadlineBadge(task.deadline, task.status);
              const isAssignedToMe = task.responsibleId === user.id;
              const isCompleted = task.status === 'Finalizada' || task.status === 'Finalizado';
              const isAudit = task.originalTaskName === 'Auditoría Interna' || task.name.startsWith('Auditoría Interna') || task.name.toLowerCase().includes('auditor');
              const isBlockedAuditInline = isAudit && isCompleted && !isAdmin;
              const canEditStatus = (isAssignedToMe || isAdmin);

              return (
                <div 
                  key={task.id}
                  className={`p-6 hover:bg-slate-50/30 transition-all flex flex-col md:flex-row items-stretch md:items-center justify-between gap-6 border-l-4 ${
                    isAudit ? 'border-l-purple-500' : 'border-l-indigo-500'
                  }`}
                >
                  {/* Left: Info */}
                  <div className="space-y-3 flex-grow">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-extrabold text-slate-800 text-sm sm:text-base leading-snug">{task.name}</h3>
                      
                      <span className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        isAudit 
                          ? 'bg-purple-50 text-purple-700 border-purple-100' 
                          : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                      }`}>
                        {isAudit ? 'Auditoría de Proceso' : 'Actividad Rutinaria'}
                      </span>

                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                        {task.frequency}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-500">
                      {/* Responsible with custom badge */}
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-full flex items-center justify-center shrink-0 border border-slate-200">
                          {task.responsibleName?.charAt(0) || 'U'}
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">Asignado a:</span>{' '}
                          <span className={`font-bold ${isAssignedToMe ? 'text-purple-700' : 'text-slate-700'}`}>
                            {task.responsibleName} {isAssignedToMe && '(Tú)'}
                          </span>
                        </div>
                      </div>

                      {/* Dates section (CRITICAL planned date + actual completion execution date) */}
                      <div className="space-y-1.5 sm:border-l sm:border-slate-100 sm:pl-4">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-400">Fecha Planificada:</span>
                          <span className="font-bold text-slate-800 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                            {formatDeadline(task.deadline)}
                          </span>
                        </div>
                        {(task.status === 'Finalizada' || task.status === 'Finalizado') && task.completedAt && (
                          <div className="flex items-center gap-2">
                            <BadgeCheck size={13} className="text-emerald-500 shrink-0" />
                            <span className="font-medium text-slate-400">Fecha de Ejecución Real:</span>
                            <span className="font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                              {formatCompletionDate(task.completedAt)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Instance metadata (Trimester/Label) */}
                    {task.instanceLabel && (
                      <div className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[11px] font-bold">
                        <Clock size={12} className="text-slate-400 shrink-0" />
                        Instancia / Período: <span className="text-slate-800">{task.instanceLabel}</span>
                      </div>
                    )}

                    {/* Audit Metadata if exists */}
                    {task.auditedPersonnel && (
                      <div className="flex flex-col gap-1.5 p-3.5 bg-purple-50/40 rounded-xl border border-purple-100 text-xs text-slate-700 max-w-3xl">
                        <div className="flex items-center gap-2">
                          <User size={13} className="text-purple-600 shrink-0" />
                          <div>
                            <span className="font-bold text-slate-500 mr-1">Personal Auditado:</span>
                            <span className="font-semibold text-slate-800">{task.auditedPersonnel}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Display extra audit details for all internal audit tasks */}
                    {(task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor')) && (
                      <div className="flex flex-col gap-3 p-4 bg-yellow-50/20 rounded-xl border border-yellow-100 text-xs text-slate-700 max-w-3xl">
                        <span className="text-[10px] font-extrabold text-amber-700 uppercase tracking-wider block">
                          Reporte Detallado de Auditoría ({getAuditProcessName(task.name)})
                        </span>
                        
                        {/* Alcance if customized */}
                        {task.auditScope && (
                          <div className="space-y-1">
                            <span className="font-bold text-slate-600 block">Alcance:</span>
                            <div className="p-2.5 bg-white border border-slate-100 rounded-lg whitespace-pre-line font-medium text-slate-800">
                              {task.auditScope}
                            </div>
                          </div>
                        )}

                        {/* Criterios if customized */}
                        {task.auditCriteria && (
                          <div className="space-y-1">
                            <span className="font-bold text-slate-600 block">Criterios de la Auditoría:</span>
                            <div className="p-2.5 bg-white border border-slate-100 rounded-lg whitespace-pre-line font-medium text-slate-800">
                              {task.auditCriteria}
                            </div>
                          </div>
                        )}

                        {/* Strengths */}
                        {(task as any).strengths && (
                          <div className="space-y-1">
                            <span className="font-bold text-slate-600 block">Fortalezas Encontradas:</span>
                            <div className="p-2.5 bg-white border border-slate-100 rounded-lg whitespace-pre-line font-medium text-slate-800">
                              {(task as any).strengths}
                            </div>
                          </div>
                        )}

                        {/* Opportunities */}
                        {(task as any).opportunities && (task as any).opportunities.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-600 block">Oportunidades de Mejora:</span>
                            <div className="space-y-1">
                              {(task as any).opportunities.map((o: any) => (
                                <div key={o.id} className="p-2 bg-white border border-slate-100 rounded-lg flex justify-between items-center gap-2">
                                  <span className="text-slate-800 font-medium">{o.text}</span>
                                  {o.isConfirmed && (
                                    <a
                                      href={`/findings/${o.linkedFindingId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded border border-emerald-100 shrink-0 text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                                      title="Ver hallazgo en pestaña nueva"
                                    >
                                      Vinculado: #{o.linkedFindingNumber} <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Minor Non-Conformities */}
                        {(task as any).minorNonConformities && (task as any).minorNonConformities.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-600 block">No Conformidades Menores:</span>
                            <div className="space-y-1">
                              {(task as any).minorNonConformities.map((m: any) => (
                                <div key={m.id} className="p-2 bg-white border border-slate-100 rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                                  <div>
                                    <span className="text-slate-800 font-medium block">{m.text}</span>
                                    {m.process && (
                                      <span className="text-[10px] text-slate-500 font-bold">Proceso: {m.process}</span>
                                    )}
                                  </div>
                                  {m.isConfirmed && (
                                    <a
                                      href={`/findings/${m.linkedFindingId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded border border-blue-100 shrink-0 text-[10px] flex items-center gap-1 cursor-pointer self-start sm:self-center transition-colors"
                                      title="Ver hallazgo en pestaña nueva"
                                    >
                                      Vinculado: #{m.linkedFindingNumber} <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Major Non-Conformities */}
                        {(task as any).majorNonConformities && (task as any).majorNonConformities.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-600 block">No Conformidades Mayores:</span>
                            <div className="space-y-1">
                              {(task as any).majorNonConformities.map((m: any) => (
                                <div key={m.id} className="p-2 bg-white border border-slate-100 rounded-lg flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                                  <div>
                                    <span className="text-slate-800 font-medium block">{m.text}</span>
                                    {m.process && (
                                      <span className="text-[10px] text-slate-500 font-bold">Proceso: {m.process}</span>
                                    )}
                                  </div>
                                  {m.isConfirmed && (
                                    <a
                                      href={`/findings/${m.linkedFindingId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="bg-red-50 hover:bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded border border-red-100 shrink-0 text-[10px] flex items-center gap-1 cursor-pointer self-start sm:self-center transition-colors"
                                      title="Ver hallazgo en pestaña nueva"
                                    >
                                      Vinculado: #{m.linkedFindingNumber} <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Audit Report Actions */}
                        <div className="flex flex-wrap items-center gap-2 mt-2 pt-3 border-t border-yellow-200/50">
                          <button
                            type="button"
                            onClick={() => handleDownloadPDF(task)}
                            className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors shadow-xs"
                            title="Descargar Reporte en PDF"
                          >
                            <Download size={13} />
                            Descargar PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEmailModal(task)}
                            className="inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white font-semibold px-3 py-1.5 rounded-lg text-[11px] cursor-pointer transition-colors shadow-xs"
                            title="Compartir Reporte por Email"
                          >
                            <Mail size={13} />
                            Compartir por Email
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Comments line */}
                    {task.comments ? (
                      <div className="flex items-start gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs text-slate-600 max-w-3xl">
                        <MessageSquare size={14} className="text-purple-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-slate-500 mr-1">
                            {(task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor'))
                              ? 'Conclusión de auditoría:'
                              : 'Registro / Comentarios cargados:'}
                          </span>
                          <span className="italic font-medium text-slate-800">"{task.comments}"</span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 block italic pl-1">
                        {(task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor'))
                          ? 'Sin conclusión de auditoría cargada aún.'
                          : 'Sin comentarios ni registros cargados aún.'}
                      </span>
                    )}
                  </div>

                  {/* Right: Badges & Controls */}
                  <div className="flex flex-col md:items-end justify-center gap-3 shrink-0 border-t md:border-none pt-4 md:pt-0 w-full md:w-auto">
                    <div className="flex flex-wrap items-center gap-2 justify-between md:justify-end w-full">
                      {/* Deadline Countdown badge */}
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${dlBadge.className}`}>
                        {dlBadge.text}
                      </span>

                      {(!canEditStatus || isBlockedAuditInline) && (
                        /* State Badge for read-only users */
                        <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                          (task.status === 'Finalizada' || task.status === 'Finalizado') ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-50' :
                          task.status === 'En proceso' ? 'bg-amber-400 text-amber-900 shadow-sm shadow-amber-50' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {task.status === 'Finalizada' || task.status === 'Finalizado' ? 'Finalizado' : task.status === 'No iniciada' ? 'No iniciado' : task.status}
                        </span>
                      )}
                    </div>

                    {canEditStatus && !isBlockedAuditInline ? (
                      /* Inline Editor for authorized users */
                      <div className="flex flex-col sm:flex-row md:flex-col gap-2 bg-slate-50 border border-slate-200 p-3 rounded-xl w-full md:w-56 shadow-sm">
                        <div className="w-full">
                          <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">
                            Estado de la Tarea
                          </label>
                          <select
                            value={task.status === 'Finalizada' || task.status === 'Finalizado' ? 'Finalizado' : task.status === 'No iniciada' ? 'No iniciado' : task.status}
                            onChange={async (e) => {
                              const newStatus = e.target.value;
                              const currentExecDate = task.completedAt 
                                ? getCompletionDateString(task.completedAt) 
                                : new Date().toISOString().split('T')[0];
                              
                              if (newStatus === 'Finalizado' && !task.comments?.trim()) {
                                const comment = prompt('Para declarar la tarea como FINALIZADO, es mandatorio dejar un comentario explicativo/registro:');
                                if (!comment || !comment.trim()) {
                                  alert('Debe especificar un comentario/registro para poder finalizar la tarea.');
                                  return;
                                }
                                await handleUpdateTaskInline(task, newStatus, currentExecDate, comment);
                              } else {
                                await handleUpdateTaskInline(task, newStatus, currentExecDate);
                              }
                            }}
                            className={`w-full bg-white border rounded-lg px-2 py-1 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer ${
                              (task.status === 'Finalizada' || task.status === 'Finalizado') ? 'text-emerald-700 border-emerald-200 bg-emerald-50/50' :
                              task.status === 'En proceso' ? 'text-amber-700 border-amber-200 bg-amber-50/50' :
                              'text-slate-700 border-slate-200'
                            }`}
                          >
                            <option value="No iniciado">No iniciado</option>
                            <option value="En proceso">En proceso</option>
                            <option value="Finalizado">Finalizado</option>
                          </select>
                        </div>

                        <div className="w-full">
                          <label className="block text-[9px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">
                            Fecha Real de Ejecución
                          </label>
                          <input
                            type="date"
                            value={getCompletionDateString(task.completedAt)}
                            onChange={async (e) => {
                              const newDate = e.target.value;
                              await handleUpdateTaskInline(task, task.status, newDate);
                            }}
                            className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
                          />
                        </div>
                      </div>
                    ) : null}

                    {/* Controls Row */}
                    <div className="flex items-center gap-2 self-end">
                      {/* Edit status button (keeps full modal experience accessible) */}
                      {(canEditStatus || isBlockedAuditInline || isAudit) && (
                        <button
                          onClick={() => handleOpenTaskModal(task)}
                          className={`flex items-center gap-1 bg-white hover:bg-slate-100 font-bold px-3 py-1.5 rounded-xl border text-xs transition-colors cursor-pointer ${
                            isCompleted 
                              ? 'text-purple-700 border-purple-200 hover:border-purple-300 hover:bg-purple-50/40' 
                              : 'text-slate-700 border-slate-200'
                          }`}
                          title={isCompleted ? "Ver Reporte y Vincular Hallazgos" : canEditStatus ? "Reportar Avance Detallado" : "Ver Detalle de Tarea"}
                        >
                          {isCompleted ? <ExternalLink size={13} /> : canEditStatus ? <Edit3 size={13} /> : <Eye size={13} />}
                          {isCompleted ? "Ver Reporte / Vincular" : canEditStatus ? "Reportar Avance" : "Ver Detalle"}
                        </button>
                      )}

                      {/* Admin reassign / delete */}
                      {isAdmin && (
                        <>
                          {!isCompleted && (
                            <button
                              onClick={() => handleOpenAdminEdit(task)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer border border-slate-100 hover:border-indigo-100"
                              title="Reasignar o Cambiar Fecha"
                            >
                              <Calendar size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer border border-slate-100 hover:border-red-100"
                            title="Eliminar tarea"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: Report Status / Comments (Responsible or Admin) */}
      <AnimatePresence>
        {selectedTask && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden font-sans flex flex-col max-h-[90vh]"
            >
              {!checkAuditAccess(selectedTask) ? (
                <>
                  <div className="p-6 bg-red-600 text-white flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={20} />
                      <h3 className="font-bold text-lg">Acceso Restringido</h3>
                    </div>
                    <button 
                      onClick={() => setSelectedTask(null)}
                      className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="p-8 text-center space-y-4 flex-1 flex flex-col items-center justify-center">
                    <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-2 shadow-inner border border-red-100">
                      <ShieldAlert size={32} />
                    </div>
                    <h4 className="font-extrabold text-slate-800 text-lg uppercase tracking-tight">Reporte Detallado de Auditoría Protegido</h4>
                    <p className="text-sm text-slate-600 max-w-md leading-relaxed font-medium">
                      Este reporte de auditoría interna de <span className="font-bold text-purple-700">{getAuditProcessName(selectedTask.name)}</span> está configurado con seguridad avanzada. Solo pueden acceder a él los administradores, el auditor responsable y los destinatarios expresamente notificados por correo electrónico.
                    </p>
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl w-full text-left space-y-2 max-w-sm mt-2">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Detalles de la Restricción:</p>
                      <ul className="text-xs text-slate-600 space-y-1.5 font-semibold">
                        <li className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          Tu email: <span className="text-slate-800 font-bold">{user.email}</span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          Responsable: <span className="text-slate-800 font-bold">{selectedTask.responsibleEmail || "No asignado"}</span>
                        </li>
                      </ul>
                    </div>
                    <button
                      onClick={() => setSelectedTask(null)}
                      className="mt-4 px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs cursor-pointer transition-colors"
                    >
                      Entendido / Cerrar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-6 bg-purple-600 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                  <CheckSquare size={20} />
                  <h3 className="font-bold text-lg">Reportar Avance de Tarea</h3>
                </div>
                <button 
                  onClick={() => setSelectedTask(null)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="space-y-1">
                  <p className="text-xs text-purple-600 font-bold uppercase tracking-wide">Tarea seleccionada</p>
                  <h4 className="font-bold text-slate-800 text-base">{selectedTask.name}</h4>
                  <p className="text-xs text-slate-400">Asignado a: {selectedTask.responsibleName}</p>
                </div>

                {isBlockedAudit && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl flex items-start gap-2.5 text-xs font-semibold animate-fade-in shadow-sm">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      Este reporte de auditoría interna se encuentra <span className="font-bold">Finalizado</span> y no puede modificarse más. Solo los usuarios administradores de la aplicación disponen de acceso para editarlo.
                    </div>
                  </div>
                )}

                {/* Status selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Estado de la Tarea</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['No iniciado', 'En proceso', 'Finalizado'].map((s) => {
                      const isActive = taskStatus === s || 
                        (s === 'No iniciado' && taskStatus === 'No iniciada') ||
                        (s === 'Finalizado' && taskStatus === 'Finalizada');
                      return (
                        <button
                          key={s}
                          type="button"
                          disabled={isBlockedAudit}
                          onClick={() => !isBlockedAudit && setTaskStatus(s as any)}
                          className={`py-2 px-3 text-xs font-bold rounded-xl border transition-all text-center ${
                            isBlockedAudit ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                          } ${
                            isActive 
                              ? s === 'Finalizado' ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-100' :
                                s === 'En proceso' ? 'bg-amber-400 text-amber-900 border-amber-400 shadow-md shadow-amber-100' :
                                'bg-slate-600 text-white border-slate-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Date input for Fecha Real de Ejecución */}
                {(taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Fecha Real de Ejecución
                    </label>
                    <input
                      type="date"
                      value={realExecutionDate}
                      disabled={isBlockedAudit}
                      onChange={(e) => setRealExecutionDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                )}
                {selectedTask && (selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor')) && (
                  <div className="space-y-4">
                    <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100/80 space-y-3">
                      <span className="text-[10px] font-extrabold text-purple-700 uppercase tracking-wider block">
                        Datos de Auditoría Interna
                      </span>
                      <div className="grid grid-cols-1 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">
                            Personal Auditado
                          </label>
                          <input
                            type="text"
                            value={auditedPersonnel}
                            disabled={isBlockedAudit}
                            onChange={(e) => setAuditedPersonnel(e.target.value)}
                            className={`w-full bg-white border rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold disabled:opacity-60 disabled:cursor-not-allowed ${
                              (taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && !auditedPersonnel.trim() ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'
                            }`}
                            placeholder="Ej. Juan Pérez, María Gómez"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Extra fields for Internal Audits */}
                    {(isDocumentedInfo || isRRHHAudit || isRevisionDireccion || isInvestigacionDesarrollo || isProduccion || isCalidad || isMedicion || isMantenimiento || isComercializacion || isContextoRiesgos || isPosventa || isCompras || isAuditTask) && (
                      <div className="p-4 bg-amber-50/30 rounded-2xl border border-amber-200/60 space-y-4">
                        <div>
                          <span className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider block mb-1">
                            Objetivo de la auditoría
                          </span>
                          <p className="text-[11px] font-medium text-slate-700 bg-white p-2.5 rounded-xl border border-amber-100 leading-relaxed shadow-sm">
                            {getAuditProcessDetails(selectedTask.name).objective}
                          </p>
                        </div>

                        {/* Alcance de la auditoría */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider block">
                              Alcance
                            </label>
                            <span className="text-[10px] text-slate-400 font-medium italic">Editable</span>
                          </div>
                          <textarea
                            value={auditScope}
                            disabled={isBlockedAudit}
                            onChange={(e) => setAuditScope(e.target.value)}
                            rows={3}
                            className="w-full bg-white border border-amber-200/80 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium shadow-sm leading-relaxed disabled:opacity-60 disabled:cursor-not-allowed"
                            placeholder="Especifique el alcance de la auditoría..."
                          />
                        </div>

                        {/* Criterios de la auditoría */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-extrabold text-amber-800 uppercase tracking-wider block">
                              Criterios de la auditoría
                            </label>
                            <span className="text-[10px] text-slate-400 font-medium italic">Editable</span>
                          </div>
                          <textarea
                            value={auditCriteria}
                            disabled={isBlockedAudit}
                            onChange={(e) => setAuditCriteria(e.target.value)}
                            rows={4}
                            className="w-full bg-white border border-amber-200/80 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium shadow-sm leading-relaxed disabled:opacity-60 disabled:cursor-not-allowed"
                            placeholder="Especifique los criterios de auditoría..."
                          />
                        </div>

                        {/* Guide Information Accordion */}
                        <div className="border border-slate-200 bg-white rounded-xl overflow-hidden shadow-sm">
                          <details className="group">
                            <summary className="flex items-center justify-between p-3 cursor-pointer select-none">
                              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                                📚 Requisitos Aplicables e Información Guía ({getAuditProcessName(selectedTask.name)})
                              </span>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    handleDownloadTemplatePDF(selectedTask);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-sm cursor-pointer transition-all active:scale-95 flex-row"
                                  title="Imprimir lista de verificación para la auditoría"
                                >
                                  <Printer size={13} />
                                  <span>Imprimir Guía</span>
                                </button>
                                <span className="text-slate-400 group-open:rotate-180 transition-transform duration-200">
                                  <ChevronDown size={16} />
                                </span>
                              </div>
                            </summary>
                            <div className="p-3 border-t border-slate-100 bg-slate-50/50 text-[11px] text-slate-700 space-y-3 leading-relaxed">
                              <div>
                                <span className="font-bold text-amber-800 uppercase block mb-1">1. Requisitos Aplicables:</span>
                                <ul className="list-disc pl-4 space-y-0.5">
                                  {getAuditProcessDetails(selectedTask.name).clauses.map((clause, idx) => {
                                    if (clause.startsWith('  ')) {
                                      return (
                                        <li key={idx} className="ml-4 list-circle text-slate-600 font-medium">
                                          {clause.trim()}
                                        </li>
                                      );
                                    }
                                    return (
                                      <li key={idx} className="font-bold text-slate-800">
                                        {clause}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>

                              <div className="space-y-2">
                                <span className="font-bold text-amber-800 uppercase block mb-1">2. Entregables Esperados por Requisito:</span>
                                {getAuditProcessDetails(selectedTask.name).deliverables.map((deliv, idx) => (
                                  <div key={idx} className="space-y-1.5 p-2 bg-white rounded-lg border border-slate-100 shadow-xs">
                                    <span className="font-bold text-slate-800 block">{deliv.title}</span>
                                    <p className="text-slate-600">{deliv.desc}</p>
                                    <p className="font-semibold text-slate-700 mt-1">Evidencia objetiva:</p>
                                    <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
                                      {deliv.evidence.map((ev, evIdx) => (
                                        <li key={evIdx}>{ev}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </details>
                        </div>

                        {/* 3. FORTALEZAS */}
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">
                            💪 Fortalezas Encontradas
                          </label>
                          <p className="text-[10px] text-slate-400 italic mb-1">
                            Situaciones y atributos del sistema de gestión destacables por su buen funcionamiento y su valor con respecto al desempeño general.
                          </p>
                          <textarea
                            value={strengths}
                            disabled={isBlockedAudit}
                            onChange={(e) => setStrengths(e.target.value)}
                            rows={3}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold shadow-sm animate-fade-in disabled:opacity-60 disabled:cursor-not-allowed"
                            placeholder="Describa aquí las fortalezas identificadas..."
                          />
                        </div>

                        {/* 4. OPORTUNIDADES DE MEJORA (OM) */}
                        <div className="space-y-2">
                          <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                            💡 Oportunidades de Mejora (OM)
                          </label>
                          <p className="text-[10px] text-slate-400 italic leading-relaxed">
                            Recomendaciones, no mandatorias, cuyo tratamiento y aplicación quedan a consideración del proceso auditado. Cada oportunidad es un hallazgo que requiere confirmación individual.
                          </p>
                          
                          <div className="space-y-3">
                            {opportunities.map((item, index) => (
                              <div key={item.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 shadow-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-[10px] font-extrabold text-slate-400 uppercase">
                                    Fila #{index + 1}
                                  </span>
                                  {!item.isConfirmed && !isBlockedAudit && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveOpportunity(item.id)}
                                      className="text-red-500 hover:text-red-700 cursor-pointer"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>

                                <textarea
                                  value={item.text}
                                  onChange={(e) => handleUpdateOpportunityText(item.id, e.target.value)}
                                  rows={2}
                                  disabled={item.isConfirmed || isBlockedAudit}
                                  className="w-full bg-slate-50 disabled:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-medium"
                                  placeholder="Detalle de la recomendación..."
                                />

                                {item.isConfirmed ? (
                                  <div className="flex items-center gap-2 bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-bold">
                                    <BadgeCheck size={14} className="text-emerald-600 shrink-0" />
                                    <span>Vinculado con éxito: Acción de Mejora #{item.linkedFindingNumber}</span> <a href={`/findings/${item.linkedFindingId}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-emerald-700 hover:text-emerald-900 underline inline-flex items-center gap-1 text-[10px] shrink-0">Ver <ExternalLink size={10} /></a>
                                  </div>
                                ) : !isBlockedAudit ? (
                                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2.5">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                      Vincular a Módulo de Oportunidades de Mejora
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Responsable de Acción</label>
                                        <UserSelect
                                          users={users}
                                          value={item.responsibleId || ''}
                                          onChange={(userId) => {
                                            const updated = opportunities.map(o => o.id === item.id ? { ...o, responsibleId: userId } : o);
                                            setOpportunities(updated);
                                          }}
                                          placeholder="Seleccione un usuario..."
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Fecha Límite</label>
                                        <input
                                          type="date"
                                          value={item.deadline || ''}
                                          onChange={(e) => {
                                            const updated = opportunities.map(o => o.id === item.id ? { ...o, deadline: e.target.value } : o);
                                            setOpportunities(updated);
                                          }}
                                          className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmFinding('opportunity', item.id, item.text, '', item.responsibleId, item.deadline)}
                                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1 px-3 rounded text-[11px] transition-colors cursor-pointer"
                                    >
                                      Confirmar y Vincular
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                            {!isBlockedAudit && (
                              <button
                                type="button"
                                onClick={handleAddOpportunity}
                                className="w-full border border-dashed border-slate-300 hover:border-slate-400 py-1.5 px-3 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                              >
                                <PlusCircle size={14} />
                                Agregar Oportunidad de Mejora
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 5. NO CONFORMIDAD MENOR (NCm) */}
                        <div className="space-y-2">
                          <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                            ⚠️ No Conformidad Menor <span className="normal-case">(NCm)</span>
                          </label>
                          <div className="space-y-3">
                            {minorNonConformities.map((item, index) => (
                              <div key={item.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 shadow-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-[10px] font-extrabold text-slate-400 uppercase">
                                    Fila #{index + 1}
                                  </span>
                                  {!item.isConfirmed && !isBlockedAudit && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveMinorNonConformity(item.id)}
                                      className="text-red-500 hover:text-red-700 cursor-pointer"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>

                                <textarea
                                  value={item.text}
                                  onChange={(e) => handleUpdateMinorText(item.id, e.target.value)}
                                  rows={2}
                                  disabled={item.isConfirmed || isBlockedAudit}
                                  className="w-full bg-slate-50 disabled:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-medium"
                                  placeholder="Detalle de la no conformidad menor encontrada..."
                                />

                                {item.isConfirmed ? (
                                  <div className="flex items-center gap-2 bg-blue-50 text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 text-xs font-bold">
                                    <BadgeCheck size={14} className="text-blue-600 shrink-0" />
                                    <span>Vinculado con éxito: Hallazgo Menor NC #{item.linkedFindingNumber}</span> <a href={`/findings/${item.linkedFindingId}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-700 hover:text-blue-900 underline inline-flex items-center gap-1 text-[10px] shrink-0">Ver <ExternalLink size={10} /></a>
                                  </div>
                                ) : !isBlockedAudit ? (
                                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2.5">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                      Vincular a Módulo de Acciones Correctivas <span className="normal-case">(NCm)</span>
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Proceso Desvío</label>
                                        <select
                                          value={item.process || ''}
                                          onChange={(e) => {
                                            const updated = minorNonConformities.map(m => m.id === item.id ? { ...m, process: e.target.value } : m);
                                            setMinorNonConformities(updated);
                                          }}
                                          className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] focus:outline-none"
                                        >
                                          <option value="">Seleccione proceso...</option>
                                          {PROCESSES.map(p => (
                                            <option key={p} value={p}>{p}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Responsable Análisis</label>
                                        <UserSelect
                                          users={users}
                                          value={item.responsibleId || ''}
                                          onChange={(userId) => {
                                            const updated = minorNonConformities.map(m => m.id === item.id ? { ...m, responsibleId: userId } : m);
                                            setMinorNonConformities(updated);
                                          }}
                                          placeholder="Seleccione usuario..."
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Fecha Límite</label>
                                        <input
                                          type="date"
                                          value={item.deadline || ''}
                                          onChange={(e) => {
                                            const updated = minorNonConformities.map(m => m.id === item.id ? { ...m, deadline: e.target.value } : m);
                                            setMinorNonConformities(updated);
                                          }}
                                          className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmFinding('minorNonConformity', item.id, item.text, item.process, item.responsibleId, item.deadline)}
                                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-[11px] transition-colors cursor-pointer"
                                    >
                                      Confirmar y Vincular
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                            {!isBlockedAudit && (
                              <button
                                type="button"
                                onClick={handleAddMinorNonConformity}
                                className="w-full border border-dashed border-slate-300 hover:border-slate-400 py-1.5 px-3 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                              >
                                <PlusCircle size={14} />
                                Agregar No Conformidad Menor
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 6. NO CONFORMIDAD MAYOR (NCM) */}
                        <div className="space-y-2">
                          <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                            🚨 No Conformidad Mayor (NCM)
                          </label>
                          <div className="space-y-3">
                            {majorNonConformities.map((item, index) => (
                              <div key={item.id} className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5 shadow-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-[10px] font-extrabold text-slate-400 uppercase">
                                    Fila #{index + 1}
                                  </span>
                                  {!item.isConfirmed && !isBlockedAudit && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveMajorNonConformity(item.id)}
                                      className="text-red-500 hover:text-red-700 cursor-pointer"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>

                                <textarea
                                  value={item.text}
                                  onChange={(e) => handleUpdateMajorText(item.id, e.target.value)}
                                  rows={2}
                                  disabled={item.isConfirmed || isBlockedAudit}
                                  className="w-full bg-slate-50 disabled:bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-medium"
                                  placeholder="Detalle de la no conformidad mayor encontrada..."
                                />

                                {item.isConfirmed ? (
                                  <div className="flex items-center gap-2 bg-red-50 text-red-800 px-3 py-1.5 rounded-lg border border-red-200 text-xs font-bold">
                                    <BadgeCheck size={14} className="text-red-600 shrink-0" />
                                    <span>Vinculado con éxito: Hallazgo Mayor NC #{item.linkedFindingNumber}</span> <a href={`/findings/${item.linkedFindingId}`} target="_blank" rel="noopener noreferrer" className="ml-auto text-red-700 hover:text-red-900 underline inline-flex items-center gap-1 text-[10px] shrink-0">Ver <ExternalLink size={10} /></a>
                                  </div>
                                ) : !isBlockedAudit ? (
                                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2.5">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                      Vincular a Módulo de Acciones Correctivas (NCM)
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Proceso Desvío</label>
                                        <select
                                          value={item.process || ''}
                                          onChange={(e) => {
                                            const updated = majorNonConformities.map(m => m.id === item.id ? { ...m, process: e.target.value } : m);
                                            setMajorNonConformities(updated);
                                          }}
                                          className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] focus:outline-none"
                                        >
                                          <option value="">Seleccione proceso...</option>
                                          {PROCESSES.map(p => (
                                            <option key={p} value={p}>{p}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Responsable Análisis</label>
                                        <UserSelect
                                          users={users}
                                          value={item.responsibleId || ''}
                                          onChange={(userId) => {
                                            const updated = majorNonConformities.map(m => m.id === item.id ? { ...m, responsibleId: userId } : m);
                                            setMajorNonConformities(updated);
                                          }}
                                          placeholder="Seleccione usuario..."
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Fecha Límite</label>
                                        <input
                                          type="date"
                                          value={item.deadline || ''}
                                          onChange={(e) => {
                                            const updated = majorNonConformities.map(m => m.id === item.id ? { ...m, deadline: e.target.value } : m);
                                            setMajorNonConformities(updated);
                                          }}
                                          className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmFinding('majorNonConformity', item.id, item.text, item.process, item.responsibleId, item.deadline)}
                                      className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-[11px] transition-colors cursor-pointer"
                                    >
                                      Confirmar y Vincular
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                            {!isBlockedAudit && (
                              <button
                                type="button"
                                onClick={handleAddMajorNonConformity}
                                className="w-full border border-dashed border-slate-300 hover:border-slate-400 py-1.5 px-3 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                              >
                                <PlusCircle size={14} />
                                Agregar No Conformidad Mayor
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Comments box */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {isAuditTask ? 'Conclusión de auditoría' : 'Registro de Ejecución / Comentarios'}
                    </label>
                    <div className="flex items-center gap-2">
                      {isAuditTask && !isBlockedAudit && (
                        <button
                          type="button"
                          onClick={() => setTaskComments(getAuditConclusionDefault(selectedTask.originalTaskName || selectedTask.name))}
                          className="text-[11px] text-purple-600 hover:text-purple-800 font-semibold hover:underline cursor-pointer"
                          title="Restablecer el texto de la plantilla predeterminada"
                        >
                          Cargar plantilla predeterminada
                        </button>
                      )}
                      {(taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && (
                        <span className="text-[10px] text-red-500 font-bold uppercase animate-pulse">Obligatorio</span>
                      )}
                    </div>
                  </div>
                  {isAuditTask && (
                    <p className="text-[11px] text-slate-500 mb-1.5 leading-relaxed">
                      Plantilla predeterminada editable únicamente por el auditor responsable. Reemplace o complete las secciones entre corchetes según corresponda al resultado de la auditoría.
                    </p>
                  )}
                  <textarea
                    rows={isAuditTask ? 6 : 4}
                    value={taskComments}
                    disabled={isBlockedAudit}
                    onChange={(e) => setTaskComments(e.target.value)}
                    className={`w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium disabled:opacity-60 disabled:cursor-not-allowed ${
                      (taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && !taskComments.trim() ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'
                    }`}
                    placeholder={
                      isAuditTask
                        ? 'Escriba aquí la conclusión de la auditoría, registros finales y consideraciones del auditor...'
                        : 'Escriba aquí los comentarios, links a documentos de la norma, registros, o motivos del avance de la tarea...'
                    }
                  />
                  {(taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && !taskComments.trim() && (
                    <p className="text-[10px] text-red-500 font-bold mt-1.5 flex items-center gap-1">
                      <AlertCircle size={10} />
                      {isAuditTask
                        ? 'Es mandatorio ingresar la conclusión de auditoría para declarar la tarea como FINALIZADO.'
                        : 'Es mandatorio dejar comentarios/registros para declarar la tarea como FINALIZADO.'}
                    </p>
                  )}
                  {(taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && isAuditTask && !auditedPersonnel.trim() && (
                    <p className="text-[10px] text-red-500 font-bold mt-1.5 flex items-center gap-1">
                      <AlertCircle size={10} />
                      Es mandatorio completar el campo de Personal Auditado para declarar la tarea como FINALIZADO.
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  disabled={savingTask}
                >
                  Cancelar
                </button>
                {!isBlockedAudit && (
                  <button
                    type="button"
                    onClick={handleSaveTaskStatus}
                    className="px-6 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-purple-100 cursor-pointer"
                    disabled={savingTask || ((taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && (!taskComments.trim() || (isAuditTask && !auditedPersonnel.trim())))}
                  >
                    {savingTask ? (
                      <>
                        <Loader2 className="animate-spin" size={14} />
                        Guardando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} />
                        Guardar Avance
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Admin Add Task Instance */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden font-sans"
            >
              <div className="p-6 bg-purple-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <PlusCircle size={20} />
                  <h3 className="font-bold text-lg">Nueva Tarea Ad-Hoc</h3>
                </div>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nombre de la Tarea</label>
                  <input
                    type="text"
                    value={newCustomName}
                    onChange={(e) => setNewCustomName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Ej: Auditoría de Planta 3 o Evaluación..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Frecuencia</label>
                    <select
                      value={newCustomFreq}
                      onChange={(e) => setNewCustomFreq(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="Anual">Anual</option>
                      <option value="Semestral">Semestral</option>
                      <option value="Trimestral">Trimestral</option>
                      <option value="Mensual">Mensual</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Fecha Requerida</label>
                    <input
                      type="date"
                      value={newCustomDeadline}
                      onChange={(e) => setNewCustomDeadline(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Responsable Asignado</label>
                  <UserSelect
                    users={users}
                    value={newCustomResp}
                    onChange={(userId) => setNewCustomResp(userId)}
                    placeholder="Seleccionar responsable..."
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  disabled={addingCustom}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomTask}
                  className="px-6 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-purple-100 cursor-pointer"
                  disabled={addingCustom || !newCustomName.trim() || !newCustomResp || !newCustomDeadline}
                >
                  {addingCustom ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Creando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Agregar a Planificación
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Admin Edit Date & Responsible */}
      <AnimatePresence>
        {showAdminEditModal && adminEditTask && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden font-sans"
            >
              <div className="p-6 bg-purple-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Calendar size={20} />
                  <h3 className="font-bold text-lg">Reasignar y Modificar Tarea</h3>
                </div>
                <button 
                  onClick={() => setShowAdminEditModal(false)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wide">Modificando Tarea</span>
                  <span className="text-slate-800 font-bold text-sm block">{adminEditTask.name}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Fecha de Entrega Requerida</label>
                  <input
                    type="date"
                    value={adminEditDeadline}
                    onChange={(e) => setAdminEditDeadline(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Responsable Asignado</label>
                  <UserSelect
                    users={users}
                    value={adminEditResp}
                    onChange={(userId) => setAdminEditResp(userId)}
                    placeholder="Seleccionar responsable..."
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAdminEditModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  disabled={savingAdminEdit}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveAdminEdit}
                  className="px-6 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-purple-100 cursor-pointer"
                  disabled={savingAdminEdit || !adminEditDeadline || !adminEditResp}
                >
                  {savingAdminEdit ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Guardar Modificaciones
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* MODAL: Delete Confirmation */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden font-sans"
            >
              <div className="p-6 bg-red-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={20} />
                  <h3 className="font-bold text-lg">Eliminar Planificación</h3>
                </div>
                <button 
                  onClick={() => setShowDeleteModal(false)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                  disabled={isDeleting}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-600 leading-relaxed">
                  ¿Está seguro de que desea eliminar por completo el calendario <strong className="text-slate-800">"{calendar.name}"</strong>?
                </p>
                <div className="p-3.5 bg-red-50 border border-red-100 rounded-2xl flex gap-3 text-red-700">
                  <ShieldAlert size={20} className="shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-bold">Esta acción es irreversible y destructiva.</p>
                    <p className="opacity-90 font-medium">Se eliminará el calendario de planificación anual y TODAS las tareas que se encuentran asignadas bajo este calendario.</p>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  disabled={isDeleting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteCalendar}
                  className="px-6 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-red-100 cursor-pointer"
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Eliminando...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      Confirmar Eliminación
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* MODAL: Rename Calendar */}
        {showRenameModal && calendar && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden font-sans"
            >
              <div className="p-6 bg-gradient-to-r from-purple-700 to-indigo-800 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Calendar size={20} />
                  <h3 className="font-bold text-lg">Editar Info de Planificación</h3>
                </div>
                <button 
                  onClick={() => setShowRenameModal(false)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                  disabled={savingRename}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nombre del Calendario</label>
                  <input
                    type="text"
                    value={newCalendarName}
                    onChange={(e) => setNewCalendarName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold"
                    placeholder="Ej. Planificación ISO 2026 - Fertec"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Descripción del Calendario</label>
                  <textarea
                    value={newCalendarDescription}
                    onChange={(e) => setNewCalendarDescription(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold resize-none"
                    placeholder="Ej. Planificación para Fertec. Incluye cronograma de auditorías y rutinas para Planta Fertec."
                  />
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  disabled={savingRename}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleRenameCalendar}
                  className="px-6 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-purple-100 cursor-pointer"
                  disabled={savingRename || !newCalendarName.trim()}
                >
                  {savingRename ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Guardar Info
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* MODAL: Email Share Audit Report */}
        {showEmailModal && emailTask && calendar && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden font-sans flex flex-col max-h-[90vh]"
            >
              <div className="p-6 bg-gradient-to-r from-slate-800 to-slate-950 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                  <Mail size={20} className="text-amber-500" />
                  <div>
                    <h3 className="font-bold text-sm">Compartir Informe de Auditoría</h3>
                    <p className="text-[10px] text-slate-300 font-medium">Proceso: {getAuditProcessName(emailTask.name)}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowEmailModal(false)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                  disabled={emailSending}
                >
                  <X size={20} />
                </button>
              </div>

              {emailSuccess ? (
                <div className="p-8 text-center space-y-4 flex-1 overflow-y-auto">
                  <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto border border-emerald-100 shadow-xs">
                    <CheckCircle2 size={32} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-slate-900 font-extrabold text-base">¡Reporte Enviado!</h4>
                    <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                      El informe de auditoría se ha enviado exitosamente a todos los destinatarios seleccionados.
                    </p>
                  </div>
                  <div className="pt-4">
                    <button
                      type="button"
                      onClick={() => setShowEmailModal(false)}
                      className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer transition-all shadow-md shadow-slate-100"
                    >
                      Aceptar y Cerrar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                  {emailError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-100 text-rose-800 text-xs font-semibold rounded-xl flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{emailError}</span>
                    </div>
                  )}

                  {/* Recipients Selection */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Seleccionar Usuarios del Sistema
                      </label>
                      {users.length > 0 && (
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                          {users.length} usuarios
                        </span>
                      )}
                    </div>

                    {/* Search bar inside modal */}
                    <div className="relative">
                      <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={emailUserSearch}
                        onChange={(e) => setEmailUserSearch(e.target.value)}
                        placeholder="Buscar usuario por nombre o correo..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
                      />
                      {emailUserSearch && (
                        <button
                          type="button"
                          onClick={() => setEmailUserSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    <div className="border border-slate-100 rounded-2xl max-h-[140px] overflow-y-auto p-2 bg-slate-50/50 space-y-1">
                      {filteredEmailUsers.length === 0 ? (
                        <span className="text-xs text-slate-400 font-medium p-4 block italic text-center">
                          {users.length === 0 ? 'No hay usuarios cargados' : 'No se encontraron usuarios coincidentes'}
                        </span>
                      ) : (
                        filteredEmailUsers.map((u) => {
                          const isSelected = emailRecipients.includes(u.email);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setEmailRecipients(prev => prev.filter(email => email !== u.email));
                                } else {
                                  setEmailRecipients(prev => [...prev, u.email]);
                                }
                              }}
                              className={`w-full text-left p-2 rounded-xl transition-all flex justify-between items-center text-xs font-medium border cursor-pointer ${
                                isSelected 
                                  ? 'bg-amber-50/40 border-amber-200 text-amber-900' 
                                  : 'bg-white border-transparent text-slate-700 hover:bg-slate-100/50'
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-bold">{u.displayName}</span>
                                <span className="text-[10px] text-slate-400 font-medium">{u.email}</span>
                              </div>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                isSelected ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-300 bg-white'
                              }`}>
                                {isSelected && <CheckSquare size={10} className="stroke-[3]" />}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Manual Custom Emails Input */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Correos Adicionales (Separados por comas)
                    </label>
                    <input
                      type="text"
                      value={customEmailInput}
                      onChange={(e) => setCustomEmailInput(e.target.value)}
                      placeholder="ejemplo@empresa.com, auditor@certificador.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold"
                    />
                  </div>

                  {/* Custom message text area */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Mensaje de Introducción para el Email
                    </label>
                    <textarea
                      value={emailCustomMessage}
                      onChange={(e) => setEmailCustomMessage(e.target.value)}
                      rows={3}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 font-semibold resize-none"
                      placeholder="Ingrese un mensaje opcional para los destinatarios..."
                    />
                  </div>
                </div>
              )}

              {!emailSuccess && (
                <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                    disabled={emailSending}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSendEmailReport}
                    className="px-6 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-slate-100 cursor-pointer"
                    disabled={emailSending}
                  >
                    {emailSending ? (
                      <>
                        <Loader2 className="animate-spin" size={14} />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send size={13} />
                        Enviar Reporte
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

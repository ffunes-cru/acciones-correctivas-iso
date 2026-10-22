import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, doc, updateDoc, serverTimestamp, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, UserRole, ISOCalendar, ISOTask } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CalendarDays, ClipboardList, PlusCircle, LayoutDashboard, Loader2, 
  CheckCircle2, AlertCircle, Clock, ChevronRight, User, AlertTriangle, 
  Sparkles, ShieldCheck, CheckSquare, X, MessageSquare, Trash2, ShieldAlert
} from 'lucide-react';
import { sendNotification } from '../services/notificationService';
import { getAuditConclusionDefault } from '../utils/auditProcessDetails';

interface ISODashboardProps {
  user: UserProfile;
}

interface CalendarWithStats extends ISOCalendar {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  progressPercent: number;
}

export default function ISODashboard({ user }: ISODashboardProps) {
  const navigate = useNavigate();
  const [calendars, setCalendars] = useState<CalendarWithStats[]>([]);
  const [myTasks, setMyTasks] = useState<ISOTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit status state (same modal as details for instant action on dashboard)
  const [selectedTask, setSelectedTask] = useState<ISOTask | null>(null);
  const [taskStatus, setTaskStatus] = useState<'No iniciado' | 'En proceso' | 'Finalizado' | 'No iniciada' | 'Finalizada'>('No iniciado');
  const [taskComments, setTaskComments] = useState('');
  const [auditedPersonnel, setAuditedPersonnel] = useState('');
  const [auditReportLink, setAuditReportLink] = useState('');
  const [realExecutionDate, setRealExecutionDate] = useState<string>('');
  const [savingTask, setSavingTask] = useState(false);

  // Deletion state
  const [deletingCalendar, setDeletingCalendar] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isAdmin = user.role === UserRole.ADMIN;
  const isAuditTask = !!(selectedTask && (selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor')));
  const isBlockedAudit = !!(selectedTask &&
    (selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor')) &&
    (selectedTask.status === 'Finalizado' || selectedTask.status === 'Finalizada') &&
    !isAdmin
  );

  const checkAuditAccess = (task: ISOTask) => {
    const isAudit = task.name.toLowerCase().includes('auditor') || task.originalTaskName?.toLowerCase().includes('auditor');
    if (!isAudit) return true;

    const isAssignee = task.responsibleId === user.id || task.responsibleEmail.toLowerCase() === user.email.toLowerCase();
    const isShared = task.sharedEmails && task.sharedEmails.some(email => email.toLowerCase() === user.email.toLowerCase());
    
    return isAdmin || isAssignee || isShared;
  };

  const executeDeleteCalendar = async () => {
    if (!deletingCalendar) return;
    setIsDeleting(true);
    try {
      // 1. Get all tasks for this calendar
      const tasksSnap = await getDocs(collection(db, 'iso_calendars', deletingCalendar.id, 'tasks'));
      
      // 2. Delete tasks in a batch
      const batch = writeBatch(db);
      tasksSnap.docs.forEach(taskDoc => {
        batch.delete(doc(db, 'iso_calendars', deletingCalendar.id, 'tasks', taskDoc.id));
      });
      
      // 3. Delete parent calendar document
      batch.delete(doc(db, 'iso_calendars', deletingCalendar.id));
      
      await batch.commit();
      
      setDeletingCalendar(null);
      await loadDashboardData();
    } catch (err: any) {
      console.error('Error deleting calendar:', err);
      alert('Error al intentar eliminar el calendario: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch all ISO Calendars
      const calSnap = await getDocs(collection(db, 'iso_calendars'));
      const calList = calSnap.docs.map(d => ({ id: d.id, ...d.data() } as ISOCalendar));

      // Sort calendars by year descending
      calList.sort((a, b) => b.year - a.year);

      // 2. Fetch all tasks for each calendar to build stats and aggregate "My Tasks"
      const calendarsWithStats: CalendarWithStats[] = [];
      const aggregatedMyTasks: ISOTask[] = [];
      const now = new Date();
      now.setHours(0,0,0,0);

      for (const cal of calList) {
        try {
          const tasksSnap = await getDocs(collection(db, 'iso_calendars', cal.id, 'tasks'));
          const tasksList = tasksSnap.docs.map(d => ({ id: d.id, calendarId: cal.id, ...d.data() } as ISOTask));

          let completed = 0;
          let overdue = 0;

          tasksList.forEach(t => {
            const isCompleted = t.status === 'Finalizada' || t.status === 'Finalizado';
            if (isCompleted) {
              completed++;
            } else {
              // Check overdue
              const targetDate = new Date((t.deadline && typeof t.deadline.toDate === 'function') ? t.deadline.toDate() : t.deadline);
              targetDate.setHours(0,0,0,0);
              if (targetDate.getTime() < now.getTime()) {
                overdue++;
              }

              // Is this assigned to the current user?
              if (t.responsibleId === user.id) {
                aggregatedMyTasks.push(t);
              }
            }
          });

          const total = tasksList.length;
          const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

          calendarsWithStats.push({
            ...cal,
            totalTasks: total,
            completedTasks: completed,
            overdueTasks: overdue,
            progressPercent: progress
          });
        } catch (taskErr) {
          console.error(`Error loading tasks for calendar ${cal.id}:`, taskErr);
          calendarsWithStats.push({
            ...cal,
            totalTasks: 0,
            completedTasks: 0,
            overdueTasks: 0,
            progressPercent: 0
          });
        }
      }

      setCalendars(calendarsWithStats);

      // Sort "My Tasks" by required date ascending
      aggregatedMyTasks.sort((a, b) => {
        const dateA = (a.deadline && typeof a.deadline.toDate === 'function') ? a.deadline.toDate() : new Date(a.deadline);
        const dateB = (b.deadline && typeof b.deadline.toDate === 'function') ? b.deadline.toDate() : new Date(b.deadline);
        return dateA.getTime() - dateB.getTime();
      });
      setMyTasks(aggregatedMyTasks);

    } catch (err: any) {
      console.error('Error loading ISO Dashboard data:', err);
      setError('No se pudo cargar la información del panel ISO.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [user.id]);

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
    if (task.completedAt) {
      const d = (task.completedAt && typeof task.completedAt.toDate === 'function') ? task.completedAt.toDate() : new Date(task.completedAt);
      setRealExecutionDate(d.toISOString().split('T')[0]);
    } else {
      setRealExecutionDate(new Date().toISOString().split('T')[0]);
    }
  };

  const handleSaveTaskStatus = async () => {
    if (!selectedTask) return;

    if (isBlockedAudit) {
      alert('Error: Solo el Administrador de la app puede modificar un reporte de auditoría interna finalizado.');
      return;
    }

    const isFinalizado = taskStatus === 'Finalizado' || taskStatus === 'Finalizada';

    const isCommentRequired = isFinalizado && (isAuditTask ? (!taskComments.trim() && !auditedPersonnel.trim()) : !taskComments.trim());

    if (isCommentRequired) {
      if (isAuditTask) {
        alert('Error: Debe agregar comentarios o completar el campo de Auditoría Interna (Personal Auditado) antes de guardar la tarea como Finalizado.');
      } else {
        alert('Error: Debe agregar un comentario explicativo/registro antes de guardar la tarea como Finalizado.');
      }
      return;
    }

    setSavingTask(true);
    try {
      const taskRef = doc(db, 'iso_calendars', selectedTask.calendarId, 'tasks', selectedTask.id);
      const updates: any = {
        status: taskStatus,
        comments: taskComments,
        auditedPersonnel: auditedPersonnel.trim(),
        auditReportLink: '',
        updatedAt: serverTimestamp()
      };

      if (isFinalizado) {
        updates.completedAt = new Date(realExecutionDate + 'T12:00:00');
      } else {
        updates.completedAt = null;
      }

      await updateDoc(taskRef, updates);

      // Notify admin when a user completes a task
      if (isFinalizado && selectedTask.responsibleId === user.id) {
        const cal = calendars.find(c => c.id === selectedTask.calendarId);
        const calYear = cal ? cal.year : '';
        let auditDetailsText = '';
        if (auditedPersonnel.trim()) {
          auditDetailsText += `Personal auditado: ${auditedPersonnel.trim()}\n`;
        }

        await sendNotification({
          to: 'psantilli@crucianelli.com',
          subject: `Tarea ISO Completada por ${user.displayName}`,
          body: `Hola, se informa que el usuario ${user.displayName} ha completado la tarea ISO "${selectedTask.name}" de la planificación ${calYear}.\n\n${auditDetailsText}Comentarios provistos:\n"${taskComments}"`,
          type: 'verification'
        }).catch(err => console.error('Notification failed:', err));
      }

      // Refresh data to update progress bars and pending list
      await loadDashboardData();
      setSelectedTask(null);
    } catch (err) {
      console.error('Error saving task status from Dashboard:', err);
      alert('Ocurrió un error al guardar la actualización de la tarea.');
    } finally {
      setSavingTask(false);
    }
  };

  const formatDeadline = (dl: any) => {
    if (!dl) return 'Sin fecha';
    const d = (dl && typeof dl.toDate === 'function') ? dl.toDate() : new Date(dl);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const getDaysDiffLabel = (dl: any) => {
    if (!dl) return '';
    const target = new Date((dl && typeof dl.toDate === 'function') ? dl.toDate() : dl);
    target.setHours(0,0,0,0);
    const now = new Date();
    now.setHours(0,0,0,0);
    
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return `Vencida hace ${Math.abs(diffDays)} ${Math.abs(diffDays) === 1 ? 'día' : 'días'}`;
    } else if (diffDays === 0) {
      return 'Vence HOY';
    } else if (diffDays <= 5) {
      return `Vence en ${diffDays} días`;
    } else {
      return `En fecha (${diffDays} días)`;
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Upper Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <CalendarDays className="text-purple-600" size={32} />
            Planificación ISO
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Seguimiento integrado del calendario anual del SGC para la verificación de tareas de baja frecuencia.
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={() => navigate('/new')}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-bold px-5 py-3 rounded-2xl text-sm transition-all shadow-lg shadow-purple-200 shrink-0 cursor-pointer"
          >
            <PlusCircle size={18} />
            Crear Planificación Anual
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-24 text-slate-400 gap-3">
          <Loader2 className="animate-spin text-purple-600" size={36} />
          <p className="font-semibold text-sm">Cargando calendarios de calidad...</p>
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 border border-red-200 text-red-700 rounded-3xl flex items-start gap-2.5 max-w-lg mx-auto">
          <AlertCircle size={24} className="shrink-0" />
          <div>
            <h4 className="font-bold">Error del sistema</h4>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Section: My Pending Tasks (中央ized customized focus point) */}
          {myTasks.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl border-2 border-purple-200 shadow-xl overflow-hidden"
            >
              <div className="px-6 py-4 bg-gradient-to-r from-purple-500 to-indigo-600 text-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Sparkles size={20} className="text-yellow-300 animate-pulse" />
                  <h2 className="font-bold text-sm sm:text-base tracking-tight">Mis Tareas Pendientes del SGC ({myTasks.length})</h2>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider bg-white/20 px-2.5 py-1 rounded-full">Acción Requerida</span>
              </div>

              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {myTasks.map(task => {
                  const targetDate = new Date((task.deadline && typeof task.deadline.toDate === 'function') ? task.deadline.toDate() : task.deadline);
                  const daysDiff = Math.round((targetDate.getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
                  const isOverdue = daysDiff < 0;

                  return (
                    <div 
                      key={task.id}
                      className="p-4 sm:p-5 hover:bg-slate-50 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-sm sm:text-base">{task.name}</span>
                          <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded">
                            {task.frequency}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock size={12} className={isOverdue ? 'text-red-500' : 'text-slate-400'} />
                            F. Requerida: <strong className={isOverdue ? 'text-red-600 font-bold' : 'text-slate-600'}>{formatDeadline(task.deadline)}</strong>
                          </span>
                          <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 rounded ${
                            isOverdue ? 'bg-red-50 text-red-700 border border-red-100' :
                            daysDiff === 0 ? 'bg-amber-50 text-amber-700' : 'text-slate-500'
                          }`}>
                            {getDaysDiffLabel(task.deadline)}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/iso-calendar/${task.calendarId}?taskId=${task.id}`)}
                        className="flex items-center gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold px-4 py-2 rounded-xl text-xs transition-colors cursor-pointer w-full sm:w-auto text-center justify-center border border-purple-100"
                      >
                        <CheckSquare size={14} />
                        Actualizar Avance
                      </button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* Section: Created Annual Planning Calendars */}
          <div>
            <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <ClipboardList size={22} className="text-purple-600" />
              Calendarios de Planificación Activos
            </h2>

            {calendars.length === 0 ? (
              <div className="bg-white rounded-3xl p-16 text-center border border-slate-200 max-w-lg mx-auto space-y-4">
                <CalendarDays size={48} className="text-slate-300 mx-auto" />
                <h3 className="font-extrabold text-slate-800 text-lg">No hay planificaciones activas</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Aún no se han generado calendarios anuales en el SGC. El administrador del sistema puede crear uno nuevo utilizando el botón superior.
                </p>
                {isAdmin && (
                  <button
                    onClick={() => navigate('/new')}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Crear Primer Calendario ISO
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {calendars.map(cal => (
                  <motion.div
                    key={cal.id}
                    whileHover={{ y: -4 }}
                    className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-lg transition-all overflow-hidden flex flex-col justify-between h-72"
                  >
                    <div className="p-6 space-y-4">
                      {/* Top banner */}
                      <div className="flex items-start justify-between">
                        <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                          <CalendarDays size={24} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          {cal.company && (
                            <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full">
                              {cal.company}
                            </span>
                          )}
                          <span className="text-[11px] font-mono font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
                            Año {cal.year}
                          </span>
                          {isAdmin && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingCalendar({ id: cal.id, name: cal.name });
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                              title="Eliminar Planificación Completa"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Info */}
                      <div>
                        <h3 className="text-lg font-black text-slate-800 tracking-tight leading-snug">{cal.name}</h3>
                        {cal.description && (
                          <p className="text-xs text-slate-500 mt-1.5 line-clamp-1 italic font-medium" title={cal.description}>
                            {cal.description}
                          </p>
                        )}
                        <div className="flex gap-4 text-xs text-slate-400 mt-2 font-medium">
                          <span>{cal.totalTasks} Tareas totales</span>
                          <span>•</span>
                          <span className="text-emerald-600 font-bold">{cal.completedTasks} Completas</span>
                          {cal.overdueTasks > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-red-500 font-bold">{cal.overdueTasks} Vencidas</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Progress slider */}
                      <div className="space-y-1.5 pt-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400 font-medium">Progreso General</span>
                          <span className="font-extrabold text-slate-700">{cal.progressPercent}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className="bg-gradient-to-r from-purple-500 to-indigo-600 h-full rounded-full transition-all duration-500"
                            style={{ width: `${cal.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Bottom action trigger */}
                    <button
                      onClick={() => navigate(`/iso-calendar/${cal.id}`)}
                      className="w-full bg-slate-50 hover:bg-purple-50 hover:text-purple-700 p-4 border-t border-slate-100 text-center text-xs font-bold text-slate-600 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      Ver Planificación Completa
                      <ChevronRight size={14} />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* MODAL: Report Status / Comments (aggregated in dashboard) */}
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
                      Este reporte de auditoría interna de <span className="font-bold text-purple-700">{selectedTask.name}</span> está configurado con seguridad avanzada. Solo pueden acceder a él los administradores, el auditor responsable y los destinatarios expresamente notificados por correo electrónico.
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
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                )}

                {/* Specific Fields for Audits */}
                {selectedTask && (selectedTask.name.toLowerCase().includes('auditor') || selectedTask.originalTaskName?.toLowerCase().includes('auditor')) && (
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
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                          placeholder="Ej. Juan Pérez, María Gómez"
                        />
                      </div>
                    </div>
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
                      (taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && !taskComments.trim() && (!isAuditTask || !auditedPersonnel.trim()) ? 'border-red-300 ring-2 ring-red-100' : 'border-slate-200'
                    }`}
                    placeholder={
                      isAuditTask
                        ? 'Escriba aquí la conclusión de la auditoría, registros finales y consideraciones del auditor...'
                        : 'Escriba aquí los comentarios, links a documentos de la norma, registros, o motivos del avance de la tarea...'
                    }
                  />
                  {(taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && !taskComments.trim() && (!isAuditTask || !auditedPersonnel.trim()) && (
                    <p className="text-[10px] text-red-500 font-bold mt-1.5 flex items-center gap-1">
                      <AlertCircle size={10} />
                      {isAuditTask 
                        ? 'Es mandatorio dejar comentarios o completar los campos de auditoría para declarar la tarea como FINALIZADO.'
                        : 'Es mandatorio dejar comentarios/registros para declarar la tarea como FINALIZADO.'}
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
                    disabled={savingTask || ((taskStatus === 'Finalizado' || taskStatus === 'Finalizada') && (isAuditTask ? (!taskComments.trim() && !auditedPersonnel.trim()) : !taskComments.trim()))}
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

        {/* MODAL: Delete Confirmation */}
        {deletingCalendar && (
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
                  onClick={() => setDeletingCalendar(null)}
                  className="p-1 text-white/80 hover:text-white rounded-lg transition-colors cursor-pointer"
                  disabled={isDeleting}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-slate-600 leading-relaxed">
                  ¿Está seguro de que desea eliminar por completo el calendario <strong className="text-slate-800">"{deletingCalendar.name}"</strong>?
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
                  onClick={() => setDeletingCalendar(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  disabled={isDeleting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={executeDeleteCalendar}
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
      </AnimatePresence>
    </div>
  );
}

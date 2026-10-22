import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { UserProfile, UserRole } from '../types';
import { UserSelect } from './UserSelect';
import { motion } from 'motion/react';
import { 
  CalendarDays, User, PlusCircle, Trash2, CheckCircle, ArrowLeft, 
  Loader2, Sparkles, AlertCircle, Calendar, RefreshCw, Layers, ClipboardCheck, ArrowRight,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { sendNotification, generateCalendarLink } from '../services/notificationService';

// 12 Mandatory processes for Internal Audits requested by user
export const ISO_AUDIT_PROCESSES = [
  "Información documentada",
  "Investigación y desarrollo",
  "Producción",
  "Calidad (Control de recepción, Controles de proceso y liberación final de producto, circuito de reclamos de clientes y acciones correctivas)",
  "Procesos de medición",
  "Mantenimiento",
  "Comercialización",
  "Análisis de contexto, partes interesadas y Gestión de riesgos",
  "Posventa",
  "Compras",
  "Recursos Humanos",
  "Revisión por la dirección"
];

// Other default SGC tasks that aren't audits
export const DEFAULT_SGC_ACTIVITIES = [
  { name: 'Revisar y actualizar el Análisis de Contexto y partes interesadas.', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - IT', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - Calidad', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - Comercial', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - Ingeniería', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - Producción', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - RRHH', defaultFrequency: 'Anual' },
  { name: 'Revisar y actualizar el documento de Gestión de Riesgos y oportunidades - Supply Chain', defaultFrequency: 'Anual' },
  { name: 'Realizar Evaluación de proveedores', defaultFrequency: 'Anual' },
  { name: 'Realizar Encuesta de Satisfacción al cliente', defaultFrequency: 'Anual' }
];

interface AuditInstance {
  quarter: 'T1' | 'T2' | 'T3' | 'T4';
  plannedDate: string; // YYYY-MM-DD
  responsibleId: string;
}

interface AuditConfig {
  processName: string;
  instances: AuditInstance[];
}

interface SGCActivityConfig {
  id: string;
  name: string;
  frequency: 'Anual' | 'Semestral' | 'Trimestral' | 'Mensual';
  responsibleId: string;
  instances: {
    label: string;
    plannedDate: string; // YYYY-MM-DD
  }[];
}

interface NewISOCalendarProps {
  user: UserProfile;
}

export default function NewISOCalendar({ user }: NewISOCalendarProps) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear() + 1);
  const [company, setCompany] = useState<string>('TMC');
  const [calendarName, setCalendarName] = useState<string>(`Planificación ISO TMC ${new Date().getFullYear() + 1}`);
  const [calendarDescription, setCalendarDescription] = useState<string>('');
  
  // Audits Config state
  const [audits, setAudits] = useState<AuditConfig[]>([]);
  
  // Other SGC activities config state
  const [sgcActivities, setSgcActivities] = useState<SGCActivityConfig[]>([]);
  
  // Custom task creation state
  const [newCustomName, setNewCustomName] = useState('');
  const [newCustomFreq, setNewCustomFreq] = useState<'Anual' | 'Semestral' | 'Trimestral' | 'Mensual'>('Anual');

  const [loading, setLoading] = useState(false);
  const [fetchingUsers, setFetchingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global actions helper state
  const [globalAuditResponsible, setGlobalAuditResponsible] = useState('');
  const [globalSgcResponsible, setGlobalSgcResponsible] = useState('');

  useEffect(() => {
    // 1. Initialize Audits with 4 quarterly instances for each of the 12 Processes
    const initialAudits = ISO_AUDIT_PROCESSES.map((process) => {
      return {
        processName: process,
        instances: [
          { quarter: 'T1' as const, plannedDate: `${year}-03-15`, responsibleId: '' },
          { quarter: 'T2' as const, plannedDate: `${year}-06-15`, responsibleId: '' },
          { quarter: 'T3' as const, plannedDate: `${year}-09-15`, responsibleId: '' },
          { quarter: 'T4' as const, plannedDate: `${year}-12-15`, responsibleId: '' }
        ]
      };
    });
    setAudits(initialAudits);

    // 2. Initialize SGC Routine Activities
    const initialSgc = DEFAULT_SGC_ACTIVITIES.map((act, index) => {
      const freq = act.defaultFrequency as 'Anual' | 'Semestral' | 'Trimestral' | 'Mensual';
      const instances = generateInstancesForFrequency(freq, year);

      return {
        id: `sgc_${index}_${Date.now()}`,
        name: act.name,
        frequency: freq,
        responsibleId: '',
        instances
      };
    });
    setSgcActivities(initialSgc);

    // 3. Fetch SGC Directory Users
    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const uList = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));

        // Ensure current active user/admin is in the list
        if (auth.currentUser) {
          const currentEmail = auth.currentUser.email || '';
          const currentUid = auth.currentUser.uid;
          const exists = uList.some(u => 
            u.id === currentUid || 
            (u.email && currentEmail && u.email.toLowerCase() === currentEmail.toLowerCase())
          );
          if (!exists && currentEmail) {
            uList.push({
              id: currentUid,
              displayName: auth.currentUser.displayName || currentEmail.split('@')[0] || 'Administrador',
              email: currentEmail,
              role: UserRole.ADMIN,
              createdAt: new Date().toISOString()
            });
          }
        }

        uList.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
        setUsers(uList);
      } catch (err) {
        console.error('Error fetching users:', err);
      } finally {
        setFetchingUsers(false);
      }
    };
    fetchUsers();
  }, [year]);

  // Expanded processes state (keyed by process index)
  const [expandedProcesses, setExpandedProcesses] = useState<Record<number, boolean>>({});

  const toggleProcessExpanded = (idx: number) => {
    setExpandedProcesses(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const handleExpandAll = () => {
    const next: Record<number, boolean> = {};
    ISO_AUDIT_PROCESSES.forEach((_, idx) => {
      next[idx] = true;
    });
    setExpandedProcesses(next);
  };

  const handleCollapseAll = () => {
    setExpandedProcesses({});
  };

  // Handle year changes, recalculate default target dates in lists
  const handleYearChange = (newYear: number) => {
    setYear(newYear);
    setCalendarName(`Planificación ISO ${company} ${newYear}`);
    
    // Update dates in current audits
    setAudits(prev => prev.map(a => ({
      ...a,
      instances: a.instances.map(inst => {
        const parts = inst.plannedDate.split('-');
        return {
          ...inst,
          plannedDate: `${newYear}-${parts[1] || '06'}-${parts[2] || '15'}`
        };
      })
    })));

    // Update dates in current SGC activities
    setSgcActivities(prev => prev.map(act => ({
      ...act,
      instances: generateInstancesForFrequency(act.frequency, newYear)
    })));
  };

  const handleCompanyChange = (newCompany: string) => {
    setCompany(newCompany);
    setCalendarName(`Planificación ISO ${newCompany} ${year}`);
  };

  // Helper to generate default instances for a frequency
  const generateInstancesForFrequency = (freq: string, targetYear: number) => {
    if (freq === 'Anual') {
      return [{ label: 'Instancia Anual', plannedDate: `${targetYear}-11-30` }];
    } else if (freq === 'Semestral') {
      return [
        { label: 'Semestre 1', plannedDate: `${targetYear}-06-30` },
        { label: 'Semestre 2', plannedDate: `${targetYear}-12-15` }
      ];
    } else if (freq === 'Trimestral') {
      return [
        { label: 'Trimestre 1', plannedDate: `${targetYear}-03-31` },
        { label: 'Trimestre 2', plannedDate: `${targetYear}-06-30` },
        { label: 'Trimestre 3', plannedDate: `${targetYear}-09-30` },
        { label: 'Trimestre 4', plannedDate: `${targetYear}-12-15` }
      ];
    } else { // Mensual
      const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
      const labels = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return months.map((m, idx) => ({
        label: labels[idx],
        plannedDate: `${targetYear}-${m}-28`
      }));
    }
  };

  // Reset all audit dates to defaults per quarter
  const handleResetAuditDates = () => {
    setAudits(prev => prev.map(a => ({
      ...a,
      instances: [
        { quarter: 'T1' as const, plannedDate: `${year}-03-15`, responsibleId: a.instances[0]?.responsibleId || '' },
        { quarter: 'T2' as const, plannedDate: `${year}-06-15`, responsibleId: a.instances[1]?.responsibleId || '' },
        { quarter: 'T3' as const, plannedDate: `${year}-09-15`, responsibleId: a.instances[2]?.responsibleId || '' },
        { quarter: 'T4' as const, plannedDate: `${year}-12-15`, responsibleId: a.instances[3]?.responsibleId || '' }
      ]
    })));
  };

  // Apply a single auditor to all 48 internal audit instances
  const handleApplyGlobalAuditor = (userId: string) => {
    setGlobalAuditResponsible(userId);
    if (!userId) return;
    setAudits(prev => prev.map(a => ({
      ...a,
      instances: a.instances.map(inst => ({ ...inst, responsibleId: userId }))
    })));
  };

  // Apply a single coordinator to all routine tasks
  const handleApplyGlobalSgcResponsible = (userId: string) => {
    setGlobalSgcResponsible(userId);
    if (!userId) return;
    setSgcActivities(prev => prev.map(a => ({ ...a, responsibleId: userId })));
  };

  // Update specific audit instance property
  const handleUpdateAuditInstance = (processIdx: number, instanceIdx: number, field: 'plannedDate' | 'responsibleId', value: string) => {
    setAudits(prev => prev.map((a, idx) => {
      if (idx === processIdx) {
        const updatedInstances = [...a.instances];
        updatedInstances[instanceIdx] = {
          ...updatedInstances[instanceIdx],
          [field]: value
        };
        return { ...a, instances: updatedInstances };
      }
      return a;
    }));
  };

  // Remove specific audit instance/quarter
  const handleRemoveAuditInstance = (processIdx: number, instanceIdx: number) => {
    setAudits(prev => prev.map((a, idx) => {
      if (idx === processIdx) {
        const updatedInstances = a.instances.filter((_, i) => i !== instanceIdx);
        return { ...a, instances: updatedInstances };
      }
      return a;
    }));
  };

  // Add back a removed audit instance/quarter
  const handleAddAuditInstance = (processIdx: number, quarter: 'T1' | 'T2' | 'T3' | 'T4') => {
    const defaultDates = {
      T1: `${year}-03-15`,
      T2: `${year}-06-15`,
      T3: `${year}-09-15`,
      T4: `${year}-12-15`
    };
    
    setAudits(prev => prev.map((a, idx) => {
      if (idx === processIdx) {
        if (a.instances.some(inst => inst.quarter === quarter)) return a;
        
        const newInst = {
          quarter,
          plannedDate: defaultDates[quarter],
          responsibleId: ''
        };
        
        const order = { T1: 1, T2: 2, T3: 3, T4: 4 };
        const updatedInstances = [...a.instances, newInst].sort((a, b) => order[a.quarter] - order[b.quarter]);
        return { ...a, instances: updatedInstances };
      }
      return a;
    }));
  };

  // Update specific SGC activity metadata
  const handleUpdateSgcActivity = (id: string, field: 'name' | 'frequency' | 'responsibleId', value: string) => {
    setSgcActivities(prev => prev.map(act => {
      if (act.id === id) {
        if (field === 'frequency') {
          return {
            ...act,
            frequency: value as any,
            instances: generateInstancesForFrequency(value, year)
          };
        }
        return { ...act, [field]: value };
      }
      return act;
    }));
  };

  // Update specific SGC instance planned date
  const handleUpdateSgcInstanceDate = (activityId: string, instanceIdx: number, dateVal: string) => {
    setSgcActivities(prev => prev.map(act => {
      if (act.id === activityId) {
        const updatedInstances = [...act.instances];
        updatedInstances[instanceIdx] = {
          ...updatedInstances[instanceIdx],
          plannedDate: dateVal
        };
        return { ...act, instances: updatedInstances };
      }
      return act;
    }));
  };

  // Add custom SGC activity
  const handleAddCustomActivity = () => {
    if (!newCustomName.trim()) return;
    const newAct: SGCActivityConfig = {
      id: `custom_sgc_${Date.now()}`,
      name: newCustomName.trim(),
      frequency: newCustomFreq,
      responsibleId: '',
      instances: generateInstancesForFrequency(newCustomFreq, year)
    };
    setSgcActivities([...sgcActivities, newAct]);
    setNewCustomName('');
  };

  const handleRemoveSgcActivity = (id: string) => {
    setSgcActivities(sgcActivities.filter(a => a.id !== id));
  };

  // Submit and create calendar
  const handleCreateCalendar = async () => {
    // Validations
    const missingAuditResp = audits.some(a => a.instances.some(inst => !inst.responsibleId));
    if (missingAuditResp) {
      setError('Por favor asigne un responsable/auditor a todos los trimestres de los 12 procesos de Auditoría Interna.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const missingSgcResp = sgcActivities.some(s => !s.responsibleId);
    if (missingSgcResp) {
      setError('Por favor asigne un responsable a todas las actividades rutinarias del SGC.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const calendarId = doc(collection(db, 'iso_calendars')).id;
      const calDocRef = doc(db, 'iso_calendars', calendarId);

      // 1. Save Calendar Base Document
      await setDoc(calDocRef, {
        id: calendarId,
        year,
        company,
        name: calendarName,
        description: calendarDescription,
        createdBy: user.id,
        createdByName: user.displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 2. Generate task subcollection instances
      const batch = writeBatch(db);
      const instancesToNotify: { [userEmail: string]: { taskName: string; deadlineStr: string }[] } = {};

      // A. Add Audit Processes (4 instances per process)
      audits.forEach((aud, processIdx) => {
        aud.instances.forEach((inst, instIdx) => {
          const respUser = users.find(u => u.id === inst.responsibleId);
          if (!respUser) return;

          const taskId = `audit_${processIdx}_q${instIdx}_${Date.now()}`;
          const taskDocRef = doc(db, 'iso_calendars', calendarId, 'tasks', taskId);
          const taskName = `Auditoría Interna: ${aud.processName} - ${inst.quarter}`;
          const targetDate = new Date(inst.plannedDate + 'T12:00:00');

          batch.set(taskDocRef, {
            id: taskId,
            calendarId,
            year,
            name: taskName,
            originalTaskName: 'Auditoría Interna',
            frequency: 'Trimestral',
            instanceLabel: inst.quarter,
            responsibleId: respUser.id,
            responsibleEmail: respUser.email,
            responsibleName: respUser.displayName,
            deadline: targetDate,
            status: 'No iniciado',
            comments: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          if (!instancesToNotify[respUser.email]) {
            instancesToNotify[respUser.email] = [];
          }
          instancesToNotify[respUser.email].push({
            taskName: `${taskName}`,
            deadlineStr: inst.plannedDate
          });
        });
      });

      // B. Add Routine SGC tasks
      sgcActivities.forEach((act) => {
        const respUser = users.find(u => u.id === act.responsibleId);
        if (!respUser) return;

        act.instances.forEach((inst, instIdx) => {
          const taskId = `${act.id}_inst_${instIdx}`;
          const taskDocRef = doc(db, 'iso_calendars', calendarId, 'tasks', taskId);
          const taskName = `${act.name} - ${inst.label}`;
          const targetDate = new Date(inst.plannedDate + 'T12:00:00');

          batch.set(taskDocRef, {
            id: taskId,
            calendarId,
            year,
            name: taskName,
            originalTaskName: act.name,
            frequency: act.frequency,
            instanceLabel: inst.label,
            responsibleId: respUser.id,
            responsibleEmail: respUser.email,
            responsibleName: respUser.displayName,
            deadline: targetDate,
            status: 'No iniciado',
            comments: '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });

          if (!instancesToNotify[respUser.email]) {
            instancesToNotify[respUser.email] = [];
          }
          instancesToNotify[respUser.email].push({
            taskName,
            deadlineStr: inst.plannedDate
          });
        });
      });

      // Commit all generated documents
      await batch.commit();

      // 3. Send out email notifications to users & admin (non-blocking)
      const calendarLink = generateCalendarLink(calendarId);
      const totalCreatedTasks = Object.values(instancesToNotify).reduce((acc, list) => acc + list.length, 0);

      // A. Send confirmation email to the administrator (Sara / psantilli@crucianelli.com)
      const adminBodyText = `Estimada Administradora,\n\n` +
        `Le informamos que la Planificación Anual ISO para el año ${year} ha sido creada y publicada oficialmente con éxito en el Sistema de Gestión de Calidad (SGC).\n\n` +
        `Detalles del cronograma:\n` +
        `• Nombre: ${calendarName || `Planificación ISO ${year}`}\n` +
        `• Año: ${year}\n` +
        `• Cantidad de tareas asignadas en total: ${totalCreatedTasks}\n\n` +
        `Se han enviado las notificaciones automáticas individuales correspondientes a cada uno de los responsables designados para la ejecución de las tareas.\n\n` +
        `Puede acceder al panel de control de la planificación para realizar el seguimiento del avance en tiempo real a través del siguiente enlace:\n` +
        `${calendarLink}\n\n` +
        `Atentamente,\n` +
        `Sistema de Gestión de Calidad (SGC)\n` +
        `Crucianelli`;

      sendNotification({
        to: 'psantilli@crucianelli.com',
        subject: `[SGC Crucianelli] Planificación Anual ISO ${year} Publicada Exitosamente`,
        body: adminBodyText,
        type: 'creation'
      }).catch(err => console.error('Admin notification failed:', err));

      // B. Send notification emails to each assigned user with a formal body and direct link
      for (const email of Object.keys(instancesToNotify)) {
        const list = instancesToNotify[email];
        const bodyText = `Estimado responsable,\n\n` +
          `Le informamos que se ha publicado oficialmente la planificación anual ISO ${year} bajo el Sistema de Gestión de Calidad (SGC) de Crucianelli, y se le han asignado responsabilidades en el cronograma.\n\n` +
          `Detalle de sus tareas asignadas:\n` +
          list.map(item => `• ${item.taskName} (Fecha de Planificación: ${item.deadlineStr})`).join('\n') +
          `\n\nPor favor, ingrese al sistema para realizar el seguimiento, reportar avances y registrar las evidencias de cumplimiento:\n` +
          `${calendarLink}\n\n` +
          `Atentamente,\n` +
          `Sistema de Gestión de Calidad (SGC)\n` +
          `Crucianelli`;

        sendNotification({
          to: email,
          subject: `[SGC Crucianelli] Nueva Asignación de Cronograma ISO - Planificación ${year}`,
          body: bodyText,
          type: 'assignment'
        }).catch(err => console.error('Responsible notification failed:', err));
      }

      navigate('/');
    } catch (err: any) {
      console.error('Error generating calendar:', err);
      setError(`Error al guardar la planificación: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-5xl mx-auto font-sans"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-semibold transition-colors cursor-pointer"
        >
          <ArrowLeft size={16} />
          Volver a Planificaciones
        </button>
        <span className="text-xs font-mono text-purple-600 bg-purple-50 border border-purple-100 px-3.5 py-1 rounded-full font-bold">
          Rol: Administrador SGC
        </span>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-visible mb-8">
        {/* Top Banner */}
        <div className="bg-gradient-to-r from-purple-700 via-indigo-700 to-indigo-800 p-8 text-white rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-2xl">
              <CalendarDays size={32} className="text-purple-100" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Nueva Planificación Anual ISO</h1>
              <p className="text-purple-100 text-xs mt-1">Configure los responsables y las fechas exactas de planificación para todo el año.</p>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Section: Calendar metadata */}
          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Año de Planificación</label>
                <select
                  value={year}
                  onChange={(e) => handleYearChange(parseInt(e.target.value))}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold text-sm cursor-pointer"
                >
                  {[...Array(6)].map((_, idx) => {
                    const yVal = new Date().getFullYear() - 1 + idx;
                    return <option key={yVal} value={yVal}>{yVal}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Empresa</label>
                <select
                  value={company}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold text-sm cursor-pointer"
                >
                  {['TMC', 'Fertec', 'Fabril', 'Leaf', 'Metallo'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nombre del Calendario</label>
                <input
                  type="text"
                  value={calendarName}
                  onChange={(e) => setCalendarName(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold text-sm"
                  placeholder="Ej. Planificación ISO 2026 - Fertec"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Descripción del Calendario (Opcional)</label>
              <textarea
                value={calendarDescription}
                onChange={(e) => setCalendarDescription(e.target.value)}
                rows={2}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold text-sm resize-none animate-none"
                placeholder="Ej. Planificación para Fertec. Incluye cronograma de auditorías y rutinas para Planta Fertec."
              />
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-2 text-xs font-bold">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Auditorías Internas (12 Processes, 4 instances each) */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="space-y-0.5">
                <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                  <ClipboardCheck size={20} className="text-purple-600" />
                  1. Programa de Auditorías Internas
                </h2>
              </div>

              {/* Collapsible and Reset Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExpandAll}
                  className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                >
                  Expandir Todos
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                >
                  Colapsar Todos
                </button>
                <button
                  type="button"
                  onClick={handleResetAuditDates}
                  className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-xs transition-colors cursor-pointer"
                  title="Restablecer fechas de planificación por defecto"
                >
                  <RefreshCw size={12} />
                  Fechas por Defecto
                </button>
              </div>
            </div>

            {/* Audits Collapsible List */}
            <div className="space-y-3">
              {audits.map((audit, idx) => {
                const isExpanded = !!expandedProcesses[idx];
                const assignedCount = audit.instances.filter(inst => inst.responsibleId).length;

                return (
                  <div
                    key={idx}
                    className={`border border-slate-200 rounded-2xl bg-white shadow-sm hover:shadow-md transition-all ${
                      isExpanded ? 'relative z-10' : 'overflow-hidden'
                    }`}
                  >
                    {/* Collapsible Header */}
                    <button
                      type="button"
                      onClick={() => toggleProcessExpanded(idx)}
                      className="w-full text-left p-4 hover:bg-slate-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 focus:outline-none cursor-pointer rounded-t-2xl"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                          Proceso {idx + 1}
                        </span>
                        <h4 className="font-extrabold text-slate-800 text-sm leading-snug">{audit.processName}</h4>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          audit.instances.length === 0
                            ? 'bg-rose-50 text-rose-700 border-rose-100'
                            : assignedCount === audit.instances.length
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : assignedCount > 0
                            ? 'bg-amber-50 text-amber-700 border-amber-100'
                            : 'bg-slate-50 text-slate-400 border-slate-200'
                        }`}>
                          {audit.instances.length === 0
                            ? 'Sin trimestres planificados (Excluido)'
                            : assignedCount === audit.instances.length
                            ? `✓ ${assignedCount} de ${audit.instances.length} planificados`
                            : `${assignedCount} de ${audit.instances.length} planificados`}
                        </span>
                        {isExpanded ? (
                          <ChevronUp size={16} className="text-slate-400" />
                        ) : (
                          <ChevronDown size={16} className="text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Collapsible Content */}
                    {isExpanded && (
                      <div className="p-4 bg-slate-50 border-t border-slate-100 space-y-3 rounded-b-2xl">
                        {/* Missing Quarters / Restorers */}
                        {(() => {
                          const existing = audit.instances.map(inst => inst.quarter);
                          const missing = (['T1', 'T2', 'T3', 'T4'] as const).filter(q => !existing.includes(q));
                          if (missing.length === 0) return null;
                          return (
                            <div className="flex flex-wrap items-center gap-2 pb-1 border-b border-slate-200/60">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                Trimestres excluidos:
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {missing.map(q => (
                                  <button
                                    key={q}
                                    type="button"
                                    onClick={() => handleAddAuditInstance(idx, q)}
                                    className="text-[10px] font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                                    title={`Planificar e incluir ${q}`}
                                  >
                                    <PlusCircle size={11} />
                                    Agregar {q}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {audit.instances.length === 0 ? (
                          <div className="py-6 text-center text-slate-400 text-xs flex flex-col items-center gap-1.5">
                            <Trash2 size={24} className="text-slate-300" />
                            <span>Se han excluido todos los trimestres de este proceso de auditoría para este año.</span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                            {audit.instances.map((inst, instIdx) => {
                              const labels: Record<string, string> = {
                                T1: 'T1 (Ene - Mar)',
                                T2: 'T2 (Abr - Jun)',
                                T3: 'T3 (Jul - Sep)',
                                T4: 'T4 (Oct - Dic)',
                              };

                              return (
                                <div
                                  key={instIdx}
                                  className="bg-white border border-slate-200 rounded-xl p-3 space-y-2 shadow-sm relative focus-within:z-30 hover:z-20"
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                        {inst.quarter}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-medium">
                                        {labels[inst.quarter] || inst.quarter}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveAuditInstance(idx, instIdx)}
                                      className="text-slate-400 hover:text-red-500 p-1 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                      title={`Eliminar planificación de ${inst.quarter}`}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>

                                  {/* Date input */}
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                      Fecha Planificada
                                    </label>
                                    <input
                                      type="date"
                                      value={inst.plannedDate}
                                      onChange={(e) => handleUpdateAuditInstance(idx, instIdx, 'plannedDate', e.target.value)}
                                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                    />
                                  </div>

                                  {/* Auditor input */}
                                  <div id={`auditor-input-${idx}-${instIdx}`}>
                                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                      Auditor Responsable
                                    </label>
                                    <UserSelect
                                      users={users}
                                      value={inst.responsibleId}
                                      onChange={(userId) => handleUpdateAuditInstance(idx, instIdx, 'responsibleId', userId)}
                                      placeholder="Asignar Auditor..."
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: Routine SGC Quality Activities */}
          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="space-y-0.5 pb-2">
              <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                <Layers size={20} className="text-indigo-600" />
                2. Otras Actividades Rutinarias del SGC
              </h2>
              <p className="text-xs text-slate-400">Verificaciones de calidad, reuniones periódicas de revisión de la norma e indicadores.</p>
            </div>

            {/* Activities Config cards list */}
            <div className="space-y-4">
              {sgcActivities.map((act) => (
                <div
                  key={act.id}
                  className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-4"
                >
                  {/* Top: Edit title, frequency, responsible */}
                  <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-200/60 pb-3">
                    <div className="space-y-1 w-full">
                      <input
                        type="text"
                        value={act.name}
                        onChange={(e) => handleUpdateSgcActivity(act.id, 'name', e.target.value)}
                        className="bg-transparent border-none focus:outline-none font-bold text-slate-800 text-sm sm:text-base w-full focus:bg-white focus:ring-1 focus:ring-purple-200 px-1 rounded"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                      {/* Frequency */}
                      <select
                        value={act.frequency}
                        onChange={(e) => handleUpdateSgcActivity(act.id, 'frequency', e.target.value)}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                      >
                        <option value="Anual">Anual</option>
                        <option value="Semestral">Semestral</option>
                        <option value="Trimestral">Trimestral</option>
                        <option value="Mensual">Mensual</option>
                      </select>

                      {/* Coordinator */}
                      <div className="w-48 text-left" id={`coordinator-select-${act.id}`}>
                        <UserSelect
                          users={users}
                          value={act.responsibleId}
                          onChange={(userId) => handleUpdateSgcActivity(act.id, 'responsibleId', userId)}
                          placeholder="Responsable..."
                        />
                      </div>

                      {/* Remove Button */}
                      <button
                        onClick={() => handleRemoveSgcActivity(act.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar actividad"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Bottom: Date instances planning inputs (CRITICAL FOR VISIBILITY & PLANNING DATES) */}
                  <div>
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block mb-2">Planificación de Fechas para cada Instancia:</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {act.instances.map((inst, idx) => (
                        <div 
                          key={idx}
                          className="bg-white border border-slate-100 p-2.5 rounded-xl shadow-sm space-y-1.5 flex flex-col justify-between"
                        >
                          <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">{inst.label}</span>
                          <div className="relative">
                            <input
                              type="date"
                              value={inst.plannedDate}
                              onChange={(e) => handleUpdateSgcInstanceDate(act.id, idx, e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Custom Task Addition tool */}
            <div className="mt-4 p-5 bg-purple-50/50 border border-dashed border-purple-200 rounded-2xl flex flex-col md:flex-row gap-3 items-end">
              <div className="flex-grow w-full">
                <label className="block text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">Nombre de Actividad SGC Adicional</label>
                <input
                  type="text"
                  value={newCustomName}
                  onChange={(e) => setNewCustomName(e.target.value)}
                  className="w-full bg-white border border-purple-200 rounded-xl px-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800 font-semibold"
                  placeholder="Ej: Calibración anual de Balanzas y Ensayos..."
                />
              </div>
              <div className="w-full md:w-48 shrink-0">
                <label className="block text-[10px] font-bold text-purple-700 uppercase tracking-wider mb-1">Frecuencia de Actividad</label>
                <select
                  value={newCustomFreq}
                  onChange={(e) => setNewCustomFreq(e.target.value as any)}
                  className="w-full bg-white border border-purple-200 rounded-xl px-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800 font-semibold"
                >
                  <option value="Anual">Anual</option>
                  <option value="Semestral">Semestral</option>
                  <option value="Trimestral">Trimestral</option>
                  <option value="Mensual">Mensual</option>
                </select>
              </div>
              <button
                onClick={handleAddCustomActivity}
                className="w-full md:w-auto bg-purple-600 hover:bg-purple-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-1 shrink-0 cursor-pointer"
              >
                <PlusCircle size={15} />
                Agregar Actividad
              </button>
            </div>
          </div>

          {/* Stepper controls / Actions Footer */}
          <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100">
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-sm transition-colors cursor-pointer"
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateCalendar}
              disabled={loading || fetchingUsers}
              className="px-8 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold text-sm shadow-lg shadow-purple-200 transition-colors flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Generando Planificación...
                </>
              ) : (
                <>
                  <CheckCircle size={16} />
                  Generar Planificación {year}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

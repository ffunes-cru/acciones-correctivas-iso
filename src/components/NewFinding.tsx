import React, { useState, useEffect } from 'react';
import { collection, serverTimestamp, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, FindingStatus } from '../types';
import { useNavigate } from 'react-router-dom';
import { UserSelect } from './UserSelect';
import { Send, ArrowLeft, Loader2, Sparkles, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { sendNotification, generateFindingLink } from '../services/notificationService';
import { triggerAutoSync } from '../lib/googleWorkspace';

const COMPANIES = ['TMC', 'Fertec', 'Metallo', 'Leaf', 'Fabril'];
const ORIGINS = [
  'Auditoría 5S', 'Auditoría Externa', 'Auditoría Interna', 'Autogenerada',
  'Comunidad', 'Muro/ Control de Calidad', 'Proveedor', 'Queja/Reclamo',
  'Revisión por la dirección', 'Otros'
];
const TYPES = [
  'Multa', 'No conformidad menor', 'No conformidad mayor',
  'Potencial no conformidad', 'Producto no conforme', 'Queja / Reclamo', 'Otros'
];
const PROCESSES = [
  'Administración y Finanzas', 'Calidad', 'Comercial', 'Compras', 'Dirección',
  'Gestión General', 'Ingeniería', 'IT', 'Logística', 'Mantenimiento',
  'Marketing', 'PCP', 'Posventa', 'Producción', 'Repuestos', 'RRHH', 'Otros'
];

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

export default function NewFinding({ user, category }: { user: UserProfile; category?: 'corrective' | 'improvement' | null }) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  
  const isImprovement = category === 'improvement';

  const [formData, setFormData] = useState({
    company: '',
    findingDate: '',
    origin: '',
    type: '',
    process: '',
    description: '',
    analysisResponsibleId: '',
    analysisDeadline: '',
    // Improvement module fields:
    actionDescription: '',
    actionResponsibleId: '',
    actionDeadline: '',
  });

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        setUsers(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
      } catch (err) {
        console.error('Error fetching users:', err);
      }
    };
    fetchUsers();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const getLocalTodayString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Explicit validation of required fields
    if (isImprovement) {
      if (!formData.company || !formData.findingDate || !formData.origin || !formData.description || !formData.actionDescription || !formData.actionResponsibleId || !formData.actionDeadline) {
        alert('Por favor complete todos los campos obligatorios (*) antes de confirmar la carga.');
        return;
      }
    } else {
      if (!formData.company || !formData.findingDate || !formData.origin || !formData.type || !formData.process || !formData.description || !formData.analysisResponsibleId || !formData.analysisDeadline) {
        alert('Por favor complete todos los campos obligatorios (*) antes de confirmar la carga.');
        return;
      }
    }

    // Date validation normalized to midnight local time
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateToCheck = isImprovement ? formData.actionDeadline : formData.analysisDeadline;
    const selectedDate = parseLocalDate(dateToCheck);
    selectedDate.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      alert(`La fecha requerida para ${isImprovement ? 'la ejecución de la acción' : 'el análisis'} no puede ser una fecha pasada.`);
      return;
    }

    setIsSubmitting(true);

    try {
      const counterRef = doc(db, 'config', 'counters');
      
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
          const activeResponsible = users.find(u => u.id === formData.actionResponsibleId);
          
          const findingData = {
            findingNumber: nextNumber,
            findingCategory: 'improvement',
            company: formData.company,
            findingDate: parseLocalDate(formData.findingDate),
            origin: formData.origin,
            type: 'Mejora',
            process: 'Mejora',
            description: formData.description,
            ownerId: user.id,
            ownerEmail: user.email,
            status: FindingStatus.PENDING_ACTION,
            involvedUserIds: [user.id, formData.actionResponsibleId].filter(id => !!id),
            pendingActionUserIds: [formData.actionResponsibleId].filter(id => !!id),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          const actionRef = doc(collection(db, 'findings', newFindingRef.id, 'correctiveActions'));
          const actionData = {
            description: formData.actionDescription,
            responsibleId: formData.actionResponsibleId,
            responsibleEmail: activeResponsible?.email || '',
            deadline: parseLocalDate(formData.actionDeadline),
            status: 'pending',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          transaction.set(newFindingRef, findingData);
          transaction.set(actionRef, actionData);
          transaction.set(counterRef, { lastImprovementNumber: nextNumber }, { merge: true });

          return { id: newFindingRef.id, number: nextNumber, responsible: activeResponsible };
        } else {
          const activeResponsible = users.find(u => u.id === formData.analysisResponsibleId);

          const findingData = {
            findingNumber: nextNumber,
            findingCategory: 'corrective',
            company: formData.company,
            findingDate: parseLocalDate(formData.findingDate),
            origin: formData.origin,
            type: formData.type,
            process: formData.process,
            description: formData.description,
            ownerId: user.id,
            ownerEmail: user.email,
            analysisResponsibleId: formData.analysisResponsibleId,
            analysisResponsibleEmail: activeResponsible?.email || '',
            analysisDeadline: parseLocalDate(formData.analysisDeadline),
            status: FindingStatus.PENDING_ANALYSIS,
            involvedUserIds: [user.id, formData.analysisResponsibleId].filter(id => !!id),
            pendingActionUserIds: [user.id, formData.analysisResponsibleId].filter(id => !!id),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };

          transaction.set(newFindingRef, findingData);
          transaction.set(counterRef, { lastCorrectiveNumber: nextNumber, lastFindingNumber: nextNumber }, { merge: true });

          return { id: newFindingRef.id, number: nextNumber, responsible: activeResponsible };
        }
      });

      // Send notifications
      const link = generateFindingLink(result.id);
      console.log(`[NewFinding] Enviando mails para Hallazgo #${result.number} (${category})`);

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
        const toEmail = result.responsible?.email || result.responsible?.displayName || formData.actionResponsibleId;
        if (toEmail) {
          notificationPromises.push(
            sendNotification({
              to: toEmail,
              subject: `Asignación de Acción de Mejora - Hallazgo #${result.number}`,
              body: `Estimado/a ${result.responsible?.displayName || 'Usuario'}, se le ha asignado una acción de mejora relacionada al hallazgo Número: ${result.number}. Por favor, ingrese al siguiente enlace para ver los detalles: ${link}`,
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
        const toEmail = result.responsible?.email || result.responsible?.displayName || formData.analysisResponsibleId;
        if (toEmail) {
          notificationPromises.push(
            sendNotification({
              to: toEmail,
              subject: `ASIGNACIÓN: Investigación de Causa Raíz - Hallazgo #${result.number}`,
              body: `Estimado/a ${result.responsible?.displayName || 'Usuario'}, se le ha asignado la investigación de causa raíz del hallazgo Número: ${result.number}. Por favor, ingrese al siguiente enlace para completar el análisis: ${generateFindingLink(result.id, 'analysis')}`,
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
            console.error(`[NewFinding] Error en notificación ${idx}:`, res.reason);
          } else {
            console.log(`[NewFinding] Notificación ${idx} enviada:`, res.value);
          }
        });
      });

      triggerAutoSync();
      navigate(`/findings/${result.id}`);
    } catch (error) {
      console.error('Error submitting finding:', error);
      alert('Error al guardar el hallazgo. Por favor intente nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors mb-6 cursor-pointer"
      >
        <ArrowLeft size={20} />
        Volver
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-visible"
      >
        <div className={`p-6 text-white text-center ${isImprovement ? 'bg-emerald-600' : 'bg-blue-600'} rounded-t-2xl`}>
          <div className="flex justify-center mb-2">
            {isImprovement ? <Sparkles size={36} /> : <ShieldAlert size={36} />}
          </div>
          <h1 className="text-2xl font-bold">
            {isImprovement ? 'Cargar Nueva Acción de Mejora' : 'Cargar Nuevo Hallazgo'}
          </h1>
          <p className={`${isImprovement ? 'text-emerald-100' : 'text-blue-100'} mt-1`}>
            {isImprovement 
              ? 'Complete los campos obligatorios para registrar el hallazgo de mejora continua.'
              : 'Complete los campos para registrar un desvío o no conformidad'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Empresa */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Empresa *</label>
              <select 
                name="company" 
                required 
                value={formData.company} 
                onChange={handleChange}
                className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition-all focus:ring-2 ${isImprovement ? 'focus:ring-emerald-500' : 'focus:ring-blue-500'}`}
              >
                <option value="">Seleccione Empresa</option>
                {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Fecha */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Fecha del Hallazgo *</label>
              <input 
                type="date" 
                name="findingDate" 
                required 
                value={formData.findingDate} 
                onChange={handleChange}
                className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition-all focus:ring-2 ${isImprovement ? 'focus:ring-emerald-500' : 'focus:ring-blue-500'}`}
              />
            </div>

            {/* Origen */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Origen *</label>
              <select 
                name="origin" 
                required 
                value={formData.origin} 
                onChange={handleChange}
                className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition-all focus:ring-2 ${isImprovement ? 'focus:ring-emerald-500' : 'focus:ring-blue-500'}`}
              >
                <option value="">Seleccione Origen</option>
                {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {/* If Corrective: select Type and Process */}
            {!isImprovement && (
              <>
                {/* Tipo de Hallazgo */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Tipo de Hallazgo *</label>
                  <select 
                    name="type" 
                    required={!isImprovement} 
                    value={formData.type} 
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleccione Tipo</option>
                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {/* Proceso */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Proceso que genera el desvío *</label>
                  <select 
                    name="process" 
                    required={!isImprovement} 
                    value={formData.process} 
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleccione Proceso</option>
                    {PROCESSES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* Descripción del Hallazgo */}
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-sm font-semibold text-slate-700">Descripción del hallazgo (desvío) *</label>
              <textarea 
                name="description" 
                required 
                rows={3}
                value={formData.description} 
                onChange={handleChange}
                placeholder="Describa detalladamente el problema encontrado..."
                className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none transition-all resize-none focus:ring-2 ${isImprovement ? 'focus:ring-emerald-500' : 'focus:ring-blue-500'}`}
              ></textarea>
            </div>

            {/* Conditional extra parts */}
            {isImprovement ? (
              <div className="md:col-span-2 border-t border-slate-100 pt-6 space-y-6">
                <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                  <h3 className="font-bold text-emerald-800 text-sm flex items-center gap-2 mb-1">
                    <Sparkles size={16} />
                    Acción de Mejora Inicial
                  </h3>
                  <p className="text-emerald-700 text-xs">Cargue la primera acción propuesta para implementar y solucionar este hallazgo de mejora.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Acción de mejora */}
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">Acción de mejora *</label>
                    <textarea 
                      name="actionDescription" 
                      required={isImprovement} 
                      rows={2}
                      value={formData.actionDescription} 
                      onChange={handleChange}
                      placeholder="Describa la acción de mejora a implementar..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all resize-none"
                    ></textarea>
                  </div>

                  {/* Responsable Acción de Mejora */}
                  <div className="space-y-1.5" id="action-responsible-container">
                    <label className="text-sm font-semibold text-slate-700">Responsable de la acción de mejora *</label>
                    <UserSelect
                      users={users}
                      value={formData.actionResponsibleId}
                      onChange={(userId) => setFormData(prev => ({ ...prev, actionResponsibleId: userId }))}
                      placeholder="Seleccione Responsable"
                      required={isImprovement}
                    />
                  </div>

                  {/* Fecha Requerida para Ejecución */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">Fecha requerida para ejecución *</label>
                    <input 
                      type="date" 
                      name="actionDeadline" 
                      required={isImprovement} 
                      min={getLocalTodayString()}
                      value={formData.actionDeadline} 
                      onChange={handleChange}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Asignar Responsable del Análisis */}
                <div className="space-y-1.5" id="analysis-responsible-container">
                  <label className="text-sm font-semibold text-slate-700">Asignar responsable del análisis *</label>
                  <UserSelect
                    users={users}
                    value={formData.analysisResponsibleId}
                    onChange={(userId) => setFormData(prev => ({ ...prev, analysisResponsibleId: userId }))}
                    placeholder="Seleccione Responsable"
                    required={!isImprovement}
                  />
                </div>

                {/* Fecha Requerida para Análisis */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700">Fecha requerida para análisis *</label>
                  <input 
                    type="date" 
                    name="analysisDeadline" 
                    required={!isImprovement} 
                    min={new Date().toISOString().split('T')[0]}
                    value={formData.analysisDeadline} 
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
              </>
            )}
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full flex items-center justify-center gap-2 disabled:bg-slate-400 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg cursor-pointer ${isImprovement ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}
            >
              {isSubmitting ? <Loader2 size={24} className="animate-spin" /> : <Send size={24} />}
              {isImprovement ? 'Confirmar Carga de Acción de Mejora' : 'Confirmar Carga de Hallazgo'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

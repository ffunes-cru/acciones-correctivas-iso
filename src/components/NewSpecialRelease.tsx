import React, { useState, useEffect } from 'react';
import { collection, serverTimestamp, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile } from '../types';
import { UserSelect } from './UserSelect';
import { useNavigate } from 'react-router-dom';
import { 
  Send, ArrowLeft, Loader2, ShieldCheck, ShoppingBag, Box, Users, ClipboardList, 
  PlusCircle, Trash2, Calendar, User, CheckCircle 
} from 'lucide-react';
import { motion } from 'motion/react';
import { triggerAutoSync } from '../lib/googleWorkspace';
import { sendNotification } from '../services/notificationService';

const COMPANIES = ['TMC', 'Fertec', 'Metallo', 'Leaf', 'Fabril'];

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

interface LocalLinkedAction {
  description: string;
  responsibleId: string;
  responsibleName: string;
  deadline: string;
}

export default function NewSpecialRelease({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  
  const [type, setType] = useState<'raw_material' | 'finished_product'>('raw_material');

  const [formData, setFormData] = useState({
    company: '',
    date: new Date().toISOString().split('T')[0],
    deviationDescription: '',
    clientImpact: '',
    
    // Raw Material specific
    purchaseOrderNumber: '',
    code: '',
    description: '',
    vendor: '',

    // Finished Product specific
    ofNumber: '',
    machineModel: '',
    clientDealer: '',
    salesNoteNumber: '',

    // Approvers and notified
    calidadUserId: '',
    ingenieriaUserId: '',
    comercialUserId: '',
    operacionesUserId: '',
    posventaUserId: '',
  });

  // Local corrective actions state
  const [localActions, setLocalActions] = useState<LocalLinkedAction[]>([]);
  const [actionForm, setActionForm] = useState({
    description: '',
    responsibleId: '',
    deadline: '',
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

  const handleAddLocalAction = () => {
    if (!actionForm.description.trim()) {
      alert('Por favor ingrese la descripción de la acción correctiva.');
      return;
    }
    if (!actionForm.responsibleId) {
      alert('Por favor seleccione un responsable para la acción.');
      return;
    }
    if (!actionForm.deadline) {
      alert('Por favor ingrese la fecha límite para la acción.');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDeadline = parseLocalDate(actionForm.deadline);
    if (selectedDeadline < today) {
      alert('La fecha requerida para la acción no puede ser una fecha pasada.');
      return;
    }

    const respUser = users.find(u => u.id === actionForm.responsibleId);
    setLocalActions([
      ...localActions,
      {
        description: actionForm.description,
        responsibleId: actionForm.responsibleId,
        responsibleName: respUser?.displayName || '',
        deadline: actionForm.deadline
      }
    ]);

    // Reset action form fields
    setActionForm({
      description: '',
      responsibleId: '',
      deadline: '',
    });
  };

  const handleRemoveLocalAction = (index: number) => {
    setLocalActions(localActions.filter((_, i) => i !== index));
  };

  const handleSaveRelease = async (targetStatus: 'draft' | 'pending_approval') => {
    if (isSubmitting) return;

    // Basic Validation
    if (!formData.company) {
      alert('Por favor seleccione una Empresa.');
      return;
    }
    if (!formData.deviationDescription.trim()) {
      alert('Por favor complete la Descripción del desvío.');
      return;
    }
    if (!formData.clientImpact.trim()) {
      alert('Por favor complete el Impacto en el cliente o Riesgos.');
      return;
    }

    // Validation for Enviar a Revisión (pending_approval)
    if (targetStatus === 'pending_approval') {
      if (!formData.calidadUserId || !formData.ingenieriaUserId || !formData.comercialUserId || !formData.operacionesUserId) {
        alert('Por favor seleccione todos los aprobadores obligatorios (Calidad, Ingeniería, Comercial, Operaciones) antes de enviar a revisión.');
        return;
      }
      if (!formData.posventaUserId) {
        alert('Por favor seleccione la persona a notificar en Posventa antes de enviar a revisión.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const counterRef = doc(db, 'config', 'counters');
      
      const result = await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        const counterData = counterDoc.exists() ? counterDoc.data() : {};
        
        let lastSRNumber = counterData.lastSpecialReleaseNumber || 0;
        let lastFindingNumber = counterData.lastCorrectiveNumber || counterData.lastFindingNumber || 0;

        const nextSRNumber = lastSRNumber + 1;
        const finalLinkedActions: any[] = [];

        // Save linked actions as actual background findings
        for (const act of localActions) {
          lastFindingNumber += 1;
          const currentFindingNumber = lastFindingNumber;

          const newFindingRef = doc(collection(db, 'findings'));
          const actionRef = doc(collection(db, 'findings', newFindingRef.id, 'correctiveActions'));

          const actionResponsibleUser = users.find(u => u.id === act.responsibleId);

          const findingData = {
            findingNumber: currentFindingNumber,
            findingCategory: 'corrective',
            company: formData.company,
            findingDate: parseLocalDate(formData.date),
            origin: 'Muro/ Control de Calidad',
            type: 'Producto no conforme',
            process: 'Otros',
            description: `Acción vinculada a la Liberación Especial LE-#${nextSRNumber}: desvío de ${type === 'raw_material' ? 'Materia prima' : 'Producto terminado'}. Detalle desvío: ${formData.deviationDescription}`,
            ownerId: user.id,
            ownerEmail: user.email,
            analysisResponsibleId: user.id,
            analysisResponsibleEmail: user.email,
            analysisDeadline: parseLocalDate(formData.date),
            status: 'pending_action', // Direct bypass
            isSpecialRelease: true,
            involvedUserIds: [user.id, act.responsibleId].filter(uid => !!uid),
            pendingActionUserIds: [act.responsibleId].filter(uid => !!uid),
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const actionData = {
            description: act.description,
            responsibleId: act.responsibleId,
            responsibleEmail: actionResponsibleUser?.email || '',
            deadline: parseLocalDate(act.deadline),
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
          };

          transaction.set(newFindingRef, findingData);
          transaction.set(actionRef, actionData);

          finalLinkedActions.push({
            id: actionRef.id,
            findingId: newFindingRef.id,
            findingNumber: currentFindingNumber,
            description: act.description,
            responsibleId: act.responsibleId,
            responsibleName: actionResponsibleUser?.displayName || '',
            deadline: parseLocalDate(act.deadline).toISOString(),
            createdAt: new Date().toISOString()
          });
        }

        const newReleaseRef = doc(collection(db, 'special_releases'));

        const qualityUser = users.find(u => u.id === formData.calidadUserId);
        const engineeringUser = users.find(u => u.id === formData.ingenieriaUserId);
        const commercialUser = users.find(u => u.id === formData.comercialUserId);
        const operationsUser = users.find(u => u.id === formData.operacionesUserId);
        const posventaUser = users.find(u => u.id === formData.posventaUserId);

        const releaseData: any = {
          releaseNumber: nextSRNumber,
          type,
          company: formData.company,
          date: parseLocalDate(formData.date),
          deviationDescription: formData.deviationDescription,
          clientImpact: formData.clientImpact,
          creatorId: user.id,
          creatorEmail: user.email,
          creatorName: user.displayName,
          status: targetStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          approvals: {
            calidad: {
              userId: qualityUser?.id || '',
              userEmail: qualityUser?.email || '',
              userName: qualityUser?.displayName || '',
              status: 'pending'
            },
            ingenieria: {
              userId: engineeringUser?.id || '',
              userEmail: engineeringUser?.email || '',
              userName: engineeringUser?.displayName || '',
              status: 'pending'
            },
            comercial: {
              userId: commercialUser?.id || '',
              userEmail: commercialUser?.email || '',
              userName: commercialUser?.displayName || '',
              status: 'pending'
            },
            operaciones: {
              userId: operationsUser?.id || '',
              userEmail: operationsUser?.email || '',
              userName: operationsUser?.displayName || '',
              status: 'pending'
            }
          },
          notifications: {
            posventa: {
              userId: posventaUser?.id || '',
              userEmail: posventaUser?.email || '',
              userName: posventaUser?.displayName || '',
              confirmed: false
            }
          },
          linkedActions: finalLinkedActions
        };

        if (type === 'raw_material') {
          releaseData.purchaseOrderNumber = formData.purchaseOrderNumber;
          releaseData.code = formData.code;
          releaseData.description = formData.description;
          releaseData.vendor = formData.vendor;
        } else {
          releaseData.ofNumber = formData.ofNumber;
          releaseData.machineModel = formData.machineModel;
          releaseData.clientDealer = formData.clientDealer;
          releaseData.salesNoteNumber = formData.salesNoteNumber;
        }

        transaction.set(newReleaseRef, releaseData);
        transaction.set(counterRef, { 
          lastSpecialReleaseNumber: nextSRNumber,
          lastFindingNumber: lastFindingNumber,
          lastCorrectiveNumber: lastFindingNumber
        }, { merge: true });

        return {
          id: newReleaseRef.id,
          nextSRNumber,
          finalLinkedActions
        };
      });

      triggerAutoSync();

      // Trigger approvals notification if sent to review
      if (targetStatus === 'pending_approval') {
        const qualityUser = users.find(u => u.id === formData.calidadUserId);
        const engineeringUser = users.find(u => u.id === formData.ingenieriaUserId);
        const commercialUser = users.find(u => u.id === formData.comercialUserId);
        const operationsUser = users.find(u => u.id === formData.operacionesUserId);

        const approversEmails = [
          { email: qualityUser?.email, name: qualityUser?.displayName, role: 'Calidad' },
          { email: engineeringUser?.email, name: engineeringUser?.displayName, role: 'Ingeniería' },
          { email: commercialUser?.email, name: commercialUser?.displayName, role: 'Comercial' },
          { email: operationsUser?.email, name: operationsUser?.displayName, role: 'Operaciones' }
        ];

        const link = `${window.location.origin}/special-release/${result.id}`;

        for (const appr of approversEmails) {
          if (appr.email) {
            sendNotification({
              to: appr.email,
              subject: `Evaluación Requerida - Liberación Especial LE-#${result.nextSRNumber}`,
              body: `Estimado/a ${appr.name || 'Usuario'}, se requiere su firma autorizada para evaluar la Solicitud de Liberación Especial LE-#${result.nextSRNumber}. Por favor ingrese al siguiente enlace para ver la descripción de desvíos, riesgos, acciones definidas y emitir su firma: ${link}`,
              type: 'assignment'
            }).catch(e => console.error('Error sending approver notification email:', e));
          }
        }
      }

      // Notify action executors
      for (const act of result.finalLinkedActions) {
        const actionResponsibleUser = users.find(u => u.id === act.responsibleId);
        if (actionResponsibleUser?.email) {
          const findingLink = `${window.location.origin}/findings/${act.findingId}`;
          sendNotification({
            to: actionResponsibleUser.email,
            subject: `Acción Correctiva Asignada - Liberación Especial LE-#${result.nextSRNumber}`,
            body: `Estimado/a ${actionResponsibleUser.displayName || 'Usuario'}, se le ha asignado una acción correctiva en el marco de la Liberación Especial Número: LE-#${result.nextSRNumber}. Por favor ingrese al siguiente enlace para reportar el avance: ${findingLink}`,
            type: 'action_assigned',
            findingId: act.findingId
          }).catch(err => console.error('Error sending assigned action email:', err));
        }
      }

      navigate(`/special-release/${result.id}`);
    } catch (error) {
      console.error('Error submitting special release:', error);
      alert('Error al guardar la solicitud. Por favor intente nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6" id="new-special-release-form-container">
      {/* Back button */}
      <div>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors bg-white hover:bg-slate-100 border border-slate-200 px-4 py-2 rounded-xl cursor-pointer"
        >
          <ArrowLeft size={16} /> Volver
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-visible">
        {/* Banner */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 text-white flex items-center justify-between rounded-t-3xl">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <ShieldCheck size={24} /> Nueva Solicitud de Liberación Especial
            </h1>
            <p className="text-blue-100 text-xs mt-1">
              Complete los campos para registrar una desviación, definir acciones correctivas y configurar los aprobadores.
            </p>
          </div>
          <div className="p-3 bg-white/10 rounded-2xl hidden sm:block">
            {type === 'raw_material' ? <ShoppingBag size={28} /> : <Box size={28} />}
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Module Selector */}
          <div className="space-y-3">
            <label className="text-xs font-extrabold text-slate-400 uppercase tracking-wider block">
              Tipo de Liberación Especial
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setType('raw_material')}
                className={`flex items-center justify-center gap-3 p-4 rounded-2xl border text-sm font-bold transition-all cursor-pointer ${
                  type === 'raw_material'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm shadow-blue-500/5'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <ShoppingBag size={18} />
                Materia Prima y Materiales
              </button>
              <button
                type="button"
                onClick={() => setType('finished_product')}
                className={`flex items-center justify-center gap-3 p-4 rounded-2xl border text-sm font-bold transition-all cursor-pointer ${
                  type === 'finished_product'
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm shadow-blue-500/5'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Box size={18} />
                Producto Terminado
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6"></div>

          {/* Section 1: Information Inputs */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
              <ClipboardList size={18} className="text-blue-600" />
              1. Información General
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Empresa *</label>
                <select
                  name="company"
                  value={formData.company}
                  onChange={handleChange}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Seleccione empresa...</option>
                  {COMPANIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Fecha *</label>
                <input
                  type="date"
                  name="date"
                  value={formData.date}
                  onChange={handleChange}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {type === 'raw_material' ? (
                <>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Número de Orden de Compra</label>
                    <input
                      type="text"
                      name="purchaseOrderNumber"
                      value={formData.purchaseOrderNumber}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Código de Material</label>
                    <input
                      type="text"
                      name="code"
                      value={formData.code}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Descripción del Material</label>
                    <input
                      type="text"
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Proveedor</label>
                    <input
                      type="text"
                      name="vendor"
                      value={formData.vendor}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Número de Orden de Fabricación (OF)</label>
                    <input
                      type="text"
                      name="ofNumber"
                      value={formData.ofNumber}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Producto / Modelo</label>
                    <input
                      type="text"
                      name="machineModel"
                      value={formData.machineModel}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Cliente o Concesionario</label>
                    <input
                      type="text"
                      name="clientDealer"
                      value={formData.clientDealer}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">Número de Nota de Venta</label>
                    <input
                      type="text"
                      name="salesNoteNumber"
                      value={formData.salesNoteNumber}
                      onChange={handleChange}
                      placeholder=""
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6"></div>

          {/* Section 2: Deviation Analysis */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
              <ClipboardList size={18} className="text-blue-600" />
              2. Descripción y Análisis del Desvío
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Descripción del desvío *
                </label>
                <textarea
                  name="deviationDescription"
                  value={formData.deviationDescription}
                  onChange={handleChange}
                  required
                  rows={4}
                  placeholder="Detalle de forma precisa el desvío, no conformidad o discrepancia detectada..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Impacto en el cliente o Riesgos *
                </label>
                <textarea
                  name="clientImpact"
                  value={formData.clientImpact}
                  onChange={handleChange}
                  required
                  rows={3}
                  placeholder="Escriba los riesgos asociados a la liberación, consecuencias potenciales o impacto que pueda sufrir el cliente..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6"></div>

          {/* Section 3: Corrective Actions */}
          <div className="space-y-6 bg-slate-50/50 border border-slate-100 rounded-3xl p-6" id="actions-definition-section">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                <PlusCircle size={18} className="text-blue-600" />
                3. Acciones Correctivas
              </div>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-2.5 py-1 rounded-full font-black uppercase tracking-wider">
                Módulo Trazabilidad
              </span>
            </div>

            {/* Inline creation fields for action */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
              <h4 className="font-extrabold text-slate-700 text-xs uppercase tracking-wider">
                Definir Acción Correctiva / Bloqueo
              </h4>

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Descripción de la Acción</label>
                  <textarea
                    value={actionForm.description}
                    onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                    rows={2}
                    placeholder="Escriba la acción de corrección o bloqueo que se ejecutará..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/10"
                  />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Responsable</label>
                    <UserSelect
                      users={users}
                      value={actionForm.responsibleId}
                      onChange={(userId) => setActionForm({ ...actionForm, responsibleId: userId })}
                      placeholder="Seleccione responsable..."
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Fecha Límite</label>
                    <input
                      type="date"
                      value={actionForm.deadline}
                      onChange={(e) => setActionForm({ ...actionForm, deadline: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none text-slate-700 font-medium"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleAddLocalAction}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <PlusCircle size={14} />
                    Agregar Acción a la Lista
                  </button>
                </div>
              </div>
            </div>

            {/* List of currently added local actions */}
            <div className="space-y-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Acciones Agregadas ({localActions.length})</span>
              {localActions.length === 0 ? (
                <p className="text-slate-400 text-xs italic bg-white border border-slate-200 rounded-2xl p-5 text-center shadow-sm">
                  No se han agregado acciones correctivas aún.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {localActions.map((act, idx) => (
                    <div key={idx} className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-4 shadow-sm">
                      <div className="space-y-1.5 flex-grow">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">
                          Acción #{idx + 1}
                        </span>
                        <p className="text-slate-800 text-xs font-bold leading-relaxed">{act.description}</p>
                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 font-bold">
                          <span className="flex items-center gap-1"><User size={11} /> Resp: {act.responsibleName}</span>
                          <span className="flex items-center gap-1"><Calendar size={11} /> Límite: {act.deadline.split('-').reverse().join('/')}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLocalAction(idx)}
                        className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-2 rounded-lg transition-all shrink-0 cursor-pointer"
                        title="Eliminar Acción"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CREATE REQUEST BUTTON inside Section 3 */}
            <div className="border-t border-slate-200/60 pt-5 flex justify-end">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleSaveRelease('draft')}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-extrabold py-3 px-8 rounded-xl transition-all shadow-md text-sm cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Guardando...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} className="text-emerald-400" />
                    Crear Solicitud (Estado: Solicitud Creada)
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6"></div>

          {/* Section 4: Approvers Selection */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
              <Users size={18} className="text-blue-600" />
              4. Matriz de Autorización y Notificación
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Quality */}
              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Aprobador Calidad *
                </label>
                <UserSelect
                  users={users}
                  value={formData.calidadUserId}
                  onChange={(userId) => setFormData(prev => ({ ...prev, calidadUserId: userId }))}
                  placeholder="Seleccione aprobador de Calidad..."
                />
              </div>

              {/* Engineering */}
              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Aprobador Ingeniería *
                </label>
                <UserSelect
                  users={users}
                  value={formData.ingenieriaUserId}
                  onChange={(userId) => setFormData(prev => ({ ...prev, ingenieriaUserId: userId }))}
                  placeholder="Seleccione aprobador de Ingeniería..."
                />
              </div>

              {/* Commercial */}
              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Aprobador Comercial *
                </label>
                <UserSelect
                  users={users}
                  value={formData.comercialUserId}
                  onChange={(userId) => setFormData(prev => ({ ...prev, comercialUserId: userId }))}
                  placeholder="Seleccione aprobador de Comercial..."
                />
              </div>

              {/* Operations */}
              <div>
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Aprobador Operaciones *
                </label>
                <UserSelect
                  users={users}
                  value={formData.operacionesUserId}
                  onChange={(userId) => setFormData(prev => ({ ...prev, operacionesUserId: userId }))}
                  placeholder="Seleccione aprobador de Operaciones..."
                />
              </div>

              {/* Notified Posventa */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2">
                  Notificar a Posventa (Área Notificada) *
                </label>
                <UserSelect
                  users={users}
                  value={formData.posventaUserId}
                  onChange={(userId) => setFormData(prev => ({ ...prev, posventaUserId: userId }))}
                  placeholder="Seleccione persona de Posventa..."
                  dropdownPosition="top"
                />
                <span className="text-[10px] text-slate-400 font-semibold mt-1 block">
                  El área de Posventa será notificada y deberá registrar la recepción de la solicitud.
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6"></div>

          {/* Action Buttons for Section 4 */}
          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="px-6 py-3 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors text-sm cursor-pointer"
            >
              Cancelar
            </button>
            
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSaveRelease('pending_approval')}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-3 px-8 rounded-xl transition-all shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Enviando...
                </>
              ) : (
                <>
                  <Send size={18} />
                  Enviar a Revisión
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

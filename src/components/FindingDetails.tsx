import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  doc, getDoc, updateDoc, collection, addDoc, getDocs, 
  serverTimestamp, runTransaction, query, orderBy, limit, onSnapshot 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Finding, UserProfile, FindingStatus, CorrectiveAction, ActionStatus, CauseAnalysis, UserRole } from '../types';
import { UserSelect } from './UserSelect';
import { format } from 'date-fns';
import { motion } from 'motion/react';
import { 
  ClipboardCheck, Search, ShieldAlert, CheckCircle2, XCircle, 
  Clock, Plus, Send, AlertCircle, Calendar, User, Building2,
  Mail, Bell, Sparkles, ChevronDown, ChevronUp
} from 'lucide-react';
import { sendNotification, generateFindingLink } from '../services/notificationService';
import { triggerAutoSync } from '../lib/googleWorkspace';

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

const toDateSafe = (val: any): Date => {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

export default function FindingDetails({ user, category }: { user: UserProfile; category?: 'corrective' | 'improvement' | null }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [finding, setFinding] = useState<Finding | null>(null);
  const [analysis, setAnalysis] = useState<CauseAnalysis | null>(null);
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showEmails, setShowEmails] = useState(false);

  // Form states
  const [analysisForm, setAnalysisForm] = useState({ summary: '', contingencyActions: '' });
  const [actionForm, setActionForm] = useState({ description: '', responsibleId: '', deadline: '' });
  const [executionForm, setExecutionForm] = useState<{ comments: Record<string, string>; status: ActionStatus }>({
    comments: {},
    status: ActionStatus.FINISHED
  });

  const isImprovement = finding?.findingCategory === 'improvement';

  const fetchData = async () => {
    if (!id) return;
    try {
      const findingDoc = await getDoc(doc(db, 'findings', id));
      if (!findingDoc.exists()) return navigate('/');
      
      const findingData = { id: findingDoc.id, ...findingDoc.data() } as Finding;
      
      // Access Control Check: All logged-in users are permitted to view the finding details (readers by default)
      const canAccess = true;
      if (!canAccess) {
        alert('No tiene permiso para ver este hallazgo.');
        return navigate('/');
      }

      setFinding(findingData);
      
      const analysisDoc = await getDoc(doc(db, 'findings', id, 'analysis', 'current'));
      if (analysisDoc.exists()) setAnalysis(analysisDoc.data() as CauseAnalysis);
      
      const actionsSnapshot = await getDocs(collection(db, 'findings', id, 'correctiveActions'));
      setActions(actionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorrectiveAction)));
      
      const usersSnapshot = await getDocs(collection(db, 'users'));
      setUsers(usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const selectQuery = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(150));
    const unsubscribe = onSnapshot(selectQuery, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setNotifications(logs);
    }, (error) => {
      console.error('[Notifications Realtime Error]', error);
    });
    return () => unsubscribe();
  }, [id]);

  if (loading || !finding) return (
    <div className="flex flex-col items-center justify-center p-12 text-slate-400">
      <Clock className="animate-spin mb-4 text-slate-300" size={32} />
      <p>Cargando detalles del hallazgo...</p>
    </div>
  );

  const relatedNotifications = notifications.filter(notif => {
    if (!finding) return false;
    if (notif.findingId === id) return true;
    if (notif.itemId === id) return true;
    const searchStr = `#${finding.findingNumber}`;
    if (notif.subject && notif.subject.includes(searchStr)) return true;
    if (notif.body && notif.body.includes(searchStr)) return true;
    return false;
  });

  const isOwner = user.id === finding.ownerId || user.role === UserRole.ADMIN;
  const isAnalysisResponsible = user.id === finding.analysisResponsibleId || user.role === UserRole.ADMIN;
  const isActionResponsible = (actionId: string) => actions.find(a => a.id === actionId)?.responsibleId === user.id || user.role === UserRole.ADMIN;

  // --- HANDLERS ---

  const handleAnalysisSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const analysisRef = doc(db, 'findings', id, 'analysis', 'current');
      const findingRef = doc(db, 'findings', id);
      
      await runTransaction(db, async (transaction) => {
        const findingDoc = await transaction.get(findingRef);
        if (!findingDoc.exists()) return;
        
        const fData = findingDoc.data();
        
        transaction.set(analysisRef, {
          ...analysisForm,
          createdAt: serverTimestamp(),
        });
        
        transaction.update(findingRef, {
          status: FindingStatus.PENDING_ACTION,
          pendingActionUserIds: [fData.ownerId, fData.analysisResponsibleId].filter(uid => !!uid),
          updatedAt: serverTimestamp()
        });
      });

      // Notify Owner and Analysis Responsible that analysis is complete
      const recipients = Array.from(new Set([finding.ownerEmail, finding.analysisResponsibleEmail].filter(e => !!e)));
      
      for (const recipient of recipients) {
        await sendNotification({
          to: recipient,
          subject: `${finding.analysisResponsibleEmail === recipient ? 'ANÁLISIS REGISTRADO' : 'ANÁLISIS COMPLETADO'}: Hallazgo #${finding.findingNumber}`,
          body: `Hola, el análisis de causa para el hallazgo #${finding.findingNumber} ha sido completado. Tiene acciones asignadas: ${generateFindingLink(id, 'analysis')}`,
          type: 'creation',
          findingId: id
        });
      }

      await fetchData();
      triggerAutoSync();
    } catch (error) { 
      console.error(error); 
      alert('Error al guardar el análisis. Por favor intente nuevamente.');
    }
    finally { setIsSubmitting(false); }
  };

  const handleAddAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || isSubmitting) return;

    // Permissions check: only the analysis responsible can add corrective actions; owner can add improvements
    const canAddAction = isImprovement ? isOwner : isAnalysisResponsible;
    if (!canAddAction) {
      alert('No tiene permiso para agregar acciones en este hallazgo.');
      return;
    }

    // Date validation
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = parseLocalDate(actionForm.deadline);
    if (selectedDate < today) {
      alert('La fecha límite de la acción no puede ser una fecha pasada.');
      return;
    }

    setIsSubmitting(true);
    try {
      const respUser = users.find(u => u.id === actionForm.responsibleId);
      await addDoc(collection(db, 'findings', id, 'correctiveActions'), {
        findingId: id,
        description: actionForm.description,
        responsibleId: actionForm.responsibleId,
        responsibleEmail: respUser?.email || '',
        deadline: parseLocalDate(actionForm.deadline),
        status: ActionStatus.PENDING,
        createdAt: serverTimestamp(),
      });

      // Send Notification to Action Responsible
      const toEmail = respUser?.email || respUser?.displayName || actionForm.responsibleId;
      if (toEmail) {
        const currentInvolved = finding.involvedUserIds || [];
        const currentPending = finding.pendingActionUserIds || [];
        
        const updates: any = {};
        if (!currentInvolved.includes(actionForm.responsibleId)) {
          updates.involvedUserIds = [...currentInvolved, actionForm.responsibleId];
        }
        if (!currentPending.includes(actionForm.responsibleId)) {
          updates.pendingActionUserIds = [...currentPending, actionForm.responsibleId];
        }
        
        if (Object.keys(updates).length > 0) {
          await updateDoc(doc(db, 'findings', id), updates);
        }

        console.log(`[FindingDetails] Enviando notificación de acción asignada a: ${toEmail}`);
        
        sendNotification({
          to: toEmail,
          subject: `NUEVA ACCIÓN: ${isImprovement ? 'Mejora' : 'Hallazgo'} #${finding.findingNumber}`,
          body: `Hola ${respUser?.displayName || 'Usuario'}, se le ha asignado una acción de mejora para el hallazgo #${finding.findingNumber}: "${actionForm.description}". Fecha límite: ${format(parseLocalDate(actionForm.deadline), 'dd/MM/yyyy')}. Revise los detalles y gestione su cumplimiento aquí: ${generateFindingLink(id, 'actions')}`,
          type: 'action_assigned',
          findingId: id
        }).catch(err => console.error('[FindingDetails] Error enviando notificación de acción:', err));
      }

      setActionForm({ description: '', responsibleId: '', deadline: '' });
      await fetchData();
      triggerAutoSync();
    } catch (error) { 
      console.error(error); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  const handleActionExecution = async (actionId: string, status: ActionStatus) => {
    if (!id || isSubmitting) return;
    
    const comment = executionForm.comments[actionId] || '';
    if (!comment.trim()) {
      alert('El reporte de implementación es obligatorio para registrar el avance o cancelación.');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'findings', id, 'correctiveActions', actionId), {
        implementationComment: comment,
        status: status,
        executionDate: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const updatedActions = await getDocs(collection(db, 'findings', id, 'correctiveActions'));
      const actionsList = updatedActions.docs.map(d => ({ ...d.data(), id: d.id } as CorrectiveAction));
      
      const allImplemented = actionsList.every(a => a.status !== ActionStatus.PENDING);
      const actionRespId = actionsList.find(a => a.id === actionId)?.responsibleId;
      
      // Update pending users
      if (actionRespId) {
        const stillHasPending = actionsList.some(a => a.responsibleId === actionRespId && a.status === ActionStatus.PENDING);
        if (!stillHasPending) {
          const currentPending = finding.pendingActionUserIds || [];
          await updateDoc(doc(db, 'findings', id), {
            pendingActionUserIds: Array.from(new Set([...currentPending.filter(uid => uid !== actionRespId), finding.ownerId])),
            updatedAt: serverTimestamp()
          });
        }
      }
      
      if (status === ActionStatus.REJECTED) {
        console.log(`[FindingDetails] Enviando notificación de acción rechazada a: ${finding.ownerEmail}`);
        sendNotification({
          to: finding.ownerEmail,
          subject: `ACCIÓN RECHAZADA: ${isImprovement ? 'Mejora' : 'Hallazgo'} #${finding.findingNumber}`,
          body: `Hola, se ha rechazado la acción de mejora para el hallazgo #${finding.findingNumber}: "${actionsList.find(a => a.id === actionId)?.description}". Comentario: "${comment || 'Sin comentarios'}". El circuito para esta acción ha terminado.`,
          type: 'verification',
          findingId: id
        }).catch(err => console.error('[FindingDetails] Error enviando notificación de acción rechazada:', err));
      } else {
        // Notify Owner that an action was finished and is ready for verification
        console.log(`[FindingDetails] Enviando notificación de acción finalizada a: ${finding.ownerEmail}`);
        sendNotification({
          to: finding.ownerEmail,
          subject: `ACCCIÓN FINALIZADA: ${isImprovement ? 'Mejora' : 'Hallazgo'} #${finding.findingNumber}`,
          body: `Hola, se ha completado la de la acción: "${actionsList.find(a => a.id === actionId)?.description}" en el hallazgo #${finding.findingNumber}. Ya puede proceder a realizar la Verificación de Eficacia individual: ${generateFindingLink(id, 'actions')}`,
          type: 'verification',
          findingId: id
        }).catch(err => console.error('[FindingDetails] Error enviando notificación de fin de acción:', err));
      }

      if (allImplemented) {
        const hasRejected = actionsList.some(a => a.status === ActionStatus.REJECTED);
        const nextStatus = hasRejected ? FindingStatus.REJECTED : FindingStatus.PENDING_VERIFICATION;

        await updateDoc(doc(db, 'findings', id), {
          status: nextStatus,
          pendingActionUserIds: nextStatus === FindingStatus.REJECTED ? [] : Array.from(new Set([...(finding.pendingActionUserIds || []).filter(uid => uid !== actionRespId), finding.ownerId])),
          updatedAt: serverTimestamp()
        });
        
        if (nextStatus === FindingStatus.PENDING_VERIFICATION) {
          // Notify Owner for general verification if everything is done
          sendNotification({
            to: finding.ownerEmail,
            subject: `PENDIENTE: Verificación de Eficacia General - ${isImprovement ? 'Acción de Mejora' : 'Hallazgo'} #${finding.findingNumber}`,
            body: `Hola, se ha completado la totalidad de las acciones del hallazgo #${finding.findingNumber}. El estado general ha pasado a PENDIENTE VERIFICACIÓN: ${generateFindingLink(id)}`,
            type: 'verification',
            findingId: id
          }).catch(err => console.error('[FindingDetails] Error enviando notificación general:', err));
        } else if (nextStatus === FindingStatus.REJECTED) {
          // Notify Owner that finding is finished as rejected
          sendNotification({
            to: finding.ownerEmail,
            subject: `MEJORA RECHAZADA: Mejora #${finding.findingNumber}`,
            body: `Hola, se ha cerrado la mejora #${finding.findingNumber} como RECHAZADA debido a que una o más de sus acciones fueron rechazadas.`,
            type: 'verification',
            findingId: id
          }).catch(err => console.error('[FindingDetails] Error enviando notificación general de rechazo:', err));
        }
      }

      setExecutionForm({
        comments: {
          ...executionForm.comments,
          [actionId]: ''
        },
        status: ActionStatus.FINISHED
      });
      await fetchData();
      triggerAutoSync();
    } catch (error) { 
      console.error(error); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  const handleActionVerification = async (actionId: string, verified: boolean) => {
    if (!id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'findings', id, 'correctiveActions', actionId), {
        isVerified: verified,
        verificationDate: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const updatedActions = await getDocs(collection(db, 'findings', id, 'correctiveActions'));
      const actionsList = updatedActions.docs.map(d => ({ ...d.data(), id: d.id } as CorrectiveAction));
      
      const allImplemented = actionsList.every(a => a.status !== ActionStatus.PENDING);
      const allVerified = actionsList.every(a => a.isVerified !== undefined);
      
      if (allImplemented && allVerified) {
        const allSuccessful = actionsList.every(a => a.isVerified === true);
        await updateDoc(doc(db, 'findings', id), {
          status: allSuccessful ? FindingStatus.COMPLETED : FindingStatus.CANCELLED,
          isVerified: allSuccessful,
          verificationDate: serverTimestamp(),
          pendingActionUserIds: [], 
          updatedAt: serverTimestamp()
        });
      }

      await fetchData();
      triggerAutoSync();
    } catch (error) { 
      console.error(error); 
    } finally { 
      setIsSubmitting(false); 
    }
  };

  // --- RENDER HELPERS ---

  const StatusIcon = ({ status }: { status: FindingStatus }) => {
    switch (status) {
      case FindingStatus.COMPLETED: return <CheckCircle2 className="text-emerald-500" />;
      case FindingStatus.CANCELLED: return <XCircle className="text-slate-400" />;
      case FindingStatus.REJECTED: return <XCircle className="text-red-500" />;
      case FindingStatus.PENDING_ANALYSIS: return <Search className="text-amber-500" />;
      case FindingStatus.PENDING_ACTION: return <ClipboardCheck className="text-blue-500" />;
      case FindingStatus.PENDING_VERIFICATION: return <ShieldAlert className="text-purple-500" />;
      default: return <Clock className="text-slate-400" />;
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12 font-sans">
      {/* Finding Header */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50 p-6 flex flex-col md:flex-row justify-between gap-4 md:items-center border-b border-slate-200">
          <div className="flex items-center gap-4">
            <div className={`p-3 bg-white rounded-xl shadow-sm border ${isImprovement ? 'border-emerald-100' : 'border-slate-100'}`}>
              {isImprovement ? <Sparkles className="text-emerald-500" size={24} /> : <StatusIcon status={finding.status} />}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">
                  {isImprovement ? `Acción de Mejora #${finding.findingNumber}` : `Hallazgo #${finding.findingNumber}`}
                </h1>
                <span className={`px-3 py-1 bg-white border text-xs font-bold uppercase rounded-lg ${isImprovement ? 'border-emerald-200 text-emerald-700 bg-emerald-50/20' : 'border-slate-200 text-slate-500'}`}>
                  {finding.company}
                </span>
              </div>
              <p className="text-slate-500 text-sm mt-0.5 font-medium">
                {isImprovement ? 'Propuesta de Mejora SGC' : finding.type} • Registrado el {finding.createdAt ? format(toDateSafe(finding.createdAt), 'dd/MM/yyyy HH:mm') : '-'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
              finding.status === FindingStatus.COMPLETED ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
              finding.status === FindingStatus.CANCELLED ? 'bg-slate-100 text-slate-600 border-slate-200' :
              finding.status === FindingStatus.REJECTED ? 'bg-red-50 text-red-700 border-red-100' :
              isImprovement ? 'bg-emerald-55 text-emerald-800 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-100 animate-pulse'
            }`}>
              {finding.status === FindingStatus.REJECTED ? 'RECHAZADA' : finding.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>
        
        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            {!isImprovement && <DetailItem icon={<Building2 size={18} />} label="Proceso" value={finding.process} />}
            <DetailItem icon={<User size={18} />} label="Dueño del Registro" value={finding.ownerEmail} />
            <DetailItem icon={<Calendar size={18} />} label="Fecha de Carga" value={finding.findingDate ? format(toDateSafe(finding.findingDate), 'dd/MM/yyyy') : '-'} />
          </div>
          <div className="space-y-4">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {isImprovement ? 'Descripción del Hallazgo / Desvío' : 'Descripción del Hallazgo'}
            </label>
            <p className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-slate-700 leading-relaxed italic">
              "{finding.description}"
            </p>
          </div>
        </div>
      </div>

      {/* Cause Analysis Section - Hide for Improvements */}
      {!isImprovement && (
        <section className="space-y-4">
          <SectionTitle title="1. Análisis de Causa" description="Investigación y acciones de contingencia" />
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            {analysis ? (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                  <User size={14} /> Responsable: {users.find(u => u.id === finding.analysisResponsibleId)?.displayName || finding.analysisResponsibleEmail}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-slate-900">Resumen de Causas</h4>
                    <p className="text-slate-600 text-sm bg-slate-50 p-4 rounded-xl">{analysis.summary}</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-slate-900">Acciones de Contingencia</h4>
                    <p className="text-slate-600 text-sm bg-slate-50 p-4 rounded-xl">{analysis.contingencyActions}</p>
                  </div>
                </div>
              </div>
            ) : isAnalysisResponsible && finding.status === FindingStatus.PENDING_ANALYSIS ? (
              <form onSubmit={handleAnalysisSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Análisis de Causa *</label>
                    <textarea 
                      required
                      value={analysisForm.summary}
                      onChange={(e) => setAnalysisForm({ ...analysisForm, summary: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[120px]"
                      placeholder="Resumen de causas encontradas..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Acciones de Contingencia *</label>
                    <textarea 
                      required
                      value={analysisForm.contingencyActions}
                      onChange={(e) => setAnalysisForm({ ...analysisForm, contingencyActions: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[120px]"
                      placeholder="Detalle de acciones tomadas..."
                    />
                  </div>
                </div>
                <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-6 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmitting ? 'Confirmando...' : 'Confirmar Análisis'}
                </button>
              </form>
            ) : (
              <p className="text-slate-400 text-sm text-center py-4 italic">Análisis de causa pendiente de carga por el responsable.</p>
            )}
          </div>
        </section>
      )}

      {/* Corrective/Improvement Actions Section */}
      <section className="space-y-4">
        <SectionTitle 
          title={isImprovement ? "Planes de Acción de Mejora" : "2. Acciones Correctivas"} 
          description={isImprovement ? "Planes de acción propuestos para materializar la mejora continua" : "Acciones permanentes para evitar repetición"} 
        />
        <div className="space-y-4">
          {actions.map(action => (
            <div key={action.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
              <div className="space-y-2 flex-grow">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    action.status === ActionStatus.FINISHED ? 'bg-emerald-500' : 
                    action.status === ActionStatus.CANCELLED ? 'bg-slate-300' : 
                    action.status === ActionStatus.REJECTED ? 'bg-red-500' : 'bg-blue-500 animate-pulse'
                  }`} />
                  <h4 className="font-bold text-slate-800 text-sm sm:text-base">{action.description}</h4>
                </div>
                <div className="flex flex-wrap gap-4 text-xs font-semibold">
                  <span className="flex items-center gap-1.5 text-slate-600 bg-slate-100 px-2 py-1 rounded-md">
                    <User size={14} className="text-slate-400" /> 
                    Responsable: {users.find(u => u.id === action.responsibleId)?.displayName || action.responsibleEmail}
                  </span>
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <Calendar size={14} className="text-slate-400" /> 
                    Vencimiento: {action.deadline ? format(toDateSafe(action.deadline), 'dd/MM/yyyy') : '-'}
                  </span>
                  {action.executionDate && (
                     <span className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
                       action.status === ActionStatus.REJECTED 
                         ? 'text-red-600 bg-red-50 border-red-100' 
                         : action.status === ActionStatus.CANCELLED
                         ? 'text-slate-500 bg-slate-50 border-slate-200'
                         : 'text-emerald-600 bg-emerald-50 border-emerald-100'
                     }`}>
                       {action.status === ActionStatus.REJECTED ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                       {action.status === ActionStatus.REJECTED ? 'Rechazado' : action.status === ActionStatus.CANCELLED ? 'Cancelado' : 'Finalizado'}: {format(toDateSafe(action.executionDate), 'dd/MM/yyyy')}
                     </span>
                  )}
                </div>
                {action.implementationComment && (
                  <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg mt-2 border-l-2 border-slate-200 whitespace-pre-wrap italic">
                    "{action.implementationComment}"
                  </p>
                )}
              </div>

              {action.status === ActionStatus.PENDING && isActionResponsible(action.id) && (
                <div className="flex flex-col gap-3 w-full md:w-auto min-w-[300px] bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Reporte de Implementación (Obligatorio) *</span>
                  </div>
                  <textarea
                    placeholder="Detalles sobre las tareas realizadas, fecha real implementada u observaciones específicas de la ejecución."
                    className="text-sm p-3 bg-white border border-slate-200 rounded-lg w-full resize-none min-h-[100px] focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                    value={executionForm.comments[action.id] || ''}
                    onChange={(e) => setExecutionForm({
                      ...executionForm,
                      comments: {
                        ...executionForm.comments,
                        [action.id]: e.target.value
                      }
                    })}
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleActionExecution(action.id, ActionStatus.FINISHED)}
                      disabled={isSubmitting || !(executionForm.comments[action.id] || '').trim()}
                      className="flex-1 flex items-center justify-center gap-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm cursor-pointer"
                    >
                      <CheckCircle2 size={15} /> Confirmar Ejecución
                    </button>
                    <button 
                      onClick={() => handleActionExecution(action.id, isImprovement ? ActionStatus.REJECTED : ActionStatus.CANCELLED)}
                      disabled={isSubmitting || !(executionForm.comments[action.id] || '').trim()}
                      className={`text-xs font-bold py-2.5 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer ${
                        isImprovement 
                          ? 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-100' 
                          : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-500'
                      }`}
                    >
                      {isImprovement ? 'Rechazar' : 'Cancelar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Verification part for each action (Owner/Admin) */}
              {action.status === ActionStatus.FINISHED && action.isVerified === undefined && isOwner && (
                <div className="flex flex-col gap-2 w-full md:w-auto min-w-[200px] border-l md:border-l border-slate-100 md:pl-6">
                  <span className="text-[10px] font-bold text-purple-600 uppercase">Verificar Eficacia de la Acción</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleActionVerification(action.id, true)}
                      className="flex-1 text-xs font-bold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 py-2 rounded-lg cursor-pointer"
                    >
                      Eficaz
                    </button>
                    <button 
                      onClick={() => handleActionVerification(action.id, false)}
                      className="flex-1 text-xs font-bold bg-red-100 text-red-700 hover:bg-red-200 py-2 rounded-lg cursor-pointer"
                    >
                      No Eficaz
                    </button>
                  </div>
                </div>
              )}
              
              {action.isVerified !== undefined && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${action.isVerified ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                  {action.isVerified ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {action.isVerified ? 'Eficaz' : 'No Eficaz'}
                </div>
              )}
            </div>
          ))}

          {/* Add Action Form (Owner can add if is in PENDING_ACTION for improvements, analysis responsible for corrective actions) */}
          {((isImprovement && isOwner) || (!isImprovement && isAnalysisResponsible)) && finding.status === FindingStatus.PENDING_ACTION && (
            <div className={`bg-slate-50 border-2 border-dashed rounded-2xl p-6 ${isImprovement ? 'border-emerald-200' : 'border-blue-200'}`}>
              <h4 className={`text-sm font-bold mb-4 flex items-center gap-2 ${isImprovement ? 'text-emerald-700' : 'text-blue-700'}`}>
                <Plus size={18} /> {isSubmitting ? 'Procesando...' : isImprovement ? 'Agregar Acción de Mejora Adicional' : 'Agregar Acción Correctiva Adicional'}
              </h4>
              <form onSubmit={handleAddAction} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input 
                  required
                  disabled={isSubmitting}
                  placeholder={isImprovement ? "Descripción de la acción de mejora..." : "Descripción de la acción correctiva..."}
                  className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm md:col-span-1 disabled:opacity-50"
                  value={actionForm.description}
                  onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                />
                <UserSelect
                  users={users}
                  value={actionForm.responsibleId}
                  onChange={(userId) => setActionForm({ ...actionForm, responsibleId: userId })}
                  placeholder="Asignar de la lista..."
                  required={true}
                  className="bg-white"
                />
                <div className="flex gap-2">
                  <input 
                    type="date"
                    required
                    disabled={isSubmitting}
                    min={new Date().toISOString().split('T')[0]}
                    className="flex-grow bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm disabled:opacity-50"
                    value={actionForm.deadline}
                    onChange={(e) => setActionForm({ ...actionForm, deadline: e.target.value })}
                  />
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className={`p-2 font-bold text-white rounded-xl shadow-sm disabled:opacity-50 cursor-pointer ${isImprovement ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    <Send size={18} />
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* Verification General Status */}
      <section className="space-y-4">
        <SectionTitle 
          title={isImprovement ? "Evaluación de Eficacia / Cierre" : "3. Estado de Verificación"} 
          description={isImprovement ? "Cierre definitivo del plan de mejora continua" : "Cierre general del hallazgo"} 
        />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {finding.isVerified !== undefined ? (
            <div className={`p-6 rounded-2xl flex items-center gap-6 border ${finding.isVerified ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              {finding.isVerified ? <CheckCircle2 size={40} className="text-emerald-500" /> : <XCircle size={40} className="text-red-500" />}
              <div>
                <h4 className="font-bold text-lg">
                  {finding.isVerified 
                    ? isImprovement ? 'Mejora Cerrada - Eficaz (Implementada de forma exitosa)' : 'Hallazgo Cerrado - Eficaz' 
                    : isImprovement ? 'Mejora Cerrada - No Eficaz' : 'Hallazgo Cerrado - No Eficaz / Cancelado'}
                </h4>
                <p className="text-sm opacity-70">Evaluación registrada el {finding.verificationDate ? format(toDateSafe(finding.verificationDate), 'dd/MM/yyyy HH:mm') : '-'}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-6 bg-slate-50 rounded-2xl border border-slate-100 text-slate-500">
              <Clock size={24} />
              <div>
                <p className="font-semibold italic text-sm">
                  {actions.length === 0 ? 'Esperando definición de planes de acción.' : 
                   (finding.status === FindingStatus.REJECTED || actions.every(a => a.status === ActionStatus.REJECTED)) ? 'No requiere verificación.' :
                   actions.every(a => a.isVerified !== undefined) ? 'Procesando cierre...' :
                   'Verificación individual de eficacia en curso.'}
                </p>
                <p className="text-xs mt-0.5">
                  {(finding.status === FindingStatus.REJECTED || actions.every(a => a.status === ActionStatus.REJECTED))
                    ? 'La propuesta de mejora fue rechazada o no cuenta con acciones para verificar.'
                    : 'La propuesta de mejora se cerrará automáticamente cuando todas las acciones sean verificadas.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Collapsible Email Tracking Section at the bottom */}
      <section className="mt-8 border-t border-slate-200 pt-6">
        <button
          onClick={() => setShowEmails(!showEmails)}
          className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 transition-colors cursor-pointer text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-white border border-slate-200 ${isImprovement ? 'text-emerald-600' : 'text-blue-600'}`}>
              <Mail size={18} />
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-sm">Seguimiento de Emails Relacionados (SGC Alertas)</h4>
              <p className="text-xs text-slate-400">Ver historial de notificaciones y recordatorios automáticos enviados</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-bold font-mono bg-slate-200/60 px-2 py-0.5 rounded-md text-slate-600">
              {relatedNotifications.length} correos
            </span>
            {showEmails ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </button>

        {showEmails && (
          <div className="mt-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            {relatedNotifications.length === 0 ? (
              <p className="text-slate-400 text-xs italic p-1">Aún no se han registrado o enviado correos electrónicos para este hallazgo en este entorno.</p>
            ) : (
              <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1">
                {relatedNotifications.map((notif) => (
                  <div 
                    key={notif.id} 
                    className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors text-xs"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-700 truncate max-w-[200px] sm:max-w-none">
                          {notif.to}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase whitespace-nowrap ${isImprovement ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                          {notif.type || 'Alerta'}
                        </span>
                        {notif.via && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase whitespace-nowrap ${isImprovement ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-600'}`}>
                            Vía: {notif.via === 'simulation' ? 'SGC' : notif.via}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-slate-800 truncate">{notif.subject}</p>
                      <p className="text-[11px] text-slate-500 line-clamp-1">{notif.body}</p>
                    </div>
                    
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start shrink-0 gap-1.5 sm:min-h-[45px] pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100 font-mono">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase leading-none ${
                        notif.status === 'sent' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                        notif.status === 'sending' ? 'bg-amber-100 text-amber-800 border border-amber-200 animate-pulse' :
                        'bg-red-100 text-red-800 border border-red-200'
                      }`}>
                        {notif.status === 'sent' ? 'Enviado' : notif.status === 'sending' ? 'Enviando...' : 'Fallo'}
                      </span>
                      <span className="text-[9px] text-slate-400 font-medium whitespace-nowrap">
                        {notif.createdAt?.toDate ? format(notif.createdAt.toDate(), 'dd/MM/yyyy HH:mm') : 'Recién'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-1">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="p-1.5 bg-slate-100 rounded-lg text-slate-400">
        {icon}
      </div>
      <div>
        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{label}</span>
        <span className="block text-sm font-semibold text-slate-700">{value}</span>
      </div>
    </div>
  );
}

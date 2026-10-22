import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, collection, getDocs, runTransaction, serverTimestamp, query, where, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ChangeRequest, UserProfile, UserRole, AreaReview, AreaQuestion } from '../types';
import { UserSelect } from './UserSelect';
import { sendNotification } from '../services/notificationService';
import { motion } from 'motion/react';
import { 
  ArrowLeft, RefreshCw, ClipboardList, HelpCircle, FileText, CheckCircle2, 
  XCircle, Clock, Send, ShieldAlert, User, Calendar, Plus, Trash2, 
  Check, ChevronDown, ChevronUp, AlertCircle, MessageSquare, Info, ExternalLink,
  Edit3, Save, X
} from 'lucide-react';
import { format } from 'date-fns';

const toDateSafe = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
};

const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

export default function ChangeRequestDetails({ user }: { user: UserProfile }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isDeletingRef = useRef(false);

  const [request, setRequest] = useState<ChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'definition' | 'review' | 'approval' | 'communication' | 'actions_status'>('definition');
  const [saving, setSaving] = useState(false);

  // States for linked corrective actions
  const [linkedFindings, setLinkedFindings] = useState<any[]>([]);
  const [linkedActions, setLinkedActions] = useState<any[]>([]);
  const [loadingActions, setLoadingActions] = useState(false);
  const [linkingActionKey, setLinkingActionKey] = useState<string | null>(null);
  const [deletingActionId, setDeletingActionId] = useState<string | null>(null);
  const [actionToDelete, setActionToDelete] = useState<any | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Accordion active state for reviews in Stage 2
  const [expandedArea, setExpandedArea] = useState<string | null>(null);

  // Local Form state for Stage 1 assignment
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, { applies: boolean, responsibleId: string }>>({
    ingenieriaProcesos: { applies: false, responsibleId: '' },
    produccion: { applies: false, responsibleId: '' },
    mantenimiento: { applies: false, responsibleId: '' },
    calidad: { applies: false, responsibleId: '' },
    supplyChain: { applies: false, responsibleId: '' },
    hse: { applies: false, responsibleId: '' },
    infraestructura: { applies: false, responsibleId: '' },
    recursosHumanos: { applies: false, responsibleId: '' }
  });
  const [requiredDeadline, setRequiredDeadline] = useState('');

  // Local Action Form state for Stage 2 action creation
  const [actionForm, setActionForm] = useState<Record<string, { description: string, responsibleId: string, deadline: string }>>({});

  // Local Stage 3 Approver assignment
  const [finalApproverId, setFinalApproverId] = useState('');
  const [finalApprovalDeadline, setFinalApprovalDeadline] = useState('');

  // Local Comments
  const [stage2Comments, setStage2Comments] = useState<Record<string, string>>({});
  const [stage3Comments, setStage3Comments] = useState('');

  // State for editing initial definition (prior to sending to review)
  const [isEditingDefinition, setIsEditingDefinition] = useState(false);
  const [savingDefinition, setSavingDefinition] = useState(false);
  const [definitionForm, setDefinitionForm] = useState({
    title: '',
    company: '',
    mission: 'Calidad' as ChangeRequest['mission'],
    description: '',
    objective: '',
    currentSituation: '',
    proposedSituation: '',
    impactAnalysis: ''
  });

  // Fetch Change Request and users list
  useEffect(() => {
    if (!id) return;

    const fetchDetails = async () => {
      try {
        const docRef = doc(db, 'change_requests', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() } as ChangeRequest;
          setRequest(data);
          
          // Pre-populate assignments if they exist
          if (data.reviews) {
            const initialAssignments: any = {};
            Object.entries(data.reviews).forEach(([key, val]) => {
              const reviewVal = val as AreaReview;
              initialAssignments[key] = {
                applies: reviewVal.applies || false,
                responsibleId: reviewVal.responsibleId || ''
              };
            });
            setReviewAssignments(initialAssignments);
            
            // Extract the first deadline as common required deadline
            const firstWithDeadline = (Object.values(data.reviews) as AreaReview[]).find(v => v.deadline);
            if (firstWithDeadline) {
              const d = toDateSafe(firstWithDeadline.deadline);
              setRequiredDeadline(d.toISOString().split('T')[0]);
            } else {
              setRequiredDeadline(new Date().toISOString().split('T')[0]);
            }
          }

          if (data.finalApproverId) {
            setFinalApproverId(data.finalApproverId);
          }
          if (data.finalApprovalDeadline) {
            const d = toDateSafe(data.finalApprovalDeadline);
            setFinalApprovalDeadline(d.toISOString().split('T')[0]);
          }

          // Pre-populate definition form
          setDefinitionForm({
            title: data.title || '',
            company: data.company || '',
            mission: data.mission || 'Calidad',
            description: data.description || '',
            objective: data.objective || '',
            currentSituation: data.currentSituation || '',
            proposedSituation: data.proposedSituation || '',
            impactAnalysis: data.impactAnalysis || ''
          });

          // Adjust active tab based on request status
          if (data.status === 'draft') {
            setActiveTab('definition');
          } else if (data.status === 'pending_review') {
            setActiveTab('review');
          } else if (data.status === 'pending_approval') {
            setActiveTab('approval');
          } else {
            setActiveTab('communication');
          }

        } else {
          alert('No se encontró la solicitud de cambio especificada.');
          navigate('/');
        }
      } catch (err) {
        console.error('Error fetching details:', err);
      } finally {
        setLoading(false);
      }
    };

    const fetchUsers = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'users'));
        setUsers(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
      } catch (err) {
        console.error('Error fetching users:', err);
      }
    };

    fetchDetails();
    fetchUsers();
  }, [id, navigate]);

  const fetchLinkedActions = async () => {
    if (!id) return;
    setLoadingActions(true);
    try {
      const findingsSnap = await getDocs(
        query(collection(db, 'findings'), where('changeRequestId', '==', id))
      );
      const findingsList = findingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      
      const actionsList: any[] = [];
      for (const f of findingsList) {
        const actionsSnap = await getDocs(collection(db, 'findings', f.id, 'correctiveActions'));
        if (actionsSnap.empty) {
          actionsList.push({
            id: f.id,
            findingId: f.id,
            findingNumber: f.findingNumber,
            findingDescription: f.description,
            description: f.description,
            responsibleId: f.analysisResponsibleId || f.ownerId,
            responsibleEmail: f.analysisResponsibleEmail || f.ownerEmail,
            deadline: f.analysisDeadline || f.findingDate,
            status: f.status === 'completed' ? 'finished' : (f.status === 'cancelled' ? 'cancelled' : 'pending'),
            createdAt: f.createdAt
          });
        } else {
          actionsSnap.docs.forEach(aDoc => {
            actionsList.push({
              id: aDoc.id,
              findingId: f.id,
              findingNumber: f.findingNumber,
              findingDescription: f.description,
              ...aDoc.data()
            });
          });
        }
      }
      setLinkedFindings(findingsList);
      setLinkedActions(actionsList);
    } catch (err) {
      console.error('Error fetching linked actions:', err);
    } finally {
      setLoadingActions(false);
    }
  };

  useEffect(() => {
    fetchLinkedActions();
  }, [id]);

  if (loading || !request) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3" id="details-loading-spinner">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
        <span className="text-slate-500 text-sm font-medium">Cargando detalles de la solicitud...</span>
      </div>
    );
  }

  const isCreator = request.creatorId === user.id;
  const isFinalApprover = request.finalApproverId === user.id;
  const canEditDefinition = request.status === 'draft' && (isCreator || user.role === 'admin');

  const handleStartEditDefinition = () => {
    if (!request) return;
    setDefinitionForm({
      title: request.title || '',
      company: request.company || '',
      mission: request.mission || 'Calidad',
      description: request.description || '',
      objective: request.objective || '',
      currentSituation: request.currentSituation || '',
      proposedSituation: request.proposedSituation || '',
      impactAnalysis: request.impactAnalysis || ''
    });
    setIsEditingDefinition(true);
  };

  const handleCancelEditDefinition = () => {
    if (!request) return;
    setDefinitionForm({
      title: request.title || '',
      company: request.company || '',
      mission: request.mission || 'Calidad',
      description: request.description || '',
      objective: request.objective || '',
      currentSituation: request.currentSituation || '',
      proposedSituation: request.proposedSituation || '',
      impactAnalysis: request.impactAnalysis || ''
    });
    setIsEditingDefinition(false);
  };

  const handleSaveDefinition = async () => {
    if (!request || !id) return;
    if (!isCreator && user.role !== 'admin') {
      alert('No tenés permisos para editar esta solicitud.');
      return;
    }
    if (request.status !== 'draft') {
      alert('La propuesta solo puede ser editada mientras se encuentre en estado borrador (antes del envío a revisión).');
      return;
    }

    if (!definitionForm.title.trim()) {
      alert('Por favor ingrese el título de la propuesta.');
      return;
    }
    if (!definitionForm.company) {
      alert('Por favor seleccione la empresa.');
      return;
    }
    if (!definitionForm.description.trim()) {
      alert('Por favor ingrese la descripción de la propuesta.');
      return;
    }
    if (!definitionForm.objective.trim()) {
      alert('Por favor ingrese el objetivo del cambio.');
      return;
    }
    if (!definitionForm.currentSituation.trim() || !definitionForm.proposedSituation.trim()) {
      alert('Por favor complete el cuadro comparativo (Situación Actual y Propuesta).');
      return;
    }
    if (!definitionForm.impactAnalysis.trim()) {
      alert('Por favor ingrese el análisis de impacto.');
      return;
    }

    setSavingDefinition(true);
    try {
      const docRef = doc(db, 'change_requests', id);
      const updatedFields = {
        title: definitionForm.title.trim(),
        company: definitionForm.company,
        mission: definitionForm.mission,
        description: definitionForm.description.trim(),
        objective: definitionForm.objective.trim(),
        currentSituation: definitionForm.currentSituation.trim(),
        proposedSituation: definitionForm.proposedSituation.trim(),
        impactAnalysis: definitionForm.impactAnalysis.trim(),
        updatedAt: serverTimestamp()
      };

      await updateDoc(docRef, updatedFields);

      setRequest(prev => prev ? {
        ...prev,
        ...updatedFields,
        updatedAt: new Date()
      } : null);

      setIsEditingDefinition(false);
    } catch (err: any) {
      console.error('Error updating definition:', err);
      alert('Error al guardar los cambios: ' + (err.message || String(err)));
    } finally {
      setSavingDefinition(false);
    }
  };

  // Save Stage 1 setup and transition to Stage 2
  const handleSendToReview = async () => {
    if (request.creatorId !== user.id && user.role !== 'admin') {
      alert('No tenés permisos para enviar esta solicitud a revisión.');
      return;
    }

    if (isEditingDefinition) {
      alert('Tenés cambios sin guardar en la propuesta. Por favor guardá o cancelá la edición antes de enviar a revisión.');
      return;
    }

    // Validations
    const activeAreas = Object.entries(reviewAssignments).filter(([_, val]) => (val as any).applies);
    if (activeAreas.length === 0) {
      alert('Por favor seleccione al menos una área para revisión.');
      return;
    }

    // Check responsibles
    for (const [key, val] of activeAreas) {
      if (!(val as any).responsibleId) {
        const nameMap: Record<string, string> = {
          ingenieriaProcesos: 'Ingeniería de Procesos',
          produccion: 'Producción',
          mantenimiento: 'Mantenimiento',
          calidad: 'Calidad',
          supplyChain: 'Supply Chain',
          hse: 'Salud, Seguridad y Medio Ambiente',
          infraestructura: 'Infraestructura',
          recursosHumanos: 'Recursos Humanos'
        };
        alert(`Por favor asigne un responsable para el área: ${nameMap[key] || key}`);
        return;
      }
    }

    if (!requiredDeadline) {
      alert('Por favor ingrese la fecha límite requerida para las revisiones.');
      return;
    }

    setSaving(true);
    try {
      const parsedDeadline = parseLocalDate(requiredDeadline);
      
      const updatedReviews: any = { ...request.reviews };
      Object.entries(reviewAssignments).forEach(([areaKey, value]) => {
        const val = value as any;
        const area = updatedReviews[areaKey] as AreaReview;
        area.applies = val.applies;
        if (val.applies) {
          const respUser = users.find(u => u.id === val.responsibleId);
          area.responsibleId = val.responsibleId;
          area.responsibleEmail = respUser?.email || '';
          area.responsibleName = respUser?.displayName || respUser?.email || '';
          area.deadline = parsedDeadline;
          area.status = 'pending';
        } else {
          area.responsibleId = '';
          area.responsibleEmail = '';
          area.responsibleName = '';
          area.deadline = null;
          area.status = 'approved'; // Non-applicable areas are auto-approved
        }
      });

      const docRef = doc(db, 'change_requests', request.id);
      await updateDoc(docRef, {
        reviews: updatedReviews,
        status: 'pending_review',
        updatedAt: serverTimestamp()
      });

      // Update local state
      const updatedRequest = {
        ...request,
        status: 'pending_review' as const,
        reviews: updatedReviews
      };
      setRequest(updatedRequest);
      setActiveTab('review');

      // Send emails to each assigned reviewer
      const emailPromises = activeAreas.map(async ([areaKey, value]) => {
        const val = value as any;
        const respUser = users.find(u => u.id === val.responsibleId);
        if (!respUser || !respUser.email) return;

        const areaNameMap: Record<string, string> = {
          ingenieriaProcesos: 'Ingeniería de Procesos',
          produccion: 'Producción',
          mantenimiento: 'Mantenimiento',
          calidad: 'Calidad',
          supplyChain: 'Supply Chain',
          hse: 'Salud, Seguridad y Medio Ambiente (HSE)',
          infraestructura: 'Infraestructura',
          recursosHumanos: 'Recursos Humanos'
        };

        const subject = `[Crucianelli Calidad] Solicitud de Cambio Pendiente de Revisión - SC-#${request.changeNumber}`;
        const body = `Hola ${respUser.displayName || respUser.email},

Has sido asignado por ${request.creatorName} como el responsable de revisar la propuesta de cambio "SC-#${request.changeNumber}: ${request.title}" para el área de ${areaNameMap[areaKey] || areaKey}.

Fecha límite requerida para la revisión: ${format(parsedDeadline, 'dd/MM/yyyy')}

Por favor ingresá al sistema para completar el cuestionario de impacto del área, definir las acciones correctivas si fuesen necesarias y emitir tu aprobación o rechazo.

Enlace a la solicitud de cambio:
${window.location.origin}/change-request/${request.id}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

        await sendNotification({
          to: respUser.email,
          subject,
          body,
          type: 'assignment'
        });
      });

      await Promise.all(emailPromises);
      alert('Solicitud enviada a revisión con éxito.');

    } catch (err) {
      console.error('Error sending to review:', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Stage 2: Save Checklist changes for a specific area, and optionally approve/reject
  const handleReviewAction = async (areaKey: string, isApproval: boolean) => {
    const area = request.reviews[areaKey as keyof typeof request.reviews] as AreaReview;
    if (area.responsibleId !== user.id) {
      alert('No tenés permisos para tomar decisiones en esta revisión técnica sectorial.');
      return;
    }
    const comments = stage2Comments[areaKey] || '';

    // Validate that checklist has been completely filled out
    if (isApproval) {
      // 1. Every question must have applies set to 'SI', 'NO', or 'NA' (not empty)
      const hasUnansweredApplies = area.checklist.some(q => !q.applies);
      if (hasUnansweredApplies) {
        alert('Por favor complete la columna "Aplica" para todas las preguntas antes de aprobar.');
        return;
      }

      // 2. For any question where applies is 'SI', requiresAction must be 'SI' or 'NO' (not empty)
      const hasUnansweredRequiresAction = area.checklist.some(q => q.applies === 'SI' && !q.requiresAction);
      if (hasUnansweredRequiresAction) {
        alert('Por favor complete la columna "Requiere Acción" para todas las preguntas aplicables antes de aprobar.');
        return;
      }

      // 3. If requiresAction is 'SI', then corrective action must be linked
      const pendingActions = area.checklist.filter(q => q.applies === 'SI' && q.requiresAction === 'SI' && !q.actionId);
      if (pendingActions.length > 0) {
        alert('Hay preguntas que requieren acción en las cuales aún no se ha generado la acción correctiva vinculada. Por favor, genere la acción para cada una antes de aprobar.');
        return;
      }
    }

    setSaving(true);
    try {
      const updatedReviews = { ...request.reviews };
      const currentArea = updatedReviews[areaKey as keyof typeof request.reviews] as AreaReview;
      
      currentArea.status = isApproval ? 'approved' : 'rejected';
      currentArea.comments = comments.trim();
      currentArea.actionDate = new Date();

      const docRef = doc(db, 'change_requests', request.id);
      
      // Determine new overall status of change request
      // If any applies review is rejected, status becomes 'rejected' overall
      // If all applies reviews are approved, status goes to 'pending_approval' (Stage 3)
      let overallStatus = request.status;
      const allActive = (Object.values(updatedReviews) as AreaReview[]).filter(r => r.applies);
      const isAnyRejected = allActive.some(r => r.status === 'rejected');
      const isAllApproved = allActive.every(r => r.status === 'approved');

      if (isAnyRejected) {
        overallStatus = 'rejected';
      } else if (isAllApproved) {
        overallStatus = 'pending_approval';
      }

      await updateDoc(docRef, {
        reviews: updatedReviews,
        status: overallStatus,
        updatedAt: serverTimestamp()
      });

      const updatedRequest = {
        ...request,
        status: overallStatus,
        reviews: updatedReviews
      };
      setRequest(updatedRequest);

      // Trigger automatic email alert
      if (isAnyRejected) {
        // Notify owner of rejection
        const subject = `[Crucianelli Calidad] Solicitud de Cambio RECHAZADA - SC-#${request.changeNumber}`;
        const body = `Hola ${request.creatorName},

Te notificamos que la solicitud de cambio "SC-#${request.changeNumber}: ${request.title}" ha sido RECHAZADA durante la etapa de revisión por el área responsable.

Detalle del rechazo:
Área: ${areaKey}
Revisor: ${user.displayName || user.email}
Comentarios: ${comments || 'Sin comentarios.'}

Podés revisar los comentarios de impacto y desvíos detectados ingresando al portal.

Enlace al cambio:
${window.location.origin}/change-request/${request.id}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

        await sendNotification({
          to: request.creatorEmail,
          subject,
          body,
          type: 'overdue'
        });

        alert('La revisión ha sido guardada. Dado que fue rechazada, la solicitud ha pasado a estado RECHAZADO.');
        setActiveTab('communication');
      } else if (isAllApproved) {
        // Notify owner that reviews are complete
        const subject = `[Crucianelli Calidad] Revisiones Completadas - SC-#${request.changeNumber}`;
        const body = `Hola ${request.creatorName},

Todas las áreas de revisión aplicables han aprobado con éxito la solicitud de cambio "SC-#${request.changeNumber}: ${request.title}".

Próximos pasos:
Por favor ingresá al portal para proceder a la Etapa #3 (Aprobación Final). Deberás asignar al Aprobador Final y la fecha límite requerida para este hito.

Enlace al cambio:
${window.location.origin}/change-request/${request.id}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

        await sendNotification({
          to: request.creatorEmail,
          subject,
          body,
          type: 'verification'
        });

        alert('Todas las revisiones han sido aprobadas con éxito. La solicitud avanza a la etapa de Aprobación Final.');
        setActiveTab('approval');
      } else {
        alert('Revisión guardada con éxito.');
      }

    } catch (err) {
      console.error('Error saving area review:', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Intermediate save of checklist answers without approving/rejecting (no strict validation required)
  const handleSaveProgress = async (areaKey: string) => {
    const area = request.reviews[areaKey as keyof typeof request.reviews] as AreaReview;
    if (area.responsibleId !== user.id) {
      alert('No tenés permisos para guardar el progreso de esta revisión técnica sectorial.');
      return;
    }

    setSaving(true);
    try {
      const docRef = doc(db, 'change_requests', request.id);
      const updatedReviews = { ...request.reviews };
      const currentArea = updatedReviews[areaKey as keyof typeof request.reviews] as AreaReview;
      
      currentArea.comments = (stage2Comments[areaKey] || '').trim();

      await updateDoc(docRef, {
        reviews: updatedReviews,
        updatedAt: serverTimestamp()
      });

      setRequest({
        ...request,
        reviews: updatedReviews
      });

      alert('Progreso guardado con éxito.');
    } catch (err) {
      console.error('Error saving progress:', err);
      alert('Error al guardar el progreso: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Generate real Finding & Action correctiva from Stage 2 checklist
  const handleCreateLinkedAction = async (areaKey: string, questionIdx: number) => {
    const area = request.reviews[areaKey as keyof typeof request.reviews] as AreaReview;
    if (area.responsibleId !== user.id) {
      alert('No tenés permisos para generar planes de acción para esta revisión técnica sectorial.');
      return;
    }

    const currentQuestion = area?.checklist?.[questionIdx];
    if (currentQuestion?.actionId) {
      alert('Esta pregunta ya tiene un plan de acción correctiva vinculado.');
      return;
    }

    if (linkingActionKey) {
      return; // Already generating an action
    }

    const fState = actionForm[`${areaKey}-${questionIdx}`];
    if (!fState || !fState.description.trim() || !fState.responsibleId || !fState.deadline) {
      alert('Por favor complete la descripción de la acción, el responsable y la fecha límite.');
      return;
    }

    const actionLockKey = `${areaKey}-${questionIdx}`;
    setLinkingActionKey(actionLockKey);
    setSaving(true);
    try {
      const counterRef = doc(db, 'config', 'counters');
      const actionResponsibleUser = users.find(u => u.id === fState.responsibleId);

      const result = await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        const counterData = counterDoc.exists() ? counterDoc.data() : {};
        
        let lastFindingNumber = counterData.lastCorrectiveNumber || counterData.lastFindingNumber || 0;
        const nextFindingNumber = lastFindingNumber + 1;

        const newFindingRef = doc(collection(db, 'findings'));
        const actionRef = doc(collection(db, `findings/${newFindingRef.id}/correctiveActions`));

        const findingData = {
          findingNumber: nextFindingNumber,
          findingCategory: 'corrective',
          company: 'TMC', // Default or matching app company
          findingDate: new Date(),
          origin: 'Gestión de Cambios',
          type: 'Procedimiento / Documentación',
          process: 'Otros',
          description: `Acción vinculada a la Solicitud de Cambio SC-#${request.changeNumber}. Área: ${areaKey}. Pregunta: ${request.reviews[areaKey as keyof typeof request.reviews].checklist[questionIdx].question}. Detalle: ${fState.description}`,
          ownerId: user.id,
          ownerEmail: user.email,
          analysisResponsibleId: user.id,
          analysisResponsibleEmail: user.email,
          analysisDeadline: new Date(),
          status: 'pending_action', // Direct bypass
          isChangeRequest: true,
          changeRequestId: request.id,
          involvedUserIds: [user.id, fState.responsibleId].filter(uid => !!uid),
          pendingActionUserIds: [fState.responsibleId].filter(uid => !!uid),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const actionData = {
          description: fState.description.trim(),
          responsibleId: fState.responsibleId,
          responsibleEmail: actionResponsibleUser?.email || '',
          deadline: parseLocalDate(fState.deadline),
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        transaction.set(newFindingRef, findingData);
        transaction.set(actionRef, actionData);
        transaction.update(counterRef, {
          lastCorrectiveNumber: nextFindingNumber
        });

        return {
          findingId: newFindingRef.id,
          actionId: actionRef.id,
          findingNumber: nextFindingNumber
        };
      });

      // Update local state in DB for the checklist
      const updatedReviews = { ...request.reviews };
      const currentArea = updatedReviews[areaKey as keyof typeof request.reviews] as AreaReview;
      const question = currentArea.checklist[questionIdx];

      question.actionId = result.actionId;
      question.findingId = result.findingId;
      question.findingNumber = result.findingNumber;
      question.actionDescription = fState.description.trim();
      question.actionResponsibleId = fState.responsibleId;
      question.actionDeadline = parseLocalDate(fState.deadline).toISOString();

      const docRef = doc(db, 'change_requests', request.id);
      await updateDoc(docRef, {
        reviews: updatedReviews
      });

      setRequest({
        ...request,
        reviews: updatedReviews
      });

      // Send email to the assigned action responsible
      if (actionResponsibleUser?.email) {
        const subject = `[Crucianelli Calidad] Acción Correctiva Asignada - Gestión de Cambios SC-#${request.changeNumber}`;
        const body = `Hola ${actionResponsibleUser.displayName || actionResponsibleUser.email},

Se te ha asignado una acción correctiva vinculada a la Solicitud de Cambio "SC-#${request.changeNumber}: ${request.title}".

Descripción de la acción:
${fState.description.trim()}

Fecha límite de ejecución: ${format(parseLocalDate(fState.deadline), 'dd/MM/yyyy')}

Por favor ingresá al portal de calidad para dar seguimiento y cargar la evidencia correspondiente una vez ejecutada.

Enlace al hallazgo vinculado:
${window.location.origin}/findings/${result.findingId}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

        await sendNotification({
          to: actionResponsibleUser.email,
          subject,
          body,
          type: 'action_assigned'
        });
      }

      alert(`Acción vinculada creada con éxito en el Módulo de Acciones Correctivas (Hallazgo AC-#${result.findingNumber}).`);
      await fetchLinkedActions();

    } catch (err) {
      console.error('Error generating linked action:', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
      setLinkingActionKey(null);
    }
  };

  // Delete an accidental or duplicate linked action
  const handleRequestDeleteAction = (action: any) => {
    if (!action) return;

    if (user.role !== 'admin' && request.creatorId !== user.id) {
      alert('No tenés permisos para eliminar acciones vinculadas.');
      return;
    }

    setDeleteError(null);
    setActionToDelete(action);
  };

  const handleConfirmDeleteAction = async () => {
    if (!actionToDelete) return;
    const action = actionToDelete;

    setDeletingActionId(action.id);
    setDeleteError(null);
    try {
      // 1. Delete correctiveAction sub-document
      if (action.findingId && action.id) {
        try {
          await deleteDoc(doc(db, 'findings', action.findingId, 'correctiveActions', action.id));
        } catch (subErr) {
          console.warn('Could not delete sub-action document:', subErr);
        }
      }

      // 2. Delete parent finding document
      if (action.findingId) {
        try {
          await deleteDoc(doc(db, 'findings', action.findingId));
        } catch (findErr) {
          console.warn('Could not delete parent finding document:', findErr);
        }
      }

      // 3. Check if any question in request.reviews has this action/finding linked, and unbind it
      if (request.reviews) {
        let reviewsModified = false;
        const updatedReviews = { ...request.reviews };
        Object.keys(updatedReviews).forEach((areaKey) => {
          const areaRev = updatedReviews[areaKey as keyof typeof updatedReviews] as AreaReview;
          if (areaRev?.checklist) {
            areaRev.checklist.forEach((q) => {
              if (q.actionId === action.id || q.findingId === action.findingId) {
                reviewsModified = true;
                delete q.actionId;
                delete q.findingId;
                delete q.findingNumber;
                delete q.actionDescription;
                delete q.actionResponsibleId;
                delete q.actionDeadline;
              }
            });
          }
        });

        if (reviewsModified) {
          const crDocRef = doc(db, 'change_requests', request.id);
          await updateDoc(crDocRef, { reviews: updatedReviews });
          setRequest(prev => prev ? { ...prev, reviews: updatedReviews } : null);
        }
      }

      setActionToDelete(null);
      await fetchLinkedActions();
    } catch (err) {
      console.error('Error deleting linked action:', err);
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingActionId(null);
    }
  };

  // Stage 3: Send to Final Approval
  const handleSendToFinalApproval = async () => {
    if (request.creatorId !== user.id) {
      alert('No tenés permisos para asignar al aprobador final de esta solicitud.');
      return;
    }

    if (!finalApproverId) {
      alert('Por favor seleccione al aprobador final.');
      return;
    }
    if (!finalApprovalDeadline) {
      alert('Por favor ingrese la fecha límite para la aprobación.');
      return;
    }

    setSaving(true);
    try {
      const parsedDate = parseLocalDate(finalApprovalDeadline);
      const approverUser = users.find(u => u.id === finalApproverId);

      const docRef = doc(db, 'change_requests', request.id);
      await updateDoc(docRef, {
        finalApproverId,
        finalApproverEmail: approverUser?.email || '',
        finalApproverName: approverUser?.displayName || approverUser?.email || '',
        finalApprovalDeadline: parsedDate,
        finalApprovalStatus: 'pending',
        updatedAt: serverTimestamp()
      });

      setRequest({
        ...request,
        finalApproverId,
        finalApproverEmail: approverUser?.email || '',
        finalApproverName: approverUser?.displayName || approverUser?.email || '',
        finalApprovalDeadline: parsedDate,
        finalApprovalStatus: 'pending'
      });

      // Send email to Final Approver
      if (approverUser?.email) {
        const subject = `[Crucianelli Calidad] Solicitud de Cambio Pendiente de Aprobación Final - SC-#${request.changeNumber}`;
        const body = `Hola ${approverUser.displayName || approverUser.email},

Has sido asignado por ${request.creatorName} como el responsable de emitir la APROBACIÓN FINAL para la propuesta de cambio "SC-#${request.changeNumber}: ${request.title}".

Fecha límite requerida para tu decisión: ${format(parsedDate, 'dd/MM/yyyy')}

Todas las revisiones técnicas sectoriales han finalizado exitosamente con opinión favorable.

Por favor ingresá al sistema para emitir tu dictamen final de Aprobar o Rechazar el cambio.

Enlace al cambio:
${window.location.origin}/change-request/${request.id}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

        await sendNotification({
          to: approverUser.email,
          subject,
          body,
          type: 'assignment'
        });
      }

      alert('Enviado a aprobación final con éxito.');

    } catch (err) {
      console.error('Error sending to final approval:', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // Stage 3: Final Approval/Rejection Decision
  const handleFinalApprovalDecision = async (isApproval: boolean) => {
    if (request.finalApproverId !== user.id) {
      alert('No tenés permisos para tomar la decisión de aprobación final de esta solicitud.');
      return;
    }

    setSaving(true);
    try {
      const docRef = doc(db, 'change_requests', request.id);
      const newStatus = isApproval ? 'approved' : 'rejected';

      await updateDoc(docRef, {
        finalApprovalStatus: isApproval ? 'approved' : 'rejected',
        finalApprovalComments: stage3Comments.trim(),
        finalApprovalDate: new Date(),
        status: newStatus,
        updatedAt: serverTimestamp()
      });

      const updatedRequest: ChangeRequest = {
        ...request,
        finalApprovalStatus: isApproval ? 'approved' : 'rejected',
        finalApprovalComments: stage3Comments.trim(),
        finalApprovalDate: new Date().toISOString(),
        status: newStatus
      };
      setRequest(updatedRequest);
      setActiveTab('communication');

      // Stage 4 triggers automatically!
      // "Cuando el aprobador final haya tomado la decisión final Aprobar o Rechazar, deberá salir una notificación automática a todas las personas que estuvieron involucradas en el mismo durante todas las etapas notificando la decisión final."
      const involvedEmails = new Set<string>();
      involvedEmails.add(request.creatorEmail);
      if (request.finalApproverEmail) involvedEmails.add(request.finalApproverEmail);
      
      // Add all area reviewers
      (Object.values(request.reviews || {}) as AreaReview[]).forEach(r => {
        if (r.applies && r.responsibleEmail) {
          involvedEmails.add(r.responsibleEmail);
        }
      });

      const subject = `[Crucianelli Calidad] Decisión Final Solicitud de Cambio - SC-#${request.changeNumber} (${isApproval ? 'APROBADA' : 'RECHAZADA'})`;
      const body = `Hola a todo el equipo involucrado,

Se ha registrado el dictamen final para la propuesta de cambio "SC-#${request.changeNumber}: ${request.title}".

Dictamen final: ${isApproval ? 'APROBADA' : 'RECHAZADA'}
Aprobador Final: ${user.displayName || user.email}
Fecha de decisión: ${format(new Date(), 'dd/MM/yyyy HH:mm')}

Comentarios del aprobador:
${stage3Comments.trim() || 'Sin comentarios.'}

El flujo de evaluación formal ha concluido. Podés visualizar los desvíos, acciones preventivas y dictámenes detallados en el portal.

Enlace al cambio:
${window.location.origin}/change-request/${request.id}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

      // Dispatch notifications to all involved parties
      const emailList = Array.from(involvedEmails);
      const promises = emailList.map(email => 
        sendNotification({
          to: email,
          subject,
          body,
          type: isApproval ? 'verification' : 'overdue'
        })
      );
      await Promise.all(promises);

      // Save notification log in request object
      await updateDoc(docRef, {
        communicationSent: true,
        communicationSentDate: new Date(),
        communicationNotes: `Notificación enviada con éxito a ${emailList.length} involucrados: ${emailList.join(', ')}`
      });

      setRequest({
        ...updatedRequest,
        communicationSent: true,
        communicationSentDate: new Date().toISOString(),
        communicationNotes: `Notificación enviada con éxito a ${emailList.length} involucrados: ${emailList.join(', ')}`
      });

      alert(`Decisión final registrada con éxito. Se enviaron notificaciones a ${emailList.length} personas involucradas.`);

    } catch (err) {
      console.error('Error submitting final decision:', err);
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateChecklistQuestion = (areaKey: string, questionIdx: number, field: 'applies' | 'requiresAction', value: any) => {
    if (!request.reviews) return;
    const updatedReviews = { ...request.reviews };
    const currentArea = updatedReviews[areaKey as keyof typeof request.reviews] as AreaReview;
    if (currentArea.responsibleId !== user.id) {
      return;
    }
    const question = currentArea.checklist[questionIdx];
    
    question[field] = value;

    if (field === 'applies' && value !== 'SI') {
      question.requiresAction = '';
    }
    
    setRequest({
      ...request,
      reviews: updatedReviews
    });
  };

  const areaNameMap: Record<string, string> = {
    ingenieriaProcesos: 'Ingeniería de Procesos',
    produccion: 'Producción',
    mantenimiento: 'Mantenimiento',
    calidad: 'Calidad',
    supplyChain: 'Supply Chain',
    hse: 'Salud, Seguridad y Medio Ambiente',
    infraestructura: 'Infraestructura',
    recursosHumanos: 'Recursos Humanos'
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8" id="change-request-details-view">
      {/* Back to list button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-semibold cursor-pointer w-fit"
      >
        <ArrowLeft size={16} />
        <span>Volver al Listado</span>
      </button>

      {/* Header Info */}
      <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-3 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
              SC-#{request.changeNumber}
            </span>
            {request.status === 'draft' && (
              <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-slate-200">
                Borrador
              </span>
            )}
            {request.status === 'pending_review' && (
              <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-blue-100">
                En Revisión
              </span>
            )}
            {request.status === 'pending_approval' && (
              <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-amber-100">
                Pendiente Aprobación Final
              </span>
            )}
            {request.status === 'approved' && (
              <>
                <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-emerald-100">
                  Aprobado
                </span>
                {linkedActions.length > 0 && (
                  linkedActions.some(a => a.status === 'pending') ? (
                    <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-amber-200">
                      con acciones pendientes
                    </span>
                  ) : (
                    <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-emerald-200 font-bold">
                      acciones completadas
                    </span>
                  )
                )}
              </>
            )}
            {request.status === 'rejected' && (
              <span className="bg-red-50 text-red-700 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-red-100">
                Rechazado
              </span>
            )}
            <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wider">
              Misión: {request.mission}
            </span>
            {request.company && (
              <span className="bg-indigo-50 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-lg uppercase tracking-wider">
                Empresa: {request.company}
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight truncate">
            {request.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400 text-xs font-medium">
            <div className="flex items-center gap-1">
              <User size={13} />
              <span>Solicitante: {request.creatorName}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar size={13} />
              <span>Creado: {format(toDateSafe(request.createdAt), 'dd/MM/yyyy HH:mm')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stage Tabs Navigation */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto pb-px">
        <button
          onClick={() => setActiveTab('definition')}
          className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'definition' 
              ? 'border-emerald-600 text-emerald-700 font-extrabold' 
              : 'border-transparent text-slate-400 hover:text-slate-700'
          }`}
        >
          1. Definición del Cambio
        </button>
        <button
          onClick={() => setActiveTab('review')}
          disabled={request.status === 'draft'}
          className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'review' 
              ? 'border-emerald-600 text-emerald-700 font-extrabold' 
              : 'border-transparent text-slate-400 hover:text-slate-700 disabled:opacity-40'
          }`}
        >
          2. Revisión por Áreas
        </button>
        <button
          onClick={() => setActiveTab('approval')}
          disabled={request.status === 'draft' || request.status === 'pending_review'}
          className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'approval' 
              ? 'border-emerald-600 text-emerald-700 font-extrabold' 
              : 'border-transparent text-slate-400 hover:text-slate-700 disabled:opacity-40'
          }`}
        >
          3. Aprobación Final
        </button>
        <button
          onClick={() => setActiveTab('communication')}
          disabled={request.status === 'draft' || request.status === 'pending_review' || request.status === 'pending_approval'}
          className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'communication' 
              ? 'border-emerald-600 text-emerald-700 font-extrabold' 
              : 'border-transparent text-slate-400 hover:text-slate-700 disabled:opacity-40'
          }`}
        >
          4. Comunicación del Cambio
        </button>
        <button
          onClick={() => setActiveTab('actions_status')}
          disabled={request.status === 'draft'}
          className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 whitespace-nowrap transition-all ${
            activeTab === 'actions_status' 
              ? 'border-emerald-600 text-emerald-700 font-extrabold' 
              : 'border-transparent text-slate-400 hover:text-slate-700 disabled:opacity-40'
          }`}
        >
          5. Estado de Acciones
        </button>
      </div>

      {/* Active Tab Panel */}
      <div className="space-y-6">
        {/* TAB 1: DEFINICION */}
        {activeTab === 'definition' && (
          <div className="space-y-6" id="panel-definition">
            {/* General Description Card */}
            <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <ClipboardList className="text-emerald-600" size={20} />
                  <h2 className="text-base font-bold text-slate-800 tracking-tight">Propuesta de Cambio</h2>
                  {request.status === 'draft' && (
                    <span className="bg-amber-100 text-amber-800 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border border-amber-200">
                      Borrador editable
                    </span>
                  )}
                </div>
                {canEditDefinition && !isEditingDefinition && (
                  <button
                    type="button"
                    onClick={handleStartEditDefinition}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl text-xs transition-all cursor-pointer border border-emerald-200 shadow-xs"
                  >
                    <Edit3 size={14} />
                    <span>Editar Propuesta</span>
                  </button>
                )}
                {isEditingDefinition && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={savingDefinition}
                      onClick={handleCancelEditDefinition}
                      className="flex items-center gap-1 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      <X size={14} />
                      <span>Cancelar</span>
                    </button>
                    <button
                      type="button"
                      disabled={savingDefinition}
                      onClick={handleSaveDefinition}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      {savingDefinition ? (
                        <>
                          <RefreshCw size={13} className="animate-spin" />
                          <span>Guardando...</span>
                        </>
                      ) : (
                        <>
                          <Save size={14} />
                          <span>Guardar Cambios</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {!isEditingDefinition ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-semibold text-slate-500">
                    <div className="bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100 flex justify-between items-center">
                      <span>Misión:</span>
                      <span className="text-slate-800 font-bold">{request.mission}</span>
                    </div>
                    {request.company && (
                      <div className="bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100 flex justify-between items-center">
                        <span>Empresa:</span>
                        <span className="text-indigo-800 font-bold">{request.company}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                    <div className="space-y-1 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Descripción</span>
                      <p className="text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{request.description}</p>
                    </div>
                    <div className="space-y-1 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Objetivo</span>
                      <p className="text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{request.objective}</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 space-y-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Cuadro Comparativo</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-red-100 bg-red-50/20 p-4 rounded-xl space-y-1.5">
                        <span className="text-xs font-bold text-red-700 block">Situación Actual</span>
                        <p className="text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{request.currentSituation}</p>
                      </div>
                      <div className="border border-emerald-100 bg-emerald-50/20 p-4 rounded-xl space-y-1.5">
                        <span className="text-xs font-bold text-emerald-700 block">Situación Propuesta</span>
                        <p className="text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{request.proposedSituation}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Análisis de Impacto Inicial</span>
                    <p className="text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{request.impactAnalysis}</p>
                  </div>
                </>
              ) : (
                <div className="space-y-6 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        Título de la Propuesta *
                      </label>
                      <input
                        type="text"
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 font-medium"
                        value={definitionForm.title}
                        onChange={(e) => setDefinitionForm({ ...definitionForm, title: e.target.value })}
                        placeholder="Ej. Modificación de plantilla de soldado..."
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        Empresa *
                      </label>
                      <select
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-700 font-semibold cursor-pointer"
                        value={definitionForm.company}
                        onChange={(e) => setDefinitionForm({ ...definitionForm, company: e.target.value })}
                      >
                        <option value="">Seleccionar...</option>
                        {['Crucianelli', 'TMC', 'Fertec', 'Fabril', 'Leaf', 'Metallo'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        Misión de la Propuesta *
                      </label>
                      <select
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-700 font-semibold cursor-pointer"
                        value={definitionForm.mission}
                        onChange={(e) => setDefinitionForm({ ...definitionForm, mission: e.target.value as any })}
                      >
                        {['Calidad', 'Productividad', 'Seguridad y Medio Ambiente', 'Costos', 'Otros'].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                      Descripción de la Propuesta *
                    </label>
                    <textarea
                      rows={4}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 font-medium leading-relaxed"
                      value={definitionForm.description}
                      onChange={(e) => setDefinitionForm({ ...definitionForm, description: e.target.value })}
                      placeholder="Describa claramente la modificación sugerida..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                      Objetivo del Cambio *
                    </label>
                    <textarea
                      rows={2}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 font-medium leading-relaxed"
                      value={definitionForm.objective}
                      onChange={(e) => setDefinitionForm({ ...definitionForm, objective: e.target.value })}
                      placeholder="¿Qué mejoras o soluciones se pretenden alcanzar?..."
                    />
                  </div>

                  <div className="border border-slate-200 bg-slate-50/50 p-5 rounded-2xl space-y-4">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Cuadro Comparativo</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-red-700 text-xs font-bold">
                          <span className="w-2 h-2 rounded-full bg-red-500"></span>
                          <span>Situación Actual *</span>
                        </div>
                        <textarea
                          rows={4}
                          required
                          className="w-full bg-white border border-red-200 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 text-slate-800 font-medium leading-relaxed"
                          value={definitionForm.currentSituation}
                          onChange={(e) => setDefinitionForm({ ...definitionForm, currentSituation: e.target.value })}
                          placeholder="Describa el estado o diseño de partida..."
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-700 text-xs font-bold">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span>Situación Propuesta *</span>
                        </div>
                        <textarea
                          rows={4}
                          required
                          className="w-full bg-white border border-emerald-200 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400 text-slate-800 font-medium leading-relaxed"
                          value={definitionForm.proposedSituation}
                          onChange={(e) => setDefinitionForm({ ...definitionForm, proposedSituation: e.target.value })}
                          placeholder="Describa el nuevo estado propuesto..."
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                      Análisis de Impacto Inicial *
                    </label>
                    <textarea
                      rows={3}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800 font-medium leading-relaxed"
                      value={definitionForm.impactAnalysis}
                      onChange={(e) => setDefinitionForm({ ...definitionForm, impactAnalysis: e.target.value })}
                      placeholder="Impacto sobre Medio Ambiente, Seguridad, Calidad, Productividad, etc...."
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      disabled={savingDefinition}
                      onClick={handleCancelEditDefinition}
                      className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={savingDefinition}
                      onClick={handleSaveDefinition}
                      className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
                    >
                      {savingDefinition ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>Guardando...</span>
                        </>
                      ) : (
                        <>
                          <Save size={14} />
                          <span>Guardar Cambios</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Area Review configuration - Visible/Editable by request owner if Status is draft */}
            {request.status === 'draft' && (isCreator || user.role === 'admin') ? (
              <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                  <ShieldAlert className="text-amber-500" size={20} />
                  <h2 className="text-base font-bold text-slate-800 tracking-tight">Asignación de Revisiones Sectoriales</h2>
                </div>

                <p className="text-xs text-slate-500">
                  Defina las áreas organizacionales que deben analizar esta modificación. Para cada una que aplique, asigne un profesional idóneo que se encargará del dictamen técnico. La fecha requerida será uniforme para todos los revisores.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.entries(areaNameMap).map(([key, label]) => {
                    const localVal = reviewAssignments[key] || { applies: false, responsibleId: '' };
                    return (
                      <div key={key} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-slate-800">{label}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 font-semibold">¿Aplica?</span>
                            <select
                              className="bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 py-1 px-2.5 cursor-pointer"
                              value={localVal.applies ? 'SI' : 'NO'}
                              onChange={(e) => {
                                const val = e.target.value === 'SI';
                                setReviewAssignments({
                                  ...reviewAssignments,
                                  [key]: { ...localVal, applies: val }
                                });
                              }}
                            >
                              <option value="NO">NO</option>
                              <option value="SI">SI</option>
                            </select>
                          </div>
                        </div>

                        {localVal.applies && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Responsable de Revisión</span>
                            <UserSelect
                              users={users}
                              value={localVal.responsibleId}
                              onChange={(userId) => {
                                setReviewAssignments({
                                  ...reviewAssignments,
                                  [key]: { ...localVal, responsibleId: userId }
                                });
                              }}
                              placeholder="Asignar Revisor..."
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2 border-t border-slate-100">
                  <div className="space-y-1.5 md:col-span-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                      Fecha Límite Requerida (Común) *
                    </label>
                    <input
                      type="date"
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-700 font-semibold"
                      value={requiredDeadline}
                      onChange={(e) => setRequiredDeadline(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  {isEditingDefinition ? (
                    <p className="text-xs text-amber-700 font-semibold">
                      ⚠️ Guardá o cancelá los cambios en la propuesta de arriba antes de enviar a revisión.
                    </p>
                  ) : <div></div>}
                  <button
                    onClick={handleSendToReview}
                    disabled={saving || isEditingDefinition}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer text-sm disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Enviar a Revisión</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              // Read only reviews assignment display
              <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                  <ShieldAlert className="text-slate-700" size={20} />
                  <h2 className="text-base font-bold text-slate-800 tracking-tight">Revisiones Sectoriales Asignadas</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(request.reviews || {}).map(([key, val]) => {
                    const review = val as AreaReview;
                    return (
                      <div key={key} className={`p-4 border rounded-2xl flex items-center justify-between ${
                        review.applies ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50/50 opacity-60'
                      }`}>
                        <div>
                          <div className="font-bold text-slate-800 text-sm">{areaNameMap[key] || key}</div>
                          {review.applies ? (
                            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 font-medium">
                              <User size={12} />
                              <span>{review.responsibleName}</span>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400 mt-1 font-semibold uppercase tracking-wider">No Aplica</div>
                          )}
                        </div>

                        {review.applies && (
                          <div>
                            {review.status === 'approved' && (
                              <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-emerald-100 flex items-center gap-1">
                                <CheckCircle2 size={13} />
                                Aprobado
                              </span>
                            )}
                            {review.status === 'rejected' && (
                              <span className="bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-red-100 flex items-center gap-1">
                                <XCircle size={13} />
                                Rechazado
                              </span>
                            )}
                            {review.status === 'pending' && (
                              <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-amber-100 flex items-center gap-1">
                                <Clock size={13} />
                                Pendiente
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REVISION POR AREAS */}
        {activeTab === 'review' && (
          <div className="space-y-6" id="panel-review">
            <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                <ShieldAlert className="text-blue-600" size={20} />
                <h2 className="text-base font-bold text-slate-800 tracking-tight">Evaluaciones de Impacto</h2>
              </div>
              <p className="text-xs text-slate-500">
                Cada área responsable debe responder las preguntas de impacto sobre su respectivo sector. Si alguna requiere acción correctiva, asocie un plan de acción para que se vincule directamente al módulo correspondiente.
              </p>
            </div>

            {/* 8 Areas Loop */}
            <div className="space-y-4" id="review-areas-accordion-container">
              {Object.entries(request.reviews || {}).map(([key, val]) => {
                const review = val as AreaReview;
                if (!review.applies) return null;

                const isExpanded = expandedArea === key;
                const isAssignedToMe = review.responsibleId === user.id;
                const isCompleted = review.status !== 'pending';
                const canEditThisReview = (review.responsibleId === user.id || user.role === 'admin') && !isCompleted;

                return (
                  <div 
                    key={key} 
                    className={`bg-white rounded-2xl border transition-all overflow-hidden ${
                      isExpanded ? 'border-emerald-500 shadow-md' : 'border-slate-100 shadow-sm'
                    }`}
                  >
                    {/* Header bar of area review */}
                    <div 
                      onClick={() => setExpandedArea(isExpanded ? null : key)}
                      className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="font-bold text-slate-800 text-sm tracking-tight">
                            {areaNameMap[key] || key}
                          </h3>
                          {isAssignedToMe && !isCompleted && (
                            <span className="bg-blue-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                              Tu Revisión
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                          <User size={12} />
                          <span>Revisor: {review.responsibleName}</span>
                          <span className="text-slate-300">•</span>
                          <Calendar size={12} />
                          <span>Límite: {format(toDateSafe(review.deadline), 'dd/MM/yyyy')}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {review.status === 'approved' && (
                          <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-emerald-100 flex items-center gap-1">
                            <CheckCircle2 size={13} />
                            Aprobado
                          </span>
                        )}
                        {review.status === 'rejected' && (
                          <span className="bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-red-100 flex items-center gap-1">
                            <XCircle size={13} />
                            Rechazado
                          </span>
                        )}
                        {review.status === 'pending' && (
                          <span className="bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-amber-100 flex items-center gap-1">
                            <Clock size={13} />
                            Pendiente
                          </span>
                        )}
                        {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                      </div>
                    </div>

                    {/* Collapsible checklist body */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 p-6 space-y-6 bg-slate-50/30">
                        {review.comments && (
                          <div className="bg-slate-100/70 p-4 rounded-xl border border-slate-200/50 space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Observaciones</span>
                            <p className="text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{review.comments}</p>
                          </div>
                        )}

                        {/* Checklist Table */}
                        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                                <th className="p-4 w-12 text-center">Nº</th>
                                <th className="p-4">Pregunta / Control</th>
                                <th className="p-4 w-32 text-center">Aplica</th>
                                <th className="p-4 w-36 text-center">Requiere Acción</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                              {review.checklist.map((q, idx) => {
                                const localActionState = actionForm[`${key}-${idx}`] || { description: '', responsibleId: '', deadline: '' };

                                return (
                                  <React.Fragment key={q.id}>
                                    <tr className="hover:bg-slate-50/40">
                                      <td className="p-4 text-center font-bold text-slate-400">{idx + 1}</td>
                                      <td className="p-4 font-medium text-slate-800 leading-relaxed">{q.question}</td>
                                      <td className="p-4 text-center">
                                        {canEditThisReview ? (
                                          <select
                                            className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 p-1.5 cursor-pointer w-24"
                                            value={q.applies || ''}
                                            onChange={(e) => handleUpdateChecklistQuestion(key, idx, 'applies', e.target.value)}
                                          >
                                            <option value="">--</option>
                                            <option value="SI">SI</option>
                                            <option value="NO">NO</option>
                                            <option value="NA">NA</option>
                                          </select>
                                        ) : (
                                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide uppercase ${
                                            q.applies === 'SI' ? 'bg-blue-50 text-blue-700' : q.applies === 'NO' ? 'bg-slate-100 text-slate-500' : q.applies === 'NA' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-400'
                                          }`}>
                                            {q.applies || 'Pendiente'}
                                          </span>
                                        )}
                                      </td>
                                      <td className="p-4 text-center">
                                        {canEditThisReview ? (
                                          <select
                                            disabled={q.applies !== 'SI'}
                                            className="bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 p-1.5 cursor-pointer w-24 disabled:opacity-40"
                                            value={q.requiresAction || ''}
                                            onChange={(e) => handleUpdateChecklistQuestion(key, idx, 'requiresAction', e.target.value)}
                                          >
                                            <option value="">--</option>
                                            <option value="SI">SI</option>
                                            <option value="NO">NO</option>
                                          </select>
                                        ) : (
                                          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wide uppercase ${
                                            q.requiresAction === 'SI' ? 'bg-amber-50 text-amber-700' : q.requiresAction === 'NO' ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-400'
                                          }`}>
                                            {q.requiresAction || '—'}
                                          </span>
                                        )}
                                      </td>
                                    </tr>

                                    {/* Sub-form or action link display */}
                                    {q.requiresAction === 'SI' && (
                                      <tr className="bg-slate-50/50">
                                        <td></td>
                                        <td colSpan={3} className="p-4 border-t border-slate-200/50">
                                          {q.actionId ? (
                                            // Action Linked successfully display
                                            <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                              <div className="space-y-1">
                                                <div className="flex items-center gap-1.5">
                                                  <Check className="text-emerald-600" size={14} />
                                                  <span className="font-extrabold text-emerald-800">Acción Correctiva Vinculada Exitosamente</span>
                                                  <span className="text-slate-400 font-mono text-[10px] bg-white border border-slate-100 px-1.5 py-0.5 rounded">AC-#{q.findingNumber}</span>
                                                </div>
                                                <p className="text-slate-600 font-medium">{q.actionDescription}</p>
                                                <div className="text-[11px] text-slate-400 font-medium">
                                                  Responsable: {users.find(u => u.id === q.actionResponsibleId)?.displayName || 'Desconocido'} | Límite: {format(new Date(q.actionDeadline), 'dd/MM/yyyy')}
                                                </div>
                                              </div>
                                              <button
                                                onClick={() => navigate(`/findings/${q.findingId}`)}
                                                className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-lg text-[10px] uppercase tracking-wider cursor-pointer"
                                              >
                                                Ver Hallazgo
                                              </button>
                                            </div>
                                          ) : (
                                            // Form to create real linked finding action
                                            canEditThisReview ? (
                                              <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 space-y-4">
                                                <div className="flex items-center gap-1.5 text-amber-800 font-bold">
                                                  <AlertCircle size={15} />
                                                  <span>Crear Acción Correctiva Vinculada</span>
                                                </div>

                                                <div className="space-y-1">
                                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Descripción de la acción</label>
                                                  <input
                                                    type="text"
                                                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                                                    placeholder="Ej. Re-diseñar plano de montaje o crear nuevo instructivo..."
                                                    value={localActionState.description}
                                                    onChange={(e) => {
                                                      setActionForm({
                                                        ...actionForm,
                                                        [`${key}-${idx}`]: { ...localActionState, description: e.target.value }
                                                      });
                                                    }}
                                                  />
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                  <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Responsable</label>
                                                    <UserSelect
                                                      users={users}
                                                      value={localActionState.responsibleId}
                                                      onChange={(uid) => {
                                                        setActionForm({
                                                          ...actionForm,
                                                          [`${key}-${idx}`]: { ...localActionState, responsibleId: uid }
                                                        });
                                                      }}
                                                      placeholder="Asignar Responsable de la Acción..."
                                                    />
                                                  </div>
                                                  <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Fecha Límite</label>
                                                    <input
                                                      type="date"
                                                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs"
                                                      value={localActionState.deadline}
                                                      onChange={(e) => {
                                                        setActionForm({
                                                          ...actionForm,
                                                          [`${key}-${idx}`]: { ...localActionState, deadline: e.target.value }
                                                        });
                                                      }}
                                                    />
                                                  </div>
                                                </div>

                                                <div className="flex justify-end">
                                                  <button
                                                    onClick={() => handleCreateLinkedAction(key, idx)}
                                                    disabled={saving || !!linkingActionKey}
                                                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-xs cursor-pointer shadow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                  >
                                                    {linkingActionKey === `${key}-${idx}` ? (
                                                      <>
                                                        <RefreshCw size={14} className="animate-spin" />
                                                        <span>Vinculando plan...</span>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Plus size={14} />
                                                        <span>Vincular Plan de Acción</span>
                                                      </>
                                                    )}
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="bg-slate-100 p-3 rounded-lg text-slate-500 text-[11px] font-medium flex items-center gap-1.5">
                                                <Info size={14} />
                                                <span>No se generó ningún plan de acción correctiva para esta pregunta.</span>
                                              </div>
                                            )
                                          )}
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Area actions (Approve/Reject) */}
                        {canEditThisReview && (
                          <div className="space-y-4 pt-4 border-t border-slate-100">
                            <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block flex items-center gap-1">
                                <MessageSquare size={13} />
                                <span>Observaciones / Fundamentos Técnicos (Opcional)</span>
                              </label>
                              <textarea
                                rows={2}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs focus:ring-1 focus:ring-emerald-500"
                                placeholder="Escriba comentarios, salvedades o justificación del rechazo/aprobación..."
                                value={stage2Comments[key] || ''}
                                onChange={(e) => setStage2Comments({ ...stage2Comments, [key]: e.target.value })}
                              />
                            </div>

                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleReviewAction(key, false)}
                                disabled={saving}
                                className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold px-5 py-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-50"
                              >
                                <XCircle size={14} />
                                <span>Rechazar Solicitud</span>
                              </button>
                              <button
                                onClick={() => handleSaveProgress(key)}
                                disabled={saving}
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold px-5 py-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw size={14} className={saving ? "animate-spin" : ""} />
                                <span>Guardar Progreso</span>
                              </button>
                              <button
                                onClick={() => handleReviewAction(key, true)}
                                disabled={saving}
                                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-2.5 rounded-lg text-xs cursor-pointer disabled:opacity-50 shadow"
                              >
                                <CheckCircle2 size={14} />
                                <span>Aprobar Solicitud</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: APROBACION FINAL */}
        {activeTab === 'approval' && (
          <div className="space-y-6" id="panel-approval">
            {/* Setup Stage 3 - Config by Owner */}
            {(!request.finalApproverId || request.finalApprovalStatus !== 'pending') && (isCreator || user.role === 'admin') && (
              <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                  <CheckCircle2 className="text-emerald-600" size={20} />
                  <h2 className="text-base font-bold text-slate-800 tracking-tight">Iniciar Aprobación Final</h2>
                </div>

                <p className="text-xs text-slate-500">
                  Todas las áreas técnicas correspondientes han analizado y aprobado favorablemente este cambio. Designe la persona responsable de emitir el dictamen formal final de autorización.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Aprobador Final</label>
                    <UserSelect
                      users={users}
                      value={finalApproverId}
                      onChange={setFinalApproverId}
                      placeholder="Seleccionar Aprobador..."
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Fecha Límite Requerida</label>
                    <input
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm"
                      value={finalApprovalDeadline}
                      onChange={(e) => setFinalApprovalDeadline(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSendToFinalApproval}
                    disabled={saving}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-3.5 rounded-xl shadow-lg cursor-pointer text-sm disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Enviar a Aprobación Final</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Display / Execute Final Decision */}
            {request.finalApproverId && (
              <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="text-emerald-600" size={20} />
                    <h2 className="text-base font-bold text-slate-800 tracking-tight">Aprobación Final Autorizada</h2>
                  </div>

                  {request.finalApprovalStatus === 'approved' && (
                    <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-100 flex items-center gap-1.5">
                      <CheckCircle2 size={14} />
                      Aprobado
                    </span>
                  )}
                  {request.finalApprovalStatus === 'rejected' && (
                    <span className="bg-red-50 text-red-700 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-100 flex items-center gap-1.5">
                      <XCircle size={14} />
                      Rechazado
                    </span>
                  )}
                  {request.finalApprovalStatus === 'pending' && (
                    <span className="bg-amber-50 text-amber-700 text-xs font-bold px-3 py-1.5 rounded-lg border border-amber-100 flex items-center gap-1.5">
                      <Clock size={14} />
                      Pendiente de Autorización
                    </span>
                  )}
                </div>

                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 text-xs text-slate-600 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <span className="font-bold text-slate-400 block uppercase tracking-wider text-[9px]">Aprobador Final Asignado</span>
                      <span className="text-slate-800 font-semibold">{request.finalApproverName}</span>
                    </div>
                    <div>
                      <span className="font-bold text-slate-400 block uppercase tracking-wider text-[9px]">Fecha Límite</span>
                      <span className="text-slate-800 font-semibold">{format(toDateSafe(request.finalApprovalDeadline), 'dd/MM/yyyy')}</span>
                    </div>
                  </div>
                  {request.finalApprovalDate && (
                    <div className="pt-2 border-t border-slate-200">
                      <span className="font-bold text-slate-400 block uppercase tracking-wider text-[9px]">Fecha de Decisión</span>
                      <span className="text-slate-800 font-semibold">{format(toDateSafe(request.finalApprovalDate), 'dd/MM/yyyy HH:mm')}</span>
                    </div>
                  )}
                </div>

                {request.finalApprovalComments && (
                  <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-1 text-xs">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Consideraciones de la Aprobación</span>
                    <p className="text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{request.finalApprovalComments}</p>
                  </div>
                )}

                {/* Final Decision buttons - only if status is pending and user is the final approver */}
                {(isFinalApprover || user.role === 'admin') && request.finalApprovalStatus === 'pending' && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                        Comentarios / Fundamentos del Dictamen Final *
                      </label>
                      <textarea
                        rows={3}
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-1 focus:ring-emerald-500"
                        placeholder="Escriba los fundamentos que respaldan la aprobación o rechazo final de la implementación..."
                        value={stage3Comments}
                        onChange={(e) => setStage3Comments(e.target.value)}
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleFinalApprovalDecision(false)}
                        disabled={saving}
                        className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold px-6 py-3 rounded-lg text-xs cursor-pointer disabled:opacity-50"
                      >
                        <XCircle size={14} />
                        <span>Rechazar Cambio</span>
                      </button>
                      <button
                        onClick={() => handleFinalApprovalDecision(true)}
                        disabled={saving}
                        className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-3 rounded-lg text-xs cursor-pointer disabled:opacity-50 shadow-md"
                      >
                        <CheckCircle2 size={14} />
                        <span>Aprobar e Implementar Cambio</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: COMUNICACION */}
        {activeTab === 'communication' && (
          <div className="space-y-6" id="panel-communication">
            <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                <CheckCircle2 className="text-emerald-600" size={20} />
                <h2 className="text-base font-bold text-slate-800 tracking-tight">Comunicación y Resultados</h2>
              </div>

              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex flex-col items-center justify-center text-center py-10 space-y-4">
                {request.status === 'approved' ? (
                  <>
                    <div className="p-4 bg-emerald-100 text-emerald-800 rounded-full">
                      <CheckCircle2 size={36} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-extrabold text-slate-800 text-base">La Propuesta ha sido Aprobada</h3>
                      <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                        El cambio fue formalmente aprobado. La organización y los involucrados técnicos correspondientes han sido formalmente notificados vía correo electrónico sobre esta decisión.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-4 bg-red-100 text-red-800 rounded-full">
                      <XCircle size={36} />
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-extrabold text-slate-800 text-base">La Propuesta ha sido Rechazada</h3>
                      <p className="text-xs text-slate-500 max-w-lg mx-auto leading-relaxed">
                        La propuesta fue rechazada o desestimada formalmente durante el circuito de evaluación. Se emitió la correspondiente notificación de rechazo a todos los implicados.
                      </p>
                    </div>
                  </>
                )}
              </div>

              {request.communicationSent && (
                <div className="bg-emerald-50/40 p-5 rounded-2xl border border-emerald-100 text-xs space-y-2">
                  <span className="font-bold text-emerald-800 block uppercase tracking-wider text-[10px]">Registro de Comunicación Oficial</span>
                  <p className="text-slate-600 font-medium leading-relaxed">{request.communicationNotes}</p>
                  {request.communicationSentDate && (
                    <div className="text-[10px] text-slate-400 font-semibold">
                      Completado el {format(toDateSafe(request.communicationSentDate), 'dd/MM/yyyy HH:mm')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: ESTADO DE ACCIONES */}
        {activeTab === 'actions_status' && (
          <div className="space-y-6" id="panel-actions-status">
            <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="text-emerald-600" size={20} />
                  <h2 className="text-base font-bold text-slate-800 tracking-tight">Estado de Acciones Vinculadas</h2>
                </div>
                
                {linkedActions.length > 0 && (
                  <div>
                    {linkedActions.some(a => a.status === 'pending') ? (
                      <span className="bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-200 uppercase tracking-wide">
                        Con Acciones Pendientes
                      </span>
                    ) : (
                      <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1.5 rounded-full border border-emerald-200 uppercase tracking-wide">
                        Acciones Completadas
                      </span>
                    )}
                  </div>
                )}
              </div>

              {loadingActions ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <RefreshCw className="animate-spin text-emerald-600" size={24} />
                  <span className="text-slate-400 text-xs font-semibold">Cargando estado de acciones...</span>
                </div>
              ) : linkedActions.length === 0 ? (
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex flex-col items-center justify-center text-center py-10 space-y-3">
                  <div className="p-3 bg-slate-100 text-slate-400 rounded-full">
                    <Info size={28} />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-bold text-slate-700 text-sm">No hay acciones registradas</h3>
                    <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                      Esta propuesta de cambio no cuenta con acciones de mitigación o correctivas vinculadas. Las acciones se generan durante la **Etapa 2 (Revisión por Áreas)** cuando una pregunta requiere acción.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl text-center">
                      <div className="text-2xl font-black text-slate-800">{linkedActions.length}</div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Total Acciones</div>
                    </div>
                    <div className="bg-blue-50/50 border border-blue-100/60 p-4 rounded-2xl text-center">
                      <div className="text-2xl font-black text-blue-700">
                        {linkedActions.filter(a => a.status === 'pending').length}
                      </div>
                      <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mt-1">Pendientes</div>
                    </div>
                    <div className="bg-emerald-50/50 border border-emerald-100/60 p-4 rounded-2xl text-center">
                      <div className="text-2xl font-black text-emerald-700">
                        {linkedActions.filter(a => a.status === 'finished').length}
                      </div>
                      <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mt-1">Completadas</div>
                    </div>
                    <div className="bg-slate-100/50 border border-slate-200/40 p-4 rounded-2xl text-center">
                      <div className="text-2xl font-black text-slate-600">
                        {linkedActions.filter(a => a.status === 'cancelled' || a.status === 'rejected').length}
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Canceladas/Rechazadas</div>
                    </div>
                  </div>

                  {/* Actions List */}
                  <div className="overflow-hidden border border-slate-100 rounded-2xl">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 font-bold uppercase border-b border-slate-100">
                            <th className="px-4 py-3">Hallazgo</th>
                            <th className="px-4 py-3">Descripción de la Acción</th>
                            <th className="px-4 py-3">Responsable</th>
                            <th className="px-4 py-3">Fecha Límite</th>
                            <th className="px-4 py-3">Estado</th>
                            <th className="px-4 py-3 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                          {linkedActions.map((action) => {
                            const responsibleUser = users.find(u => u.id === action.responsibleId);
                            const deadlineDate = toDateSafe(action.deadline);
                            return (
                              <tr key={action.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <span className="font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                    AC-#{action.findingNumber}
                                  </span>
                                </td>
                                <td className="px-4 py-3.5 max-w-xs sm:max-w-md">
                                  <p className="line-clamp-2 leading-relaxed">{action.description}</p>
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <div>
                                    <div className="font-bold text-slate-800">{responsibleUser?.displayName || action.responsibleEmail}</div>
                                    <div className="text-[10px] text-slate-400 font-normal">{action.responsibleEmail}</div>
                                  </div>
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  {format(deadlineDate, 'dd/MM/yyyy')}
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  {action.status === 'pending' && (
                                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100 text-[10px] font-bold uppercase">
                                      Pendiente
                                    </span>
                                  )}
                                  {action.status === 'finished' && (
                                    <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100 text-[10px] font-bold uppercase">
                                      Finalizado
                                    </span>
                                  )}
                                  {action.status === 'cancelled' && (
                                    <span className="bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md border border-slate-200 text-[10px] font-bold uppercase">
                                      Cancelado
                                    </span>
                                  )}
                                  {action.status === 'rejected' && (
                                    <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded-md border border-red-100 text-[10px] font-bold uppercase">
                                      Rechazado
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                  <div className="flex items-center justify-end gap-3">
                                    <button
                                      onClick={() => navigate(`/findings/${action.findingId}`)}
                                      className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-800 transition-colors font-bold cursor-pointer"
                                    >
                                      <span>Ver Hallazgo</span>
                                      <ExternalLink size={12} />
                                    </button>
                                    {(user.role === 'admin' || request.creatorId === user.id) && (
                                      <button
                                        onClick={() => handleRequestDeleteAction(action)}
                                        disabled={deletingActionId === action.id}
                                        title="Eliminar acción vinculada"
                                        className="inline-flex items-center gap-1 text-rose-600 hover:text-rose-800 transition-colors font-bold cursor-pointer disabled:opacity-50 text-xs"
                                      >
                                        <Trash2 size={13} />
                                        <span className="hidden sm:inline">Eliminar</span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Confirmation Modal for Deleting Linked Action */}
        {actionToDelete && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5 border border-slate-100">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="p-3 bg-rose-50 rounded-2xl border border-rose-100">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Eliminar Acción Vinculada</h3>
                  <span className="text-xs font-mono font-bold text-slate-500">AC-#{actionToDelete.findingNumber}</span>
                </div>
              </div>

              <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Descripción de la acción</span>
                <p className="text-slate-700 font-medium leading-relaxed">{actionToDelete.description || actionToDelete.findingDescription}</p>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                ¿Estás seguro de que deseás eliminar esta acción? Se removerá permanentemente de esta Solicitud de Cambio y se eliminará el hallazgo correspondiente.
              </p>

              {deleteError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
                  {deleteError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={!!deletingActionId}
                  onClick={() => setActionToDelete(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!!deletingActionId}
                  onClick={handleConfirmDeleteAction}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md hover:shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {deletingActionId ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Eliminando...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={13} />
                      <span>Sí, eliminar acción</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

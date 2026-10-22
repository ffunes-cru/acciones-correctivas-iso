import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, getDocs, updateDoc, deleteDoc, collection, runTransaction, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { SpecialRelease, UserProfile, FindingStatus, ActionStatus, UserRole } from '../types';
import { UserSelect } from './UserSelect';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { sendNotification, generateFindingLink } from '../services/notificationService';
import { triggerAutoSync } from '../lib/googleWorkspace';
import { 
  ArrowLeft, Clock, CheckCircle, XCircle, User, Calendar, 
  PlusCircle, Trash2, ShieldAlert, Send, FileText, CheckCircle2, 
  HelpCircle, Sparkles, MessageSquare, AlertTriangle, ShieldCheck, Mail, Loader2, Download,
  MinusCircle
} from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';

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

export default function SpecialReleaseDetails({ user }: { user: UserProfile }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [release, setRelease] = useState<SpecialRelease | null>(null);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showConfirmSendModal, setShowConfirmSendModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const isDeletingRef = useRef(false);

  // New action form state
  const [actionForm, setActionForm] = useState({
    description: '',
    responsibleId: '',
    deadline: '',
  });

  // Evaluation forms state per area
  const [evaluationForms, setEvaluationForms] = useState<Record<'calidad' | 'ingenieria' | 'comercial' | 'operaciones', { status: 'approved' | 'rejected', comments: string }>>({
    calidad: { status: 'approved', comments: '' },
    ingenieria: { status: 'approved', comments: '' },
    comercial: { status: 'approved', comments: '' },
    operaciones: { status: 'approved', comments: '' },
  });

  // Admin editing approval state
  const [adminEditingArea, setAdminEditingArea] = useState<'calidad' | 'ingenieria' | 'comercial' | 'operaciones' | null>(null);
  const [adminEditForm, setAdminEditForm] = useState<{ status: 'pending' | 'approved' | 'rejected'; comments: string }>({
    status: 'pending',
    comments: '',
  });

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        setUsersList(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
      } catch (e) {
        console.error('Error fetching users:', e);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    const unsubscribe = onSnapshot(doc(db, 'special_releases', id), (docSnap) => {
      if (docSnap.exists()) {
        setRelease({ id: docSnap.id, ...docSnap.data() } as SpecialRelease);
      } else {
        if (isDeletingRef.current) {
          // If we are actively deleting, don't trigger the warning or navigation
          return;
        }
        console.error('Release not found');
        alert('La solicitud de liberación especial no existe.');
        navigate('/');
      }
      setLoading(false);
    }, (error) => {
      console.error('Error listening to special release:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [id]);

  const handleAddLinkedAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !release || isSubmittingAction) return;

    if (!actionForm.description.trim()) {
      alert('Por favor especifique la descripción de la acción.');
      return;
    }
    if (!actionForm.responsibleId) {
      alert('Por favor seleccione un responsable.');
      return;
    }
    if (!actionForm.deadline) {
      alert('Por favor seleccione la fecha límite.');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDeadline = parseLocalDate(actionForm.deadline);
    if (selectedDeadline < today) {
      alert('La fecha requerida para la acción no puede ser una fecha pasada.');
      return;
    }

    setIsSubmittingAction(true);

    try {
      const counterRef = doc(db, 'config', 'counters');
      const actionResponsibleUser = usersList.find(u => u.id === actionForm.responsibleId);

      const result = await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        let nextNumber = 1;
        const counterData = counterDoc.exists() ? counterDoc.data() : {};
        
        nextNumber = (counterData.lastCorrectiveNumber || counterData.lastFindingNumber || 0) + 1;

        // 1. Create a background finding (skipping cause analysis directly to pending_action)
        const newFindingRef = doc(collection(db, 'findings'));
        const findingData = {
          findingNumber: nextNumber,
          findingCategory: 'corrective',
          company: release.company,
          findingDate: toDateSafe(release.date),
          origin: 'Muro/ Control de Calidad',
          type: 'Producto no conforme',
          process: 'Otros',
          description: `Acción vinculada a la Liberación Especial LE-#${release.releaseNumber}: desvío de ${release.type === 'raw_material' ? 'Materia prima' : 'Producto terminado'}. Detalle desvío: ${release.deviationDescription}`,
          ownerId: release.creatorId,
          ownerEmail: release.creatorEmail,
          analysisResponsibleId: release.creatorId,
          analysisResponsibleEmail: release.creatorEmail,
          analysisDeadline: toDateSafe(release.date),
          status: FindingStatus.PENDING_ACTION, // Direct bypass
          isSpecialRelease: true,
          specialReleaseId: release.id,
          involvedUserIds: [release.creatorId, actionForm.responsibleId].filter(uid => !!uid),
          pendingActionUserIds: [actionForm.responsibleId].filter(uid => !!uid),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        // 2. Create the corrective action sub-document
        const actionRef = doc(collection(db, 'findings', newFindingRef.id, 'correctiveActions'));
        const actionData = {
          description: actionForm.description,
          responsibleId: actionForm.responsibleId,
          responsibleEmail: actionResponsibleUser?.email || '',
          deadline: selectedDeadline,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        transaction.set(newFindingRef, findingData);
        transaction.set(actionRef, actionData);
        transaction.set(counterRef, { lastCorrectiveNumber: nextNumber, lastFindingNumber: nextNumber }, { merge: true });

        return {
          id: actionRef.id,
          findingId: newFindingRef.id,
          findingNumber: nextNumber,
          description: actionForm.description,
          responsibleId: actionForm.responsibleId,
          responsibleName: actionResponsibleUser?.displayName || '',
          deadline: selectedDeadline
        };
      });

      // 3. Update the special release linkedActions list
      const updatedLinkedActions = [...(release.linkedActions || []), {
        id: result.id,
        findingId: result.findingId,
        findingNumber: result.findingNumber,
        description: result.description,
        responsibleId: result.responsibleId,
        responsibleName: result.responsibleName,
        deadline: result.deadline,
        createdAt: new Date().toISOString()
      }];

      await updateDoc(doc(db, 'special_releases', id), {
        linkedActions: updatedLinkedActions,
        updatedAt: serverTimestamp()
      });

      // Send mail to action executor in the background
      const findingLink = generateFindingLink(result.findingId);
      sendNotification({
        to: actionResponsibleUser?.email || '',
        subject: `Acción Correctiva Asignada - Liberación Especial LE-#${release.releaseNumber}`,
        body: `Estimado/a ${actionResponsibleUser?.displayName || 'Usuario'}, se le ha asignado una acción correctiva en el marco de la Liberación Especial Número: LE-#${release.releaseNumber}. Por favor ingrese al siguiente enlace para reportar el avance: ${findingLink}`,
        type: 'action_assigned',
        findingId: result.findingId
      }).catch(err => console.error('Error sending assigned action email:', err));

      setActionForm({
        description: '',
        responsibleId: '',
        deadline: '',
      });

      // Synchronize to Google Sheets
      triggerAutoSync();

      alert('Acción correctiva agregada y vinculada en segundo plano con éxito.');
    } catch (err) {
      console.error('Error adding linked action:', err);
      alert('Error al vincular la acción correctiva.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleUpdateApprover = async (role: 'calidad' | 'ingenieria' | 'comercial' | 'operaciones' | 'posventa', userId: string) => {
    if (!id || !release) return;
    const selectedUser = usersList.find(u => u.id === userId);
    
    try {
      if (role === 'posventa') {
        await updateDoc(doc(db, 'special_releases', id), {
          'notifications.posventa': {
            userId: selectedUser?.id || '',
            userEmail: selectedUser?.email || '',
            userName: selectedUser?.displayName || '',
            confirmed: false
          }
        });
      } else {
        await updateDoc(doc(db, 'special_releases', id), {
          [`approvals.${role}`]: {
            userId: selectedUser?.id || '',
            userEmail: selectedUser?.email || '',
            userName: selectedUser?.displayName || '',
            status: 'pending',
            excluded: !!release.approvals[role]?.excluded
          }
        });
      }
    } catch (err) {
      console.error('Error updating approver:', err);
      alert('Error al actualizar el aprobador.');
    }
  };

  const handleToggleExcludeApprover = async (role: 'calidad' | 'ingenieria' | 'operaciones') => {
    if (!id || !release) return;
    if (!canEditApprovers) {
      alert('Error: No tiene permisos para modificar los aprobadores o la solicitud no está en borrador.');
      return;
    }

    try {
      const currentExcluded = !!release.approvals[role]?.excluded;
      const updatedExcluded = !currentExcluded;

      await updateDoc(doc(db, 'special_releases', id), {
        [`approvals.${role}.excluded`]: updatedExcluded,
        // Reset status to pending when changing exclusion state, and clear user if excluding
        [`approvals.${role}.status`]: 'pending',
        ...(updatedExcluded ? {
          [`approvals.${role}.userId`]: '',
          [`approvals.${role}.userEmail`]: '',
          [`approvals.${role}.userName`]: ''
        } : {})
      });
    } catch (err) {
      console.error('Error toggling approver exclusion:', err);
      alert('Error al modificar la exclusión del aprobador.');
    }
  };

  const handleSendForApproval = async () => {
    if (!id || !release || isUpdatingStatus) return;

    const missingApprovers: string[] = [];
    if (!release.approvals.calidad.excluded && !release.approvals.calidad.userId) missingApprovers.push('Calidad');
    if (!release.approvals.ingenieria.excluded && !release.approvals.ingenieria.userId) missingApprovers.push('Ingeniería');
    if (!release.approvals.comercial.userId) missingApprovers.push('Comercial');
    if (!release.approvals.operaciones.excluded && !release.approvals.operaciones.userId) missingApprovers.push('Operaciones');

    if (missingApprovers.length > 0) {
      alert(`Por favor seleccione los aprobadores para las áreas activas: ${missingApprovers.join(', ')} antes de enviar a revisión.`);
      return;
    }
    if (!release.notifications.posventa.userId) {
      alert('Por favor seleccione la persona a notificar en Posventa antes de enviar a revisión.');
      return;
    }

    setShowConfirmSendModal(true);
  };

  const onConfirmSend = async () => {
    if (!id || !release || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      await updateDoc(doc(db, 'special_releases', id), {
        status: 'pending_approval',
        updatedAt: serverTimestamp()
      });

      // Trigger emails to active areas only
      const approversEmails = [
        ...(!release.approvals.calidad.excluded ? [{ email: release.approvals.calidad.userEmail, name: release.approvals.calidad.userName, role: 'Calidad' }] : []),
        ...(!release.approvals.ingenieria.excluded ? [{ email: release.approvals.ingenieria.userEmail, name: release.approvals.ingenieria.userName, role: 'Ingeniería' }] : []),
        { email: release.approvals.comercial.userEmail, name: release.approvals.comercial.userName, role: 'Comercial' },
        ...(!release.approvals.operaciones.excluded ? [{ email: release.approvals.operaciones.userEmail, name: release.approvals.operaciones.userName, role: 'Operaciones' }] : [])
      ];

      const link = window.location.href;

      for (const appr of approversEmails) {
        if (appr.email) {
          await sendNotification({
            to: appr.email,
            subject: `FIRMA REQUERIDA: Solicitud de Liberación Especial LE-#${release.releaseNumber}`,
            body: `Estimado/a ${appr.name}, se ha registrado una solicitud de Liberación Especial LE-#${release.releaseNumber} que requiere de su firma de aprobación para el área de ${appr.role}. Por favor, ingrese al siguiente enlace para evaluar y confirmar: ${link}`,
            type: 'assignment'
          });
        }
      }

      // Notify posventa
      if (release.notifications.posventa.userEmail) {
        await sendNotification({
          to: release.notifications.posventa.userEmail,
          subject: `NOTIFICACIÓN: Solicitud de Liberación Especial LE-#${release.releaseNumber}`,
          body: `Estimado/a ${release.notifications.posventa.userName}, se ha enviado para aprobación la solicitud de Liberación Especial LE-#${release.releaseNumber}. Dado su rol en Posventa, ha sido copiado en esta solicitud. Ingrese aquí para confirmar su recepción: ${link}`,
          type: 'creation'
        });
      }

      setShowConfirmSendModal(false);
      alert('La solicitud ha sido enviada para aprobación exitosamente.');
    } catch (err) {
      console.error('Error sending for approval:', err);
      alert('Error al enviar para aprobación.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleEvaluateApprover = async (
    areaKey: 'calidad' | 'ingenieria' | 'comercial' | 'operaciones',
    status: 'approved' | 'rejected',
    comments: string
  ) => {
    if (!id || !release || isUpdatingStatus) return;

    // Check permissions: assigned user or administrator
    const isAssigned = release.approvals[areaKey]?.userId === user.id;
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAssigned && !isAdmin) {
      alert('Error: Usted no tiene permisos para evaluar esta área (debe ser el usuario asignado o administrador).');
      return;
    }

    if (status === 'rejected' && !comments.trim()) {
      alert('Los comentarios de la evaluación son obligatorios cuando la solicitud es rechazada.');
      return;
    }

    setIsUpdatingStatus(true);

    try {
      const releaseRef = doc(db, 'special_releases', id);

      // Construct update
      const updatedApprovals = {
        ...release.approvals,
        [areaKey]: {
          ...release.approvals[areaKey],
          status: status,
          comments: comments,
          actionDate: new Date().toISOString()
        }
      };

      // Check if all other areas has evaluated, and posventa confirmed
      const allEvaluated = 
        (updatedApprovals.calidad.excluded || updatedApprovals.calidad.status !== 'pending') &&
        (updatedApprovals.ingenieria.excluded || updatedApprovals.ingenieria.status !== 'pending') &&
        (updatedApprovals.comercial.excluded || updatedApprovals.comercial.status !== 'pending') &&
        (updatedApprovals.operaciones.excluded || updatedApprovals.operaciones.status !== 'pending');

      const posventaConfirmed = release.notifications.posventa.confirmed;

      const hasAnyRejection = 
        (!updatedApprovals.calidad.excluded && updatedApprovals.calidad.status === 'rejected') ||
        (!updatedApprovals.ingenieria.excluded && updatedApprovals.ingenieria.status === 'rejected') ||
        (!updatedApprovals.comercial.excluded && updatedApprovals.comercial.status === 'rejected') ||
        (!updatedApprovals.operaciones.excluded && updatedApprovals.operaciones.status === 'rejected');

      let finalStatus = 'pending_approval';
      let shouldSendResolutionEmail = false;

      if (hasAnyRejection) {
        finalStatus = 'rejected';
        if (release.status !== 'rejected') {
          shouldSendResolutionEmail = true;
        }
      } else if (allEvaluated && posventaConfirmed) {
        finalStatus = 'approved';
        if (release.status !== 'approved') {
          shouldSendResolutionEmail = true;
        }
      }

      await updateDoc(releaseRef, {
        approvals: updatedApprovals,
        status: finalStatus,
        updatedAt: serverTimestamp()
      });

      alert('Su firma de evaluación ha sido cargada con éxito.');

      // Send resolution email if completed
      if (shouldSendResolutionEmail) {
        const resolutionLabel = finalStatus === 'approved' ? 'APROBADA' : 'RECHAZADA';
        const recipients = [
          release.creatorEmail,
          release.approvals.calidad.userEmail,
          release.approvals.ingenieria.userEmail,
          release.approvals.comercial.userEmail,
          release.approvals.operaciones.userEmail,
          release.notifications.posventa.userEmail
        ].filter((e, idx, self) => !!e && self.indexOf(e) === idx);

        for (const rcpt of recipients) {
          await sendNotification({
            to: rcpt,
            subject: `RESOLUCIÓN FINAL: Solicitud de Liberación Especial LE-#${release.releaseNumber} [${resolutionLabel}]`,
            body: `Hola, le informamos que la solicitud de Liberación Especial LE-#${release.releaseNumber} ha completado su circuito de firmas autorizadas. El dictamen final es: ${resolutionLabel}. Puede consultar los detalles y comentarios ingresando al sistema: ${window.location.href}`,
            type: 'verification'
          });
        }
      }

      setEvaluationForms(prev => ({
        ...prev,
        [areaKey]: { status: 'approved', comments: '' }
      }));
    } catch (err) {
      console.error('Error evaluating:', err);
      alert('Error al guardar la evaluación.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleAdminEditApproval = async (
    areaKey: 'calidad' | 'ingenieria' | 'comercial' | 'operaciones',
    status: 'pending' | 'approved' | 'rejected',
    comments: string
  ) => {
    if (!id || !release || isUpdatingStatus) return;
    if (user.role !== UserRole.ADMIN) {
      alert('Error: Solo los administradores pueden realizar esta acción.');
      return;
    }

    if (status === 'rejected' && !comments.trim()) {
      alert('Los comentarios de la evaluación son obligatorios cuando la solicitud es rechazada.');
      return;
    }

    setIsUpdatingStatus(true);

    try {
      const releaseRef = doc(db, 'special_releases', id);

      // Construct update
      const updatedApprovals = {
        ...release.approvals,
        [areaKey]: {
          ...release.approvals[areaKey],
          status: status,
          comments: comments,
          actionDate: status === 'pending' ? null : new Date().toISOString()
        }
      };

      // Recalculate status
      const allEvaluated = 
        (updatedApprovals.calidad.excluded || updatedApprovals.calidad.status !== 'pending') &&
        (updatedApprovals.ingenieria.excluded || updatedApprovals.ingenieria.status !== 'pending') &&
        (updatedApprovals.comercial.excluded || updatedApprovals.comercial.status !== 'pending') &&
        (updatedApprovals.operaciones.excluded || updatedApprovals.operaciones.status !== 'pending');

      const posventaConfirmed = release.notifications.posventa.confirmed;

      const hasAnyRejection = 
        (!updatedApprovals.calidad.excluded && updatedApprovals.calidad.status === 'rejected') ||
        (!updatedApprovals.ingenieria.excluded && updatedApprovals.ingenieria.status === 'rejected') ||
        (!updatedApprovals.comercial.excluded && updatedApprovals.comercial.status === 'rejected') ||
        (!updatedApprovals.operaciones.excluded && updatedApprovals.operaciones.status === 'rejected');

      let finalStatus = 'pending_approval';
      let shouldSendResolutionEmail = false;

      if (hasAnyRejection) {
        finalStatus = 'rejected';
        if (release.status !== 'rejected') {
          shouldSendResolutionEmail = true;
        }
      } else if (allEvaluated && posventaConfirmed) {
        finalStatus = 'approved';
        if (release.status !== 'approved') {
          shouldSendResolutionEmail = true;
        }
      }

      await updateDoc(releaseRef, {
        approvals: updatedApprovals,
        status: finalStatus,
        updatedAt: serverTimestamp()
      });

      alert('Firma modificada correctamente por el administrador.');
      setAdminEditingArea(null);

      // Send resolution email if completed
      if (shouldSendResolutionEmail) {
        const resolutionLabel = finalStatus === 'approved' ? 'APROBADA' : 'RECHAZADA';
        const recipients = [
          release.creatorEmail,
          release.approvals.calidad.userEmail,
          release.approvals.ingenieria.userEmail,
          release.approvals.comercial.userEmail,
          release.approvals.operaciones.userEmail,
          release.notifications.posventa.userEmail
        ].filter((e, idx, self) => !!e && self.indexOf(e) === idx);

        for (const rcpt of recipients) {
          await sendNotification({
            to: rcpt,
            subject: `RESOLUCIÓN FINAL: Solicitud de Liberación Especial LE-#${release.releaseNumber} [${resolutionLabel}]`,
            body: `Hola, le informamos que la solicitud de Liberación Especial LE-#${release.releaseNumber} ha completado su circuito de firmas autorizadas. El dictamen final es: ${resolutionLabel}. Puede consultar los detalles y comentarios ingresando al sistema: ${window.location.href}`,
            type: 'verification'
          });
        }
      }
    } catch (err) {
      console.error('Error in admin edit:', err);
      alert('Error al guardar la firma.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDeleteRelease = () => {
    if (!id || !release) return;
    if (user.role !== UserRole.ADMIN) {
      alert('Error: Solo los administradores pueden eliminar esta solicitud.');
      return;
    }
    setShowDeleteConfirmModal(true);
  };

  const onConfirmDeleteRelease = async () => {
    if (!id || !release) return;
    if (user.role !== UserRole.ADMIN) return;

    isDeletingRef.current = true;
    setIsUpdatingStatus(true);
    try {
      // Cascade delete all linked actions/findings first
      if (release.linkedActions && release.linkedActions.length > 0) {
        for (const action of release.linkedActions) {
          if (action.findingId) {
            if (action.id) {
              try {
                await deleteDoc(doc(db, 'findings', action.findingId, 'correctiveActions', action.id));
              } catch (subErr) {
                console.warn(`[Delete cascade] Failed to delete corrective action subdoc ${action.id} of finding ${action.findingId}:`, subErr);
              }
            }
            try {
              await deleteDoc(doc(db, 'findings', action.findingId));
            } catch (findErr) {
              console.warn(`[Delete cascade] Failed to delete parent finding ${action.findingId}:`, findErr);
            }
          }
        }
      }

      await deleteDoc(doc(db, 'special_releases', id));
      
      // Trigger Google Sheets Auto-Sync to keep sheets in perfect sync
      triggerAutoSync();

      setShowDeleteConfirmModal(false);
      alert('La solicitud y sus hallazgos/acciones vinculadas han sido eliminados correctamente.');
      navigate('/');
    } catch (err) {
      console.error('Error deleting special release:', err);
      alert('Error al intentar eliminar la solicitud.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleConfirmPosventaNotification = async () => {
    if (!id || !release || isUpdatingStatus) return;

    if (release.notifications.posventa.userId !== user.id && user.role !== UserRole.ADMIN) {
      alert('Usted no es la persona designada en Posventa ni Administrador.');
      return;
    }

    setIsUpdatingStatus(true);

    try {
      const releaseRef = doc(db, 'special_releases', id);

      const updatedNotifications = {
        posventa: {
          ...release.notifications.posventa,
          confirmed: true,
          confirmedDate: new Date().toISOString()
        }
      };

      // Check if all approvals has evaluated to calculate final status
      const allEvaluated = 
        (release.approvals.calidad.excluded || release.approvals.calidad.status !== 'pending') &&
        (release.approvals.ingenieria.excluded || release.approvals.ingenieria.status !== 'pending') &&
        (release.approvals.comercial.excluded || release.approvals.comercial.status !== 'pending') &&
        (release.approvals.operaciones.excluded || release.approvals.operaciones.status !== 'pending');

      const hasAnyRejection = 
        (!release.approvals.calidad.excluded && release.approvals.calidad.status === 'rejected') ||
        (!release.approvals.ingenieria.excluded && release.approvals.ingenieria.status === 'rejected') ||
        (!release.approvals.comercial.excluded && release.approvals.comercial.status === 'rejected') ||
        (!release.approvals.operaciones.excluded && release.approvals.operaciones.status === 'rejected');

      let finalStatus = 'pending_approval';
      let shouldSendResolutionEmail = false;

      if (hasAnyRejection) {
        finalStatus = 'rejected';
        if (release.status !== 'rejected') {
          shouldSendResolutionEmail = true;
        }
      } else if (allEvaluated) {
        finalStatus = 'approved';
        if (release.status !== 'approved') {
          shouldSendResolutionEmail = true;
        }
      }

      await updateDoc(releaseRef, {
        notifications: updatedNotifications,
        status: finalStatus,
        updatedAt: serverTimestamp()
      });

      alert('Recepción confirmada con éxito.');

      if (shouldSendResolutionEmail) {
        const resolutionLabel = finalStatus === 'approved' ? 'APROBADA' : 'RECHAZADA';
        const recipients = [
          release.creatorEmail,
          release.approvals.calidad.userEmail,
          release.approvals.ingenieria.userEmail,
          release.approvals.comercial.userEmail,
          release.approvals.operaciones.userEmail,
          release.notifications.posventa.userEmail
        ].filter((e, idx, self) => !!e && self.indexOf(e) === idx);

        for (const rcpt of recipients) {
          await sendNotification({
            to: rcpt,
            subject: `RESOLUCIÓN FINAL: Solicitud de Liberación Especial LE-#${release.releaseNumber} [${resolutionLabel}]`,
            body: `Hola, le informamos que la solicitud de Liberación Especial LE-#${release.releaseNumber} ha completado su circuito de firmas autorizadas. El dictamen final es: ${resolutionLabel}. Puede consultar los detalles y comentarios ingresando al sistema: ${window.location.href}`,
            type: 'verification'
          });
        }
      }

    } catch (err) {
      console.error('Error confirming posventa notification:', err);
      alert('Error al confirmar recepción.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const generatePDFReport = () => {
    if (!release) return;

    const doc = new jsPDF();
    
    // Header styling
    doc.setFillColor(30, 41, 59); // dark navy
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text('SGC CRUCIANELLI', 15, 18);
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Solicitud de Liberacion Especial: LE-#${release.releaseNumber}`, 15, 27);
    doc.text(`Resolucion: ${release.status.toUpperCase()}`, 130, 27);

    let y = 50;

    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > 275) {
        doc.addPage();
        y = 20;
      }
    };

    // Main section
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('1. Informacion General', 15, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    
    doc.text(`Empresa: ${release.company}`, 15, y);
    doc.text(`Fecha Solicitud: ${format(toDateSafe(release.date), 'dd/MM/yyyy')}`, 110, y);
    y += 6;
    doc.text(`Creador: ${release.creatorName} (${release.creatorEmail})`, 15, y);
    doc.text(`Tipo Desvio: ${release.type === 'raw_material' ? 'Materia Prima y Materiales' : 'Producto Terminado'}`, 110, y);
    y += 10;

    // Specific details box
    checkPageBreak(30);
    doc.setFillColor(248, 250, 252);
    doc.rect(15, y, 180, 24, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    
    if (release.type === 'raw_material') {
      doc.text(`Orden de Compra (OC): ${release.purchaseOrderNumber || '-'}`, 18, y + 6);
      doc.text(`Material / Codigo: ${release.code || '-'} - ${release.description || '-'}`, 18, y + 12);
      doc.text(`Proveedor: ${release.vendor || '-'}`, 18, y + 18);
    } else {
      doc.text(`Orden de Fabricacion (OF): ${release.ofNumber || '-'}`, 18, y + 6);
      doc.text(`Producto / Modelo: ${release.machineModel || '-'}`, 18, y + 12);
      doc.text(`Cliente / Concesionario: ${release.clientDealer || '-'}`, 18, y + 18);
    }
    y += 32;

    // Deviation details
    checkPageBreak(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('2. Descripcion del Desvio', 15, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const splitDeviation = doc.splitTextToSize(release.deviationDescription, 180);
    doc.text(splitDeviation, 15, y);
    y += splitDeviation.length * 5 + 6;

    // Client Impact
    checkPageBreak(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('3. Impacto en el Cliente / Riesgos', 15, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const splitImpact = doc.splitTextToSize(release.clientImpact, 180);
    doc.text(splitImpact, 15, y);
    y += splitImpact.length * 5 + 10;

    // Approvals table
    checkPageBreak(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('4. Evaluaciones y Firmas Autorizadas', 15, y);
    y += 8;

    const printSignature = (role: string, appr: any) => {
      checkPageBreak(28);
      doc.setFillColor(248, 250, 252);
      doc.rect(15, y, 180, 22, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(`${role}: ${appr.userName || 'No asignado'}`, 18, y + 6);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      const displayStatus = appr.excluded ? 'NO APLICA / EXCLUIDO' : appr.status.toUpperCase();
      doc.text(`Estado: ${displayStatus}`, 110, y + 6);
      
      const comm = appr.comments ? `Comentarios: ${appr.comments}` : 'Sin comentarios.';
      const splitComm = doc.splitTextToSize(comm, 170);
      doc.text(splitComm, 18, y + 12);
      
      if (appr.actionDate) {
        doc.text(`Fecha Firma: ${format(toDateSafe(appr.actionDate), 'dd/MM/yyyy HH:mm')}`, 110, y + 18);
      }
      y += 26;
    };

    printSignature('CALIDAD', release.approvals.calidad);
    printSignature('INGENIERIA', release.approvals.ingenieria);
    printSignature('COMERCIAL', release.approvals.comercial);
    printSignature('OPERACIONES', release.approvals.operaciones);

    // Posventa notification
    checkPageBreak(22);
    doc.setFillColor(248, 250, 252);
    doc.rect(15, y, 180, 16, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(`NOTIFICACIÓN POSVENTA: ${release.notifications.posventa.userName || 'No asignado'}`, 18, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Confirmado: ${release.notifications.posventa.confirmed ? 'SI' : 'NO'}`, 110, y + 6);
    if (release.notifications.posventa.confirmedDate) {
      doc.text(`Fecha Recepcion: ${format(toDateSafe(release.notifications.posventa.confirmedDate), 'dd/MM/yyyy HH:mm')}`, 18, y + 12);
    }
    y += 24;

    // Save
    doc.save(`Reporte_Liberacion_Especial_LE-${release.releaseNumber}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4 text-slate-400">
        <Clock className="animate-spin" size={32} />
        <span className="text-sm font-semibold">Cargando detalles de liberación...</span>
      </div>
    );
  }

  if (!release) return null;

  const qualityUserLoggedIn = release.approvals.calidad.userId === user.id;
  const engineeringUserLoggedIn = release.approvals.ingenieria.userId === user.id;
  const commercialUserLoggedIn = release.approvals.comercial.userId === user.id;
  const operationsUserLoggedIn = release.approvals.operaciones.userId === user.id;
  const posventaUserLoggedIn = release.notifications.posventa.userId === user.id || user.role === UserRole.ADMIN;

  const isAdmin = user.role === UserRole.ADMIN;

  // Collect all pending approval areas where the user is either the assigned user or an admin
  const userPendingAreas: ('calidad' | 'ingenieria' | 'comercial' | 'operaciones')[] = [];
  if (!release.approvals.calidad.excluded && (qualityUserLoggedIn || isAdmin) && release.approvals.calidad.status === 'pending') userPendingAreas.push('calidad');
  if (!release.approvals.ingenieria.excluded && (engineeringUserLoggedIn || isAdmin) && release.approvals.ingenieria.status === 'pending') userPendingAreas.push('ingenieria');
  if (!release.approvals.comercial.excluded && (commercialUserLoggedIn || isAdmin) && release.approvals.comercial.status === 'pending') userPendingAreas.push('comercial');
  if (!release.approvals.operaciones.excluded && (operationsUserLoggedIn || isAdmin) && release.approvals.operaciones.status === 'pending') userPendingAreas.push('operaciones');

  const showApprovalWidget = release.status === 'pending_approval' && userPendingAreas.length > 0;
  const showPosventaWidget = release.status === 'pending_approval' && posventaUserLoggedIn && !release.notifications.posventa.confirmed;
  const canEditApprovers = release.status === 'draft' && (release.creatorId === user.id || user.role === UserRole.ADMIN);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 uppercase">
            <Clock size={12} /> Solicitud Creada
          </span>
        );
      case 'pending_approval':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 uppercase">
            <Clock size={12} className="animate-spin text-amber-500" /> En Revisión
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
            <CheckCircle size={12} /> Liberación Especial Aceptada
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 uppercase">
            <XCircle size={12} /> Liberación Especial Rechazada
          </span>
        );
      default:
        return null;
    }
  };

  const getSignStatusIcon = (status: 'pending' | 'approved' | 'rejected', excluded?: boolean) => {
    if (excluded) {
      return <MinusCircle className="text-slate-300 shrink-0" size={20} />;
    }
    switch (status) {
      case 'approved':
        return <CheckCircle className="text-emerald-500 shrink-0" size={20} />;
      case 'rejected':
        return <XCircle className="text-rose-500 shrink-0" size={20} />;
      case 'pending':
      default:
        return <Clock className="text-amber-500 shrink-0 animate-pulse" size={20} />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8" id="special-release-details-view">
      {/* Upper bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors bg-white hover:bg-slate-100 border border-slate-200 px-4 py-2 rounded-xl cursor-pointer"
        >
          <ArrowLeft size={16} /> Volver al Dashboard
        </button>

        <div className="flex items-center gap-2">
          {user.role === UserRole.ADMIN && (
            <button
              onClick={handleDeleteRelease}
              disabled={isUpdatingStatus}
              className="flex items-center gap-2 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-bold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Trash2 size={14} /> Eliminar Solicitud
            </button>
          )}

          <button
            onClick={generatePDFReport}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
          >
            <Download size={14} /> Exportar PDF
          </button>
          
          {release.status === 'draft' && (release.creatorId === user.id || user.role === UserRole.ADMIN) && (
            <button
              onClick={handleSendForApproval}
              disabled={isUpdatingStatus}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-xl text-xs transition-all shadow-lg shadow-blue-200 cursor-pointer disabled:opacity-50"
            >
              {isUpdatingStatus ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Send size={14} />
              )}
              Enviar a Revisión
            </button>
          )}
        </div>
      </div>

      {/* Main card */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        {/* Release info summary side */}
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className="font-black text-slate-900 text-2xl">LE-#{release.releaseNumber}</span>
              <span className="px-3 py-1 bg-slate-100 text-slate-700 border border-slate-200 text-xs font-black rounded-lg uppercase tracking-wider">
                {release.company}
              </span>
              {getStatusBadge(release.status)}
            </div>
            
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-slate-400">
              <span className="flex items-center gap-1.5">
                <User size={14} /> Solicitado por: {release.creatorName}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Calendar size={14} /> {format(toDateSafe(release.date), 'dd/MM/yyyy')}
              </span>
            </div>
          </div>

          <div className="border-t border-slate-100 my-4"></div>

          {/* Specific Attributes according to release type */}
          <div className="space-y-2">
            <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">Detalles del Material / Producto</span>
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-medium">
              {release.type === 'raw_material' ? (
                <>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Orden de Compra:</span>
                    <span className="text-slate-800">{release.purchaseOrderNumber || 'No especificada'}</span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Código:</span>
                    <span className="text-slate-800">{release.code || 'No especificado'}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Descripción de Material:</span>
                    <span className="text-slate-800">{release.description || 'Sin descripción'}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Proveedor:</span>
                    <span className="text-slate-800">{release.vendor || 'No especificado'}</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Orden de Fabricación (OF):</span>
                    <span className="text-slate-800">{release.ofNumber || 'No especificada'}</span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Máquina / Modelo:</span>
                    <span className="text-slate-800">{release.machineModel || 'No especificado'}</span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Cliente / Concesionario:</span>
                    <span className="text-slate-800">{release.clientDealer || 'No especificado'}</span>
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-400 block mb-0.5">Nota de Venta:</span>
                    <span className="text-slate-800">{release.salesNoteNumber || 'No especificada'}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Deviation text */}
          <div className="space-y-2">
            <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">Descripción de la Desviación</span>
            <p className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm leading-relaxed text-slate-700 italic">
              "{release.deviationDescription}"
            </p>
          </div>

          {/* Client Impact / Risks */}
          <div className="space-y-2">
            <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">Impacto en Cliente / Análisis de Riesgos</span>
            <p className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm leading-relaxed text-slate-700">
              {release.clientImpact}
            </p>
          </div>

          {/* Acciones Correctivas Definidas */}
          <div className="space-y-3" id="linked-corrective-actions-section">
            <span className="text-[10px] font-black tracking-wider text-slate-400 uppercase">Acciones Correctivas Definidas (Trazabilidad)</span>
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
              {/* List of linked actions */}
              {(!release.linkedActions || release.linkedActions.length === 0) ? (
                <p className="text-slate-400 text-xs italic py-2">
                  No se han definido acciones correctivas para esta liberación especial aún.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {release.linkedActions.map((act, index) => (
                    <div key={act.id || index} className="p-3.5 bg-white border border-slate-150 rounded-xl space-y-1.5 shadow-sm">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-md">
                          Acción #{index + 1}
                        </span>
                        <div className="flex items-center gap-1.5 text-emerald-800 text-[9px] font-bold">
                          <CheckCircle size={10} className="text-emerald-600" />
                          <span>Hallazgo #{act.findingNumber}</span>
                        </div>
                        <a 
                          href={`/findings/${act.findingId}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 font-bold text-[9px] underline ml-auto"
                        >
                          Ver en Correctivas &rarr;
                        </a>
                      </div>
                      <p className="text-slate-800 text-xs font-semibold leading-relaxed">{act.description}</p>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 font-bold">
                        <span className="flex items-center gap-1"><User size={11} /> Resp: {act.responsibleName}</span>
                        <span className="flex items-center gap-1"><Calendar size={11} /> Límite: {format(toDateSafe(act.deadline), 'dd/MM/yyyy')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Form to add actions (Only available in 'draft' status by owner or admin) */}
              {release.status === 'draft' && (release.creatorId === user.id || user.role === UserRole.ADMIN) && (
                <form onSubmit={handleAddLinkedAction} className="border-t border-slate-200/60 pt-4 space-y-3">
                  <h4 className="font-bold text-xs text-slate-500 uppercase tracking-wider">
                    Definir Nueva Acción Correctiva
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Descripción de la Acción *</label>
                      <textarea
                        required
                        value={actionForm.description}
                        onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
                        rows={2}
                        placeholder="Escriba la acción de corrección o bloqueo que se ejecutará..."
                        className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Responsable *</label>
                        <UserSelect
                          users={usersList}
                          value={actionForm.responsibleId}
                          onChange={(userId) => setActionForm({ ...actionForm, responsibleId: userId })}
                          placeholder="Seleccione responsable..."
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-400 mb-1 uppercase tracking-wider">Fecha Límite *</label>
                        <input
                          type="date"
                          required
                          value={actionForm.deadline}
                          onChange={(e) => setActionForm({ ...actionForm, deadline: e.target.value })}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:outline-none text-slate-700"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={isSubmittingAction}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                      >
                        {isSubmittingAction ? (
                          <Loader2 className="animate-spin" size={14} />
                        ) : (
                          <PlusCircle size={14} />
                        )}
                        Crear y Vincular Acción
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* Action / Bottom layout: Firmantes and notified areas */}
        <div className="p-8 bg-slate-50/50 border-t border-slate-200 space-y-6">
          <h3 className="font-extrabold text-slate-800 text-sm tracking-wide uppercase">
            Matriz de Firmas Autorizadas
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Calidad */}
            <div className={`bg-white border border-slate-200/60 p-4 rounded-xl flex gap-3.5 items-start shadow-sm ${release.approvals.calidad.excluded ? 'opacity-70 bg-slate-50/50' : ''}`}>
              {getSignStatusIcon(release.approvals.calidad.status, release.approvals.calidad.excluded)}
              <div className="text-xs font-medium space-y-1 flex-grow">
                <div className="flex items-center justify-between w-full">
                  <span className="font-extrabold text-slate-400 text-[10px] tracking-wider block uppercase">CALIDAD</span>
                  <div className="flex items-center gap-2">
                    {canEditApprovers && (
                      <button
                        onClick={() => handleToggleExcludeApprover('calidad')}
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md transition-colors cursor-pointer border ${
                          release.approvals.calidad.excluded
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        {release.approvals.calidad.excluded ? 'Incluir Firma' : 'No Aplica / Excluir'}
                      </button>
                    )}
                    {user.role === UserRole.ADMIN && !release.approvals.calidad.excluded && !canEditApprovers && adminEditingArea !== 'calidad' && (
                      <button
                        onClick={() => {
                          setAdminEditingArea('calidad');
                          setAdminEditForm({
                            status: release.approvals.calidad.status,
                            comments: release.approvals.calidad.comments || ''
                          });
                        }}
                        className="text-[9px] text-amber-700 hover:text-amber-950 font-bold uppercase tracking-wider bg-amber-100/70 hover:bg-amber-100 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                      >
                        Editar Decisión
                      </button>
                    )}
                  </div>
                </div>
                {release.approvals.calidad.excluded ? (
                  <div className="text-slate-400 font-bold italic text-xs py-1">
                    Esta área no aplica para esta liberación.
                  </div>
                ) : canEditApprovers ? (
                  <UserSelect
                    users={usersList}
                    value={release.approvals.calidad.userId || ''}
                    onChange={(userId) => handleUpdateApprover('calidad', userId)}
                    placeholder="Asignar aprobador Calidad..."
                  />
                ) : adminEditingArea === 'calidad' ? (
                  <div className="space-y-3 mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'pending' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'pending'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Pendiente
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'approved' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'approved'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Aprobado
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'rejected' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'rejected'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Rechazado
                      </button>
                    </div>
                    
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Comentarios</label>
                      <textarea
                        value={adminEditForm.comments}
                        onChange={(e) => setAdminEditForm(prev => ({ ...prev, comments: e.target.value }))}
                        placeholder="Comentarios de la firma..."
                        rows={1}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {adminEditForm.status === 'rejected' && !adminEditForm.comments.trim() && (
                        <p className="text-[9px] text-rose-600 font-bold mt-1">* Los comentarios son obligatorios para rechazar.</p>
                      )}
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setAdminEditingArea(null)}
                        className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-[10px] font-bold rounded-md cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminEditApproval('calidad', adminEditForm.status, adminEditForm.comments)}
                        disabled={isUpdatingStatus}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        {isUpdatingStatus && <Loader2 className="animate-spin" size={10} />}
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="text-slate-800 block font-bold">{release.approvals.calidad.userName || 'No asignado'}</span>
                    {release.approvals.calidad.comments && (
                      <p className="text-slate-500 leading-normal italic">"{release.approvals.calidad.comments}"</p>
                    )}
                    {release.approvals.calidad.actionDate && (
                      <span className="text-[10px] text-slate-400 block">{format(toDateSafe(release.approvals.calidad.actionDate), 'dd/MM/yy HH:mm')}</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Ingeniería */}
            <div className={`bg-white border border-slate-200/60 p-4 rounded-xl flex gap-3.5 items-start shadow-sm ${release.approvals.ingenieria.excluded ? 'opacity-70 bg-slate-50/50' : ''}`}>
              {getSignStatusIcon(release.approvals.ingenieria.status, release.approvals.ingenieria.excluded)}
              <div className="text-xs font-medium space-y-1 flex-grow">
                <div className="flex items-center justify-between w-full">
                  <span className="font-extrabold text-slate-400 text-[10px] tracking-wider block uppercase">INGENIERÍA</span>
                  <div className="flex items-center gap-2">
                    {canEditApprovers && (
                      <button
                        onClick={() => handleToggleExcludeApprover('ingenieria')}
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md transition-colors cursor-pointer border ${
                          release.approvals.ingenieria.excluded
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        {release.approvals.ingenieria.excluded ? 'Incluir Firma' : 'No Aplica / Excluir'}
                      </button>
                    )}
                    {user.role === UserRole.ADMIN && !release.approvals.ingenieria.excluded && !canEditApprovers && adminEditingArea !== 'ingenieria' && (
                      <button
                        onClick={() => {
                          setAdminEditingArea('ingenieria');
                          setAdminEditForm({
                            status: release.approvals.ingenieria.status,
                            comments: release.approvals.ingenieria.comments || ''
                          });
                        }}
                        className="text-[9px] text-amber-700 hover:text-amber-950 font-bold uppercase tracking-wider bg-amber-100/70 hover:bg-amber-100 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                      >
                        Editar Decisión
                      </button>
                    )}
                  </div>
                </div>
                {release.approvals.ingenieria.excluded ? (
                  <div className="text-slate-400 font-bold italic text-xs py-1">
                    Esta área no aplica para esta liberación.
                  </div>
                ) : canEditApprovers ? (
                  <UserSelect
                    users={usersList}
                    value={release.approvals.ingenieria.userId || ''}
                    onChange={(userId) => handleUpdateApprover('ingenieria', userId)}
                    placeholder="Asignar aprobador Ingeniería..."
                  />
                ) : adminEditingArea === 'ingenieria' ? (
                  <div className="space-y-3 mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'pending' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'pending'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Pendiente
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'approved' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'approved'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Aprobado
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'rejected' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'rejected'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Rechazado
                      </button>
                    </div>
                    
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Comentarios</label>
                      <textarea
                        value={adminEditForm.comments}
                        onChange={(e) => setAdminEditForm(prev => ({ ...prev, comments: e.target.value }))}
                        placeholder="Comentarios de la firma..."
                        rows={1}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {adminEditForm.status === 'rejected' && !adminEditForm.comments.trim() && (
                        <p className="text-[9px] text-rose-600 font-bold mt-1">* Los comentarios son obligatorios para rechazar.</p>
                      )}
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setAdminEditingArea(null)}
                        className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-[10px] font-bold rounded-md cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminEditApproval('ingenieria', adminEditForm.status, adminEditForm.comments)}
                        disabled={isUpdatingStatus}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        {isUpdatingStatus && <Loader2 className="animate-spin" size={10} />}
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="text-slate-800 block font-bold">{release.approvals.ingenieria.userName || 'No asignado'}</span>
                    {release.approvals.ingenieria.comments && (
                      <p className="text-slate-500 leading-normal italic">"{release.approvals.ingenieria.comments}"</p>
                    )}
                    {release.approvals.ingenieria.actionDate && (
                      <span className="text-[10px] text-slate-400 block">{format(toDateSafe(release.approvals.ingenieria.actionDate), 'dd/MM/yy HH:mm')}</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Comercial */}
            <div className="bg-white border border-slate-200/60 p-4 rounded-xl flex gap-3.5 items-center shadow-sm">
              {getSignStatusIcon(release.approvals.comercial.status)}
              <div className="text-xs font-medium space-y-1 flex-grow">
                <div className="flex items-center justify-between w-full">
                  <span className="font-extrabold text-slate-400 text-[10px] tracking-wider block uppercase">COMERCIAL</span>
                  {user.role === UserRole.ADMIN && !canEditApprovers && adminEditingArea !== 'comercial' && (
                    <button
                      onClick={() => {
                        setAdminEditingArea('comercial');
                        setAdminEditForm({
                          status: release.approvals.comercial.status,
                          comments: release.approvals.comercial.comments || ''
                        });
                      }}
                      className="text-[9px] text-amber-700 hover:text-amber-950 font-bold uppercase tracking-wider bg-amber-100/70 hover:bg-amber-100 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                    >
                      Editar Decisión
                    </button>
                  )}
                </div>
                {canEditApprovers ? (
                  <UserSelect
                    users={usersList}
                    value={release.approvals.comercial.userId || ''}
                    onChange={(userId) => handleUpdateApprover('comercial', userId)}
                    placeholder="Asignar aprobador Comercial..."
                  />
                ) : adminEditingArea === 'comercial' ? (
                  <div className="space-y-3 mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'pending' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'pending'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Pendiente
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'approved' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'approved'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Aprobado
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'rejected' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'rejected'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Rechazado
                      </button>
                    </div>
                    
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Comentarios</label>
                      <textarea
                        value={adminEditForm.comments}
                        onChange={(e) => setAdminEditForm(prev => ({ ...prev, comments: e.target.value }))}
                        placeholder="Comentarios de la firma..."
                        rows={1}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {adminEditForm.status === 'rejected' && !adminEditForm.comments.trim() && (
                        <p className="text-[9px] text-rose-600 font-bold mt-1">* Los comentarios son obligatorios para rechazar.</p>
                      )}
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setAdminEditingArea(null)}
                        className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-[10px] font-bold rounded-md cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminEditApproval('comercial', adminEditForm.status, adminEditForm.comments)}
                        disabled={isUpdatingStatus}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        {isUpdatingStatus && <Loader2 className="animate-spin" size={10} />}
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="text-slate-800 block font-bold">{release.approvals.comercial.userName || 'No asignado'}</span>
                    {release.approvals.comercial.comments && (
                      <p className="text-slate-500 leading-normal italic">"{release.approvals.comercial.comments}"</p>
                    )}
                    {release.approvals.comercial.actionDate && (
                      <span className="text-[10px] text-slate-400 block">{format(toDateSafe(release.approvals.comercial.actionDate), 'dd/MM/yy HH:mm')}</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Operaciones */}
            <div className={`bg-white border border-slate-200/60 p-4 rounded-xl flex gap-3.5 items-center shadow-sm ${release.approvals.operaciones.excluded ? 'opacity-70 bg-slate-50/50' : ''}`}>
              {getSignStatusIcon(release.approvals.operaciones.status, release.approvals.operaciones.excluded)}
              <div className="text-xs font-medium space-y-1 flex-grow">
                <div className="flex items-center justify-between w-full">
                  <span className="font-extrabold text-slate-400 text-[10px] tracking-wider block uppercase">OPERACIONES</span>
                  <div className="flex items-center gap-2">
                    {canEditApprovers && (
                      <button
                        onClick={() => handleToggleExcludeApprover('operaciones')}
                        className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md transition-colors cursor-pointer border ${
                          release.approvals.operaciones.excluded
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        {release.approvals.operaciones.excluded ? 'Incluir Firma' : 'No Aplica / Excluir'}
                      </button>
                    )}
                    {user.role === UserRole.ADMIN && !release.approvals.operaciones.excluded && !canEditApprovers && adminEditingArea !== 'operaciones' && (
                      <button
                        onClick={() => {
                          setAdminEditingArea('operaciones');
                          setAdminEditForm({
                            status: release.approvals.operaciones.status,
                            comments: release.approvals.operaciones.comments || ''
                          });
                        }}
                        className="text-[9px] text-amber-700 hover:text-amber-950 font-bold uppercase tracking-wider bg-amber-100/70 hover:bg-amber-100 px-2 py-0.5 rounded-md cursor-pointer transition-colors"
                      >
                        Editar Decisión
                      </button>
                    )}
                  </div>
                </div>
                {release.approvals.operaciones.excluded ? (
                  <div className="text-slate-400 font-bold italic text-xs py-1">
                    Esta área no aplica para esta liberación.
                  </div>
                ) : canEditApprovers ? (
                  <UserSelect
                    users={usersList}
                    value={release.approvals.operaciones.userId || ''}
                    onChange={(userId) => handleUpdateApprover('operaciones', userId)}
                    placeholder="Asignar aprobador Operaciones..."
                  />
                ) : adminEditingArea === 'operaciones' ? (
                  <div className="space-y-3 mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'pending' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'pending'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Pendiente
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'approved' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'approved'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Aprobado
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminEditForm(prev => ({ ...prev, status: 'rejected' }))}
                        className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold uppercase border text-center transition-all cursor-pointer ${
                          adminEditForm.status === 'rejected'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Rechazado
                      </button>
                    </div>
                    
                    <div>
                      <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Comentarios</label>
                      <textarea
                        value={adminEditForm.comments}
                        onChange={(e) => setAdminEditForm(prev => ({ ...prev, comments: e.target.value }))}
                        placeholder="Comentarios de la firma..."
                        rows={1}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                      {adminEditForm.status === 'rejected' && !adminEditForm.comments.trim() && (
                        <p className="text-[9px] text-rose-600 font-bold mt-1">* Los comentarios son obligatorios para rechazar.</p>
                      )}
                    </div>

                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setAdminEditingArea(null)}
                        className="px-2 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-[10px] font-bold rounded-md cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAdminEditApproval('operaciones', adminEditForm.status, adminEditForm.comments)}
                        disabled={isUpdatingStatus}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-md flex items-center gap-1 cursor-pointer"
                      >
                        {isUpdatingStatus && <Loader2 className="animate-spin" size={10} />}
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="text-slate-800 block font-bold">{release.approvals.operaciones.userName || 'No asignado'}</span>
                    {release.approvals.operaciones.comments && (
                      <p className="text-slate-500 leading-normal italic">"{release.approvals.operaciones.comments}"</p>
                    )}
                    {release.approvals.operaciones.actionDate && (
                      <span className="text-[10px] text-slate-400 block">{format(toDateSafe(release.approvals.operaciones.actionDate), 'dd/MM/yy HH:mm')}</span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Notified Posventa */}
            <div className="bg-white border border-slate-200/60 p-4 rounded-xl flex gap-3.5 items-start shadow-sm md:col-span-2">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 ${release.notifications.posventa.confirmed ? 'bg-blue-500' : 'bg-slate-300'}`}>
                {release.notifications.posventa.confirmed ? <CheckCircle size={14} /> : <Clock size={14} />}
              </span>
              <div className="text-xs font-medium space-y-1 flex-grow">
                <span className="font-extrabold text-slate-400 text-[10px] tracking-wider block uppercase">NOTIFICACIÓN POSVENTA</span>
                {canEditApprovers || user.role === UserRole.ADMIN ? (
                  <UserSelect
                    users={usersList}
                    value={release.notifications.posventa.userId || ''}
                    onChange={(userId) => handleUpdateApprover('posventa', userId)}
                    placeholder="Asignar persona de Posventa..."
                    dropdownPosition="top"
                  />
                ) : (
                  <>
                    <span className="text-slate-800 block font-bold">{release.notifications.posventa.userName || 'No asignado'}</span>
                    <span className="text-[10px] block font-semibold text-slate-400">
                      {release.notifications.posventa.confirmed ? 'Recepción confirmada' : 'Aún sin confirmar recepción'}
                    </span>
                    {release.notifications.posventa.confirmedDate && (
                      <span className="text-[10px] text-slate-400 block">{format(toDateSafe(release.notifications.posventa.confirmedDate), 'dd/MM/yy HH:mm')}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Draft Send for Review action banner at the bottom */}
      {release.status === 'draft' && (release.creatorId === user.id || user.role === UserRole.ADMIN) && (
        <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="space-y-1 text-left">
            <h4 className="font-extrabold text-blue-900 text-sm flex items-center gap-2">
              <Send size={16} className="text-blue-600" /> Solicitud Lista para Enviar a Revisión
            </h4>
            <p className="text-slate-600 text-xs leading-relaxed font-medium">
              Una vez verificados los detalles del desvío, haga clic en el botón para enviar la solicitud a los evaluadores designados.
            </p>
          </div>
          <button
            onClick={handleSendForApproval}
            disabled={isUpdatingStatus}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl text-xs transition-all shadow-lg shadow-blue-200 cursor-pointer disabled:opacity-50 shrink-0"
          >
            {isUpdatingStatus ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Send size={16} />
            )}
            Enviar a Revisión
          </button>
        </div>
      )}

      {/* Approver Action widgets if authorized and pending */}
      {showApprovalWidget && (
        <div className="space-y-4">
          {userPendingAreas.map((area) => {
            const currentForm = evaluationForms[area] || { status: 'approved', comments: '' };
            const assignedName = release.approvals[area]?.userName || 'No asignado';
            
            return (
              <div key={area} className="bg-amber-50/50 border border-amber-200 rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300" id={`approver-evaluation-widget-${area}`}>
                <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                  <ShieldCheck size={20} />
                  Firma Electrónica Requerida: Evaluar {area.toUpperCase()}
                </div>
                <p className="text-slate-600 text-xs leading-relaxed font-semibold">
                  Como representante asignado en esta solicitud, debe indicar su aprobación o rechazo técnico del desvío planteado para el área de <span className="font-extrabold uppercase text-slate-800">{area}</span> (Asignado/a a: <span className="font-extrabold text-amber-900">{assignedName}</span>).
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                      Comentarios de Evaluación (Obligatorio para rechazar)
                    </label>
                    <textarea
                      value={currentForm.comments}
                      onChange={(e) => setEvaluationForms(prev => ({
                        ...prev,
                        [area]: { ...prev[area], comments: e.target.value }
                      }))}
                      rows={2}
                      placeholder="Escriba aquí sus comentarios adicionales o el motivo del rechazo técnico..."
                      className="w-full bg-white border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                    {!currentForm.comments.trim() && (
                      <p className="text-[10px] text-rose-600 font-bold mt-1.5 bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse shrink-0"></span>
                        Debe ingresar los comentarios de evaluación para poder rechazar técnicamente la solicitud.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <button
                      type="button"
                      disabled={isUpdatingStatus}
                      onClick={() => handleEvaluateApprover(area, 'approved', currentForm.comments)}
                      className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-100 transition-all cursor-pointer flex items-center gap-2"
                    >
                      {isUpdatingStatus && <Loader2 className="animate-spin" size={14} />}
                      Aprobar Solicitud
                    </button>
                    <button
                      type="button"
                      disabled={isUpdatingStatus}
                      onClick={() => {
                        if (!currentForm.comments.trim()) {
                          alert('Los comentarios de la evaluación son obligatorios cuando la solicitud es rechazada.');
                          return;
                        }
                        handleEvaluateApprover(area, 'rejected', currentForm.comments);
                      }}
                      className="py-2.5 px-5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg shadow-rose-100 transition-all cursor-pointer flex items-center gap-2"
                    >
                      {isUpdatingStatus && <Loader2 className="animate-spin" size={14} />}
                      Rechazar Solicitud
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Posventa confirmation widget */}
      {showPosventaWidget && (
        <div className="bg-blue-50/50 border border-blue-200 rounded-2xl p-6 shadow-sm space-y-3" id="posventa-notification-widget">
          <div className="flex items-center gap-2 text-blue-800 font-bold text-sm">
            <Mail size={18} />
            Confirmación de Recepción Requerida (Posventa)
          </div>
          <p className="text-slate-600 text-xs font-semibold">
            Confirme que ha recibido la notificación de esta solicitud especial de liberación para fines de trazabilidad.
          </p>
          <button
            onClick={handleConfirmPosventaNotification}
            disabled={isUpdatingStatus}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-5 rounded-lg text-xs transition-colors cursor-pointer"
          >
            {isUpdatingStatus ? <Loader2 className="animate-spin" size={14} /> : null}
            Confirmar Recepción / Recibido
          </button>
        </div>
      )}

      {/* Custom Confirmation Modal for Send to Review */}
      {showConfirmSendModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-md w-full p-6 space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <Send size={20} />
              </div>
              <div className="space-y-1">
                <h4 className="font-extrabold text-slate-900 text-base">¿Enviar a revisión?</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  Esta acción cambiará el estado de la solicitud a <span className="font-bold">"En Revisión"</span> y enviará notificaciones por correo electrónico a los 4 aprobadores designados y al personal de Posventa.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmSendModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirmSend}
                disabled={isUpdatingStatus}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-200 transition-all cursor-pointer flex items-center gap-2"
              >
                {isUpdatingStatus && <Loader2 className="animate-spin" size={14} />}
                Confirmar y Enviar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal for Deletion */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl max-w-md w-full p-6 space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="space-y-1.5">
                <h4 className="font-extrabold text-slate-900 text-base">¿Eliminar Liberación Especial?</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  ¿Está absolutamente seguro de que desea eliminar permanentemente la solicitud de Liberación Especial <span className="font-bold text-slate-700">LE-#{release?.releaseNumber}</span>?
                </p>
                <p className="text-rose-600 text-xs font-semibold leading-relaxed">
                  ⚠️ Esto también eliminará todos los hallazgos y acciones correctivas vinculadas de forma permanente. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmModal(false)}
                disabled={isUpdatingStatus}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onConfirmDeleteRelease}
                disabled={isUpdatingStatus}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-rose-200 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
              >
                {isUpdatingStatus && <Loader2 className="animate-spin" size={14} />}
                Eliminar Permanentemente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

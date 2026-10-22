import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, getDocs, where, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { SpecialRelease, UserProfile, UserRole, Finding, CorrectiveAction, ActionStatus, FindingStatus } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, PlusCircle, Filter, Search, ChevronRight, User, Calendar, 
  CheckCircle, XCircle, Clock, CheckCircle2, AlertCircle, ShoppingBag, Box, ShieldCheck, Mail,
  ListChecks, ExternalLink, ArrowUpRight
} from 'lucide-react';
import { format } from 'date-fns';

const COMPANIES = ['TMC', 'Fertec', 'Metallo', 'Leaf', 'Fabril'];

const toDateSafe = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
};

interface SpecialReleasePendingActionRow {
  actionId: string;
  findingId: string;
  findingNumber: number;
  releaseId: string;
  releaseNumber: number;
  company: string;
  type: 'raw_material' | 'finished_product';
  ofOrLot: string;
  machineOrProduct: string;
  actionDescription: string;
  deadline: Date;
  responsibleName: string;
  responsibleEmail: string;
  status: string;
  isOverdue: boolean;
  daysToDeadline: number;
}

export default function SpecialReleaseDashboard({ user }: { user: UserProfile }) {
  const [releases, setReleases] = useState<SpecialRelease[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Active Tab
  const [activeTab, setActiveTab] = useState<'releases' | 'status_ac'>('releases');

  // Filters for Main Releases List
  const [filterCompany, setFilterCompany] = useState('Todas');
  const [filterType, setFilterType] = useState('Todos');
  const [filterStatus, setFilterStatus] = useState('Todos');
  const [searchQuery, setSearchQuery] = useState('');

  // Filters for Status AC LE Tab
  const [acSearchQuery, setAcSearchQuery] = useState('');
  const [acFilterCompany, setAcFilterCompany] = useState('Todas');
  const [acFilterUrgency, setAcFilterUrgency] = useState('Todas');
  const [acFilterResponsible, setAcFilterResponsible] = useState('Todos');

  // Live actions & findings state for Status AC LE
  const [acActionsMap, setAcActionsMap] = useState<Record<string, CorrectiveAction>>({});
  const [findingsMap, setFindingsMap] = useState<Record<string, Finding>>({});
  const [acLoading, setAcLoading] = useState(false);

  const isAdmin = user.role === UserRole.ADMIN;
  const [showAllSystemPending, setShowAllSystemPending] = useState(isAdmin);

  // Helper to extract pending tasks (evaluaciones/firmas)
  const getPendingTasks = (items: SpecialRelease[], filterByMeOnly: boolean) => {
    const tasks: {
      id: string;
      release: SpecialRelease;
      taskType: 'evaluation' | 'posventa';
      area: 'calidad' | 'ingenieria' | 'comercial' | 'operaciones' | 'posventa';
      areaLabel: string;
      assignedToMe: boolean;
    }[] = [];

    items.forEach(r => {
      if (r.status !== 'pending_approval') return;

      const roles: ('calidad' | 'ingenieria' | 'comercial' | 'operaciones')[] = ['calidad', 'ingenieria', 'comercial', 'operaciones'];
      
      roles.forEach(role => {
        const approval = r.approvals?.[role];
        if (approval && !approval.excluded && approval.status === 'pending') {
          const isMe = approval.userId === user.id;
          if (!filterByMeOnly || isMe) {
            tasks.push({
              id: `${r.id}-${role}`,
              release: r,
              taskType: 'evaluation',
              area: role,
              areaLabel: role === 'calidad' ? 'Calidad' : role === 'ingenieria' ? 'Ingeniería' : role === 'comercial' ? 'Comercial' : 'Operaciones',
              assignedToMe: isMe
            });
          }
        }
      });

      const posventa = r.notifications?.posventa;
      if (posventa && !posventa.confirmed) {
        const isMe = posventa.userId === user.id;
        if (!filterByMeOnly || isMe) {
          tasks.push({
            id: `${r.id}-posventa`,
            release: r,
            taskType: 'posventa',
            area: 'posventa',
            areaLabel: 'Postventa',
            assignedToMe: isMe
          });
        }
      }
    });

    return tasks;
  };

  const pendingTasks = getPendingTasks(releases, !isAdmin || !showAllSystemPending);

  useEffect(() => {
    // Fetch users list
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
    setLoading(true);
    const q = query(collection(db, 'special_releases'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SpecialRelease));
      setReleases(list);
      setLoading(false);
    }, (error) => {
      console.error('Error in special releases listener:', error);
      handleFirestoreError(error, OperationType.LIST, 'special_releases');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch live findings & corrective actions for special releases to ensure status is up to date
  useEffect(() => {
    const fetchSpecialReleaseActions = async () => {
      try {
        setAcLoading(true);
        const findingsSnap = await getDocs(
          query(collection(db, 'findings'), where('isSpecialRelease', '==', true))
        );

        const fMap: Record<string, Finding> = {};
        const actionsMap: Record<string, CorrectiveAction> = {};

        const actionsPromises = findingsSnap.docs.map(async (docSnap) => {
          const finding = { id: docSnap.id, ...docSnap.data() } as Finding;
          fMap[finding.id] = finding;

          try {
            const actionsSnap = await getDocs(collection(db, 'findings', finding.id, 'correctiveActions'));
            actionsSnap.docs.forEach(actionSnap => {
              const act = { id: actionSnap.id, findingId: finding.id, ...actionSnap.data() } as CorrectiveAction;
              actionsMap[`${finding.id}_${act.id}`] = act;
              actionsMap[act.id] = act;
            });
          } catch (e) {
            console.error(`Error loading actions for finding ${finding.id}:`, e);
          }
        });

        await Promise.all(actionsPromises);
        setFindingsMap(fMap);
        setAcActionsMap(actionsMap);
      } catch (err) {
        console.error('Error fetching special release corrective actions:', err);
      } finally {
        setAcLoading(false);
      }
    };

    if (releases.length > 0) {
      fetchSpecialReleaseActions();
    }
  }, [releases]);

  // Compute Pending Corrective Actions list for Special Releases
  const acLePendingList = useMemo(() => {
    const list: SpecialReleasePendingActionRow[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processedKeySet = new Set<string>();

    releases.forEach(r => {
      if (!r.linkedActions || r.linkedActions.length === 0) return;

      r.linkedActions.forEach(linkedAct => {
        const key = `${r.id}_${linkedAct.findingId}_${linkedAct.id}`;
        processedKeySet.add(key);

        const liveAction = acActionsMap[`${linkedAct.findingId}_${linkedAct.id}`] || acActionsMap[linkedAct.id];
        const parentFinding = findingsMap[linkedAct.findingId];

        // Check if action or parent finding is completed, cancelled, rejected, or verified
        if (liveAction) {
          if (
            liveAction.status === ActionStatus.FINISHED ||
            liveAction.status === ActionStatus.CANCELLED ||
            liveAction.status === ActionStatus.REJECTED ||
            (liveAction.status as any) === 'completed' ||
            liveAction.isVerified === true
          ) {
            return; // Exclude completed / rejected / verified actions
          }
        }

        if (parentFinding) {
          if (
            parentFinding.status === FindingStatus.COMPLETED ||
            parentFinding.status === FindingStatus.REJECTED ||
            parentFinding.status === FindingStatus.CANCELLED
          ) {
            return; // Exclude actions from closed findings
          }
        }

        const deadlineDate = toDateSafe(liveAction?.deadline || linkedAct.deadline);
        const dead = new Date(deadlineDate);
        dead.setHours(0, 0, 0, 0);

        const diffTime = dead.getTime() - today.getTime();
        const daysToDeadline = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const isOverdue = daysToDeadline < 0;

        const respUser = usersList.find(u => u.id === (liveAction?.responsibleId || linkedAct.responsibleId));
        const responsibleName = respUser?.displayName || linkedAct.responsibleName || liveAction?.responsibleEmail || 'Sin asignar';
        const responsibleEmail = respUser?.email || liveAction?.responsibleEmail || '';

        const ofOrLot = r.type === 'finished_product' 
          ? (r.ofNumber || 'N/A') 
          : (r.purchaseOrderNumber || 'N/A');

        const machineOrProduct = r.type === 'finished_product' 
          ? (r.machineModel || 'N/A') 
          : (`${r.code ? r.code + ' - ' : ''}${r.description || 'N/A'}`);

        list.push({
          actionId: linkedAct.id,
          findingId: linkedAct.findingId,
          findingNumber: linkedAct.findingNumber,
          releaseId: r.id,
          releaseNumber: r.releaseNumber,
          company: r.company,
          type: r.type,
          ofOrLot,
          machineOrProduct,
          actionDescription: liveAction?.description || linkedAct.description,
          deadline: deadlineDate,
          responsibleName,
          responsibleEmail,
          status: liveAction?.status || 'pending',
          isOverdue,
          daysToDeadline
        });
      });
    });

    // Also check findingsMap for any actions from special releases not present in releases linkedActions
    (Object.values(findingsMap) as Finding[]).forEach(finding => {
      if (!finding.specialReleaseId) return;
      const matchingRelease = releases.find(r => r.id === finding.specialReleaseId);
      if (!matchingRelease) return;

      const actionsForFinding = (Object.values(acActionsMap) as CorrectiveAction[]).filter(a => a.findingId === finding.id);
      actionsForFinding.forEach(act => {
        const key = `${matchingRelease.id}_${finding.id}_${act.id}`;
        if (processedKeySet.has(key)) return;
        processedKeySet.add(key);

        if (
          act.status === ActionStatus.FINISHED ||
          act.status === ActionStatus.CANCELLED ||
          act.status === ActionStatus.REJECTED ||
          (act.status as any) === 'completed' ||
          act.isVerified === true ||
          finding.status === FindingStatus.COMPLETED ||
          finding.status === FindingStatus.REJECTED ||
          finding.status === FindingStatus.CANCELLED
        ) {
          return;
        }

        const deadlineDate = toDateSafe(act.deadline);
        const dead = new Date(deadlineDate);
        dead.setHours(0, 0, 0, 0);

        const diffTime = dead.getTime() - today.getTime();
        const daysToDeadline = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const isOverdue = daysToDeadline < 0;

        const respUser = usersList.find(u => u.id === act.responsibleId);
        const responsibleName = respUser?.displayName || act.responsibleEmail || 'Sin asignar';

        const ofOrLot = matchingRelease.type === 'finished_product' 
          ? (matchingRelease.ofNumber || 'N/A') 
          : (matchingRelease.purchaseOrderNumber || 'N/A');

        const machineOrProduct = matchingRelease.type === 'finished_product' 
          ? (matchingRelease.machineModel || 'N/A') 
          : (`${matchingRelease.code ? matchingRelease.code + ' - ' : ''}${matchingRelease.description || 'N/A'}`);

        list.push({
          actionId: act.id,
          findingId: finding.id,
          findingNumber: finding.findingNumber || 0,
          releaseId: matchingRelease.id,
          releaseNumber: matchingRelease.releaseNumber,
          company: matchingRelease.company,
          type: matchingRelease.type,
          ofOrLot,
          machineOrProduct,
          actionDescription: act.description,
          deadline: deadlineDate,
          responsibleName,
          responsibleEmail: respUser?.email || act.responsibleEmail || '',
          status: act.status || 'pending',
          isOverdue,
          daysToDeadline
        });
      });
    });

    // Sort by deadline ascending
    return list.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  }, [releases, acActionsMap, findingsMap, usersList]);

  // Filter logic for Status AC LE
  const filteredAcLePendingList = useMemo(() => {
    return acLePendingList.filter(item => {
      const matchesCompany = acFilterCompany === 'Todas' || item.company === acFilterCompany;

      let matchesUrgency = true;
      if (acFilterUrgency === 'Vencidas') matchesUrgency = item.isOverdue;
      else if (acFilterUrgency === 'Próximas') matchesUrgency = !item.isOverdue && item.daysToDeadline <= 3;
      else if (acFilterUrgency === 'En Término') matchesUrgency = !item.isOverdue && item.daysToDeadline > 3;

      let matchesResponsible = true;
      if (acFilterResponsible !== 'Todos') {
        matchesResponsible = item.responsibleName === acFilterResponsible || item.responsibleEmail === acFilterResponsible;
      }

      let matchesSearch = true;
      if (acSearchQuery.trim() !== '') {
        const q = acSearchQuery.toLowerCase().trim();

        // 1. Explicit LE number target (e.g. "le-#2", "le-2", "le2")
        const leMatch = q.match(/^(?:le\s*#?)\s*(\d+)$/i);
        if (leMatch) {
          const targetNum = parseInt(leMatch[1], 10);
          matchesSearch = item.releaseNumber === targetNum;
        }
        // 2. Explicit Finding number target (e.g. "hallazgo #67", "hallazgo 67", "h#67", "h67")
        else {
          const findingMatch = q.match(/^(?:hallazgo|h)\s*#?\s*(\d+)$/i);
          if (findingMatch) {
            const targetNum = parseInt(findingMatch[1], 10);
            matchesSearch = item.findingNumber === targetNum;
          }
          // 3. Standalone "#<number>" (e.g. "#2" or "#67")
          else if (/^#\d+$/.test(q)) {
            const targetNum = parseInt(q.replace('#', ''), 10);
            matchesSearch = item.releaseNumber === targetNum || item.findingNumber === targetNum;
          }
          // 4. Standalone number or general query
          else {
            const leStr = `le-#${item.releaseNumber}`;
            const findingStr = `hallazgo #${item.findingNumber}`;

            const isBoundaryMatch = (text: string) => {
              const idx = text.toLowerCase().indexOf(q);
              if (idx === -1) return false;
              const endIdx = idx + q.length;
              // Prevent partial digit matches like "le-#2" inside "le-#20"
              if (endIdx < text.length && /\d/.test(text[endIdx]) && /\d/.test(q[q.length - 1])) {
                return false;
              }
              return true;
            };

            const isLeMatch = isBoundaryMatch(leStr);
            const isFindingMatch = isBoundaryMatch(findingStr);

            const isFieldMatch = 
              item.ofOrLot.toLowerCase().includes(q) ||
              item.machineOrProduct.toLowerCase().includes(q) ||
              item.actionDescription.toLowerCase().includes(q) ||
              item.responsibleName.toLowerCase().includes(q) ||
              item.responsibleEmail.toLowerCase().includes(q);

            matchesSearch = isLeMatch || isFindingMatch || isFieldMatch;
          }
        }
      }

      return matchesCompany && matchesUrgency && matchesResponsible && matchesSearch;
    });
  }, [acLePendingList, acFilterCompany, acFilterUrgency, acFilterResponsible, acSearchQuery]);

  // List of unique responsibles for AC LE filter dropdown
  const uniqueAcResponsibles = useMemo(() => {
    const set = new Set<string>();
    acLePendingList.forEach(item => {
      if (item.responsibleName && item.responsibleName !== 'Sin asignar') {
        set.add(item.responsibleName);
      }
    });
    return Array.from(set).sort();
  }, [acLePendingList]);

  // Filter logic for Releases List
  const filteredReleases = releases.filter(r => {
    const matchesCompany = filterCompany === 'Todas' || r.company === filterCompany;
    const matchesType = filterType === 'Todos' || r.type === filterType;
    const matchesStatus = filterStatus === 'Todos' || r.status === filterStatus;

    let matchesSearch = true;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();

      // 1. Explicit LE number target
      const leMatch = q.match(/^(?:le\s*#?)\s*(\d+)$/i);
      if (leMatch) {
        const targetNum = parseInt(leMatch[1], 10);
        matchesSearch = r.releaseNumber === targetNum;
      }
      // 2. Standalone "#<number>"
      else if (/^#\d+$/.test(q)) {
        const targetNum = parseInt(q.replace('#', ''), 10);
        matchesSearch = r.releaseNumber === targetNum;
      }
      // 3. General search
      else {
        const numStr = `le-#${r.releaseNumber}`;
        const isBoundaryMatch = (text: string) => {
          const idx = text.toLowerCase().indexOf(q);
          if (idx === -1) return false;
          const endIdx = idx + q.length;
          if (endIdx < text.length && /\d/.test(text[endIdx]) && /\d/.test(q[q.length - 1])) {
            return false;
          }
          return true;
        };

        const isLeMatch = isBoundaryMatch(numStr);

        const isFieldMatch = 
          r.deviationDescription.toLowerCase().includes(q) ||
          r.clientImpact.toLowerCase().includes(q) ||
          r.creatorName.toLowerCase().includes(q) ||
          (r.purchaseOrderNumber?.toLowerCase().includes(q) ?? false) ||
          (r.code?.toLowerCase().includes(q) ?? false) ||
          (r.description?.toLowerCase().includes(q) ?? false) ||
          (r.vendor?.toLowerCase().includes(q) ?? false) ||
          (r.ofNumber?.toLowerCase().includes(q) ?? false) ||
          (r.machineModel?.toLowerCase().includes(q) ?? false) ||
          (r.clientDealer?.toLowerCase().includes(q) ?? false) ||
          (r.salesNoteNumber?.toLowerCase().includes(q) ?? false);

        matchesSearch = isLeMatch || isFieldMatch;
      }
    }

    return matchesCompany && matchesType && matchesStatus && matchesSearch;
  });

  // Calculate statistics for Releases
  const stats = {
    total: filteredReleases.length,
    draft: filteredReleases.filter(r => r.status === 'draft').length,
    pending: filteredReleases.filter(r => r.status === 'pending_approval').length,
    approved: filteredReleases.filter(r => r.status === 'approved').length,
    rejected: filteredReleases.filter(r => r.status === 'rejected').length,
  };

  // Stats for AC LE
  const acStats = {
    totalPending: acLePendingList.length,
    overdue: acLePendingList.filter(a => a.isOverdue).length,
    dueSoon: acLePendingList.filter(a => !a.isOverdue && a.daysToDeadline <= 3).length,
    onTrack: acLePendingList.filter(a => !a.isOverdue && a.daysToDeadline > 3).length,
  };

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

  const getApprovalIndicator = (status: 'pending' | 'approved' | 'rejected', excluded?: boolean) => {
    if (excluded) {
      return <span className="w-2.5 h-2.5 rounded-full bg-slate-300" title="No Aplica / Excluido" />;
    }
    switch (status) {
      case 'approved':
        return <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Aceptado" />;
      case 'rejected':
        return <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" title="Rechazado" />;
      case 'pending':
      default:
        return <span className="w-2.5 h-2.5 rounded-full bg-amber-400" title="Pendiente" />;
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto" id="special-release-dashboard-root">
      {/* Upper header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck size={32} className="text-blue-600" />
            Liberación Especial
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Gestión, evaluación y autorización de desviaciones para materias primas y producto terminado.
          </p>
        </div>
        <button
          id="btn-new-special-release"
          onClick={() => navigate('/new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-200 cursor-pointer text-sm"
        >
          <PlusCircle size={18} />
          Nueva Solicitud
        </button>
      </div>

      {/* Navigation Tabs Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          id="tab-special-releases"
          onClick={() => setActiveTab('releases')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
            activeTab === 'releases'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
          }`}
        >
          <ShieldCheck size={18} />
          Solicitudes LE
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
            activeTab === 'releases' ? 'bg-blue-700 text-white' : 'bg-slate-200 text-slate-700'
          }`}>
            {releases.length}
          </span>
        </button>

        <button
          id="tab-status-ac-le"
          onClick={() => setActiveTab('status_ac')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer ${
            activeTab === 'status_ac'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-200'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
          }`}
        >
          <ListChecks size={18} />
          Status AC LE
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
            activeTab === 'status_ac' ? 'bg-amber-700 text-white' : 'bg-slate-200 text-slate-700'
          }`}>
            {acLePendingList.length}
          </span>
        </button>
      </div>

      {/* TAB 1: SOLICITUDES LE */}
      {activeTab === 'releases' && (
        <div className="space-y-8">
          {/* Summary Statistics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cargadas</span>
              <span className="text-2xl font-black text-slate-800 mt-2">{stats.total}</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Creadas</span>
              <span className="text-2xl font-black text-slate-600 mt-2">{stats.draft}</span>
            </div>
            <div className="bg-amber-50/50 border border-amber-200/60 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">En Revisión</span>
              <span className="text-2xl font-black text-amber-700 mt-2">{stats.pending}</span>
            </div>
            <div className="bg-emerald-50/50 border border-emerald-200/60 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Aceptadas</span>
              <span className="text-2xl font-black text-emerald-700 mt-2">{stats.approved}</span>
            </div>
            <div className="bg-rose-50/50 border border-rose-200/60 p-5 rounded-2xl shadow-sm flex flex-col justify-between col-span-2 md:col-span-1">
              <span className="text-xs font-bold text-rose-500 uppercase tracking-wider">Rechazadas</span>
              <span className="text-2xl font-black text-rose-700 mt-2">{stats.rejected}</span>
            </div>
          </div>

          {/* Tareas Pendientes */}
          <div className="space-y-4" id="pending-tasks-block">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <AlertCircle className="text-amber-600 animate-pulse" size={20} />
                <h2 className="text-lg font-extrabold text-slate-800 tracking-tight">
                  {isAdmin && showAllSystemPending ? 'Todas las Firmas Pendientes' : 'Mis Tareas Pendientes'} ({pendingTasks.length})
                </h2>
              </div>
              
              {isAdmin && (
                <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 p-1 rounded-xl text-xs font-bold text-slate-600 shadow-inner">
                  <button
                    onClick={() => setShowAllSystemPending(false)}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      !showAllSystemPending 
                        ? 'bg-amber-600 text-white shadow-xs' 
                        : 'hover:bg-slate-200/50'
                    }`}
                  >
                    Solo mis asignadas
                  </button>
                  <button
                    onClick={() => setShowAllSystemPending(true)}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      showAllSystemPending 
                        ? 'bg-amber-600 text-white shadow-xs' 
                        : 'hover:bg-slate-200/50'
                    }`}
                  >
                    Todas las del sistema
                  </button>
                </div>
              )}
            </div>

            {pendingTasks.length === 0 ? (
              <div className="bg-emerald-50/20 border border-emerald-100 rounded-2xl p-6 text-center space-y-2" id="pending-tasks-empty">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-1">
                  <CheckCircle2 size={20} />
                </div>
                <h3 className="text-slate-800 font-bold text-sm">No hay tareas pendientes</h3>
                <p className="text-slate-400 text-xs max-w-md mx-auto">
                  {isAdmin && showAllSystemPending 
                    ? 'No hay solicitudes de liberación especial pendientes de evaluar en todo el sistema.'
                    : 'No tiene solicitudes de liberación especial que requieran su firma o confirmación en este momento.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingTasks.map(t => {
                  const r = t.release;
                  return (
                    <motion.div
                      key={t.id}
                      whileHover={{ y: -2, scale: 1.005 }}
                      onClick={() => navigate(`/special-release/${r.id}`)}
                      className="bg-white border border-slate-200 hover:border-amber-400 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer flex justify-between items-center gap-4"
                    >
                      <div className="space-y-2 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-slate-950 text-xs sm:text-sm tracking-tight">
                            LE-#{r.releaseNumber}
                          </span>
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[9px] font-black tracking-wider text-slate-600 uppercase">
                            {r.company}
                          </span>
                          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-extrabold flex items-center gap-1 uppercase tracking-wider">
                            {t.taskType === 'evaluation' ? (
                              <>Firma: {t.areaLabel}</>
                            ) : (
                              <>{t.areaLabel}</>
                            )}
                          </span>
                        </div>
                        
                        <div className="text-[11px] text-slate-500 font-medium truncate">
                          {r.type === 'raw_material' ? (
                            <><strong>OC:</strong> {r.purchaseOrderNumber || '-'} | <strong>Cod:</strong> {r.code || '-'} - {r.description || '-'}</>
                          ) : (
                            <><strong>OF:</strong> {r.ofNumber || '-'} | <strong>Prod/Mod:</strong> {r.machineModel || '-'}</>
                          )}
                        </div>

                        <p className="text-slate-600 text-xs truncate max-w-sm italic bg-slate-50 p-1.5 rounded-md border border-slate-100">
                          "{r.deviationDescription}"
                        </p>
                      </div>

                      <button className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded-xl text-[10px] uppercase tracking-wider transition-colors shrink-0 cursor-pointer shadow-sm">
                        {t.taskType === 'evaluation' ? 'Evaluar' : 'Confirmar'}
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dynamic Filter Controls */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
              <Filter size={16} />
              Filtros de Búsqueda
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Buscar por Nº, OF, desvío, proveedor..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <select
                  value={filterCompany}
                  onChange={(e) => setFilterCompany(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:outline-none"
                >
                  <option value="Todas">Empresa: Todas</option>
                  {COMPANIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:outline-none"
                >
                  <option value="Todos">Tipo de Desvío: Todos</option>
                  <option value="raw_material">Materia Prima y Materiales</option>
                  <option value="finished_product">Producto Terminado</option>
                </select>
              </div>

              <div>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:outline-none"
                >
                  <option value="Todos">Estado: Todos</option>
                  <option value="draft">Solicitud Creada</option>
                  <option value="pending_approval">En Revisión</option>
                  <option value="approved">Liberación Especial Aceptada</option>
                  <option value="rejected">Liberación Especial Rechazada</option>
                </select>
              </div>
            </div>
          </div>

          {/* Main Special Releases List Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
              <Clock className="animate-spin" size={32} />
              <span className="text-sm font-semibold">Cargando liberaciones especiales...</span>
            </div>
          ) : filteredReleases.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl py-20 text-center shadow-sm">
              <FileText size={48} className="mx-auto text-slate-300 mb-4" />
              <h3 className="text-slate-800 font-bold text-lg">No se encontraron solicitudes</h3>
              <p className="text-slate-400 text-sm mt-1 max-w-md mx-auto">
                Ajuste los filtros de búsqueda o registre una nueva solicitud de liberación especial en el botón superior.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3" id="special-releases-list-container">
              {filteredReleases.map(r => (
                <motion.div
                  key={r.id}
                  whileHover={{ x: 4, scale: 1.002 }}
                  onClick={() => navigate(`/special-release/${r.id}`)}
                  className="bg-white border border-slate-200 rounded-2xl p-4 md:p-5 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Col 1: ID, Company, Date */}
                  <div className="flex items-center gap-3 min-w-[160px]">
                    <div className="flex flex-col">
                      <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">
                        LE-#{r.releaseNumber}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {format(toDateSafe(r.date), 'dd/MM/yyyy')}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider bg-slate-100 border border-slate-200 text-slate-600 uppercase">
                      {r.company}
                    </span>
                  </div>

                  {/* Col 2: Type & Main ID fields (OC/OF) */}
                  <div className="flex flex-col min-w-[200px] text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-slate-500 font-bold mb-1">
                      {r.type === 'raw_material' ? (
                        <ShoppingBag size={13} className="text-blue-500" />
                      ) : (
                        <Box size={13} className="text-emerald-500" />
                      )}
                      {r.type === 'raw_material' ? 'Materia Prima y Mat.' : 'Producto Terminado'}
                    </span>
                    <div className="text-slate-500 space-y-0.5 text-[11px]">
                      {r.type === 'raw_material' ? (
                        <>
                          <div><span className="font-bold text-slate-400">OC:</span> {r.purchaseOrderNumber || '-'} | <span className="font-bold text-slate-400">Cod:</span> {r.code || '-'}</div>
                          <div className="truncate max-w-[180px]"><span className="font-bold text-slate-400">Prov:</span> {r.vendor || '-'}</div>
                        </>
                      ) : (
                        <>
                          <div><span className="font-bold text-slate-400">OF:</span> {r.ofNumber || '-'} | <span className="font-bold text-slate-400">Prod:</span> {r.machineModel || '-'}</div>
                          <div className="truncate max-w-[180px]"><span className="font-bold text-slate-400">Cli:</span> {r.clientDealer || '-'}</div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Col 3: Deviation Description */}
                  <div className="flex-1 min-w-[200px] md:max-w-xs lg:max-w-md">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Desvío Detectado</span>
                    <p className="text-slate-600 text-xs line-clamp-2 leading-relaxed font-medium italic">
                      "{r.deviationDescription}"
                    </p>
                  </div>

                  {/* Col 4: Approvals Mini-Matrix */}
                  <div className="flex flex-col gap-1 min-w-[180px]">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Aprobaciones</span>
                    <div className="flex items-center gap-3 text-[10px] font-extrabold text-slate-600 bg-slate-50 border border-slate-100 rounded-lg py-1.5 px-2.5 w-fit">
                      <div className={`flex items-center gap-1 ${r.approvals.calidad.excluded ? 'opacity-40 line-through' : ''}`} title={r.approvals.calidad.excluded ? 'Calidad: No Aplica' : `Calidad: ${r.approvals.calidad.status}`}>
                        {getApprovalIndicator(r.approvals.calidad.status, r.approvals.calidad.excluded)}
                        <span className="text-slate-500 text-[9px]">CAL</span>
                      </div>
                      <div className={`flex items-center gap-1 ${r.approvals.ingenieria.excluded ? 'opacity-40 line-through' : ''}`} title={r.approvals.ingenieria.excluded ? 'Ingeniería: No Aplica' : `Ingeniería: ${r.approvals.ingenieria.status}`}>
                        {getApprovalIndicator(r.approvals.ingenieria.status, r.approvals.ingenieria.excluded)}
                        <span className="text-slate-500 text-[9px]">ING</span>
                      </div>
                      <div className="flex items-center gap-1" title={`Comercial: ${r.approvals.comercial.status}`}>
                        {getApprovalIndicator(r.approvals.comercial.status, r.approvals.comercial.excluded)}
                        <span className="text-slate-500 text-[9px]">COM</span>
                      </div>
                      <div className={`flex items-center gap-1 ${r.approvals.operaciones.excluded ? 'opacity-40 line-through' : ''}`} title={r.approvals.operaciones.excluded ? 'Operaciones: No Aplica' : `Operaciones: ${r.approvals.operaciones.status}`}>
                        {getApprovalIndicator(r.approvals.operaciones.status, r.approvals.operaciones.excluded)}
                        <span className="text-slate-500 text-[9px]">OPE</span>
                      </div>
                      <div className="flex items-center gap-1" title={`Postventa: ${r.notifications.posventa.confirmed ? 'Confirmado' : 'Pendiente'}`}>
                        <span className={`w-2 h-2 rounded-full ${r.notifications.posventa.confirmed ? 'bg-blue-500' : 'bg-slate-300'}`} />
                        <span className="text-slate-500 text-[9px]">POS</span>
                      </div>
                    </div>
                  </div>

                  {/* Col 5: Status Badge & Chevron */}
                  <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 pt-3 md:pt-0">
                    <div>{getStatusBadge(r.status)}</div>
                    <div className="text-blue-600 bg-blue-50 p-2 rounded-xl hover:bg-blue-100 transition-colors cursor-pointer hidden md:block">
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: STATUS AC LE */}
      {activeTab === 'status_ac' && (
        <div className="space-y-6" id="status-ac-le-tab-content">
          {/* Summary Metric Cards for Status AC LE */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Acciones Pendientes</span>
              <span className="text-2xl font-black text-amber-600 mt-2">{acStats.totalPending}</span>
            </div>
            <div className="bg-rose-50/60 border border-rose-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-rose-500 uppercase tracking-wider flex items-center gap-1">
                <AlertCircle size={14} /> Vencidas
              </span>
              <span className="text-2xl font-black text-rose-700 mt-2">{acStats.overdue}</span>
            </div>
            <div className="bg-amber-50/60 border border-amber-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                <Clock size={14} /> Próximas (≤ 3d)
              </span>
              <span className="text-2xl font-black text-amber-700 mt-2">{acStats.dueSoon}</span>
            </div>
            <div className="bg-emerald-50/60 border border-emerald-200 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 size={14} /> En Término
              </span>
              <span className="text-2xl font-black text-emerald-700 mt-2">{acStats.onTrack}</span>
            </div>
          </div>

          {/* Dynamic Filter Controls for Status AC LE */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                <Filter size={16} />
                Filtros de Acciones Pendientes
              </div>
              <span className="text-xs font-semibold text-slate-400">
                Mostrando {filteredAcLePendingList.length} de {acLePendingList.length} acciones pendientes
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Buscar por LE#, OF, Lote, Producto, Acción..."
                  value={acSearchQuery}
                  onChange={(e) => setAcSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-4 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              <div>
                <select
                  value={acFilterCompany}
                  onChange={(e) => setAcFilterCompany(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:outline-none"
                >
                  <option value="Todas">Empresa: Todas</option>
                  {COMPANIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={acFilterUrgency}
                  onChange={(e) => setAcFilterUrgency(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:outline-none"
                >
                  <option value="Todas">Urgencia: Todas</option>
                  <option value="Vencidas">Solo Vencidas</option>
                  <option value="Próximas">Próximas a Vencer (≤ 3 días)</option>
                  <option value="En Término">En Término</option>
                </select>
              </div>

              <div>
                <select
                  value={acFilterResponsible}
                  onChange={(e) => setAcFilterResponsible(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-4 text-xs font-bold focus:outline-none"
                >
                  <option value="Todos">Responsable: Todos</option>
                  {uniqueAcResponsibles.map(resp => (
                    <option key={resp} value={resp}>{resp}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Status AC LE Data Table */}
          {acLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
              <Clock className="animate-spin text-amber-500" size={32} />
              <span className="text-sm font-semibold">Cargando estado de acciones correctivas...</span>
            </div>
          ) : filteredAcLePendingList.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl py-16 text-center shadow-sm">
              <CheckCircle2 size={48} className="mx-auto text-emerald-400 mb-3" />
              <h3 className="text-slate-800 font-bold text-lg">No hay acciones pendientes registradas</h3>
              <p className="text-slate-400 text-sm mt-1 max-w-md mx-auto">
                {acSearchQuery || acFilterCompany !== 'Todas' || acFilterUrgency !== 'Todas' || acFilterResponsible !== 'Todos'
                  ? 'No se encontraron acciones correctivas pendientes que coincidan con los filtros seleccionados.'
                  : 'Todas las Liberaciones Especiales tienen sus acciones completadas, verificadas o no poseen acciones pendientes en este momento.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                      <th className="py-3.5 px-4">N° LE</th>
                      <th className="py-3.5 px-4">N° OF / Lote</th>
                      <th className="py-3.5 px-4">Máquina / Producto</th>
                      <th className="py-3.5 px-4 max-w-xs">Acción Correctiva</th>
                      <th className="py-3.5 px-4">Fecha Requerida</th>
                      <th className="py-3.5 px-4">Responsable</th>
                      <th className="py-3.5 px-4">Estado</th>
                      <th className="py-3.5 px-4 text-right">Ver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredAcLePendingList.map((row) => (
                      <tr 
                        key={`${row.releaseId}-${row.actionId}`}
                        className="hover:bg-slate-50/80 transition-colors group"
                      >
                        {/* 1. Número de Liberación Especial */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors">
                              LE-#{row.releaseNumber}
                            </span>
                            <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-slate-100 border border-slate-200 text-slate-600 w-fit">
                              {row.company}
                            </span>
                          </div>
                        </td>

                        {/* 2. Número de OF o Lote */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-bold text-slate-800">
                            {row.ofOrLot}
                          </div>
                          <span className="text-[10px] text-slate-400 block font-medium">
                            {row.type === 'finished_product' ? 'Prod. Terminado' : 'Mat. Prima'}
                          </span>
                        </td>

                        {/* 3. Máquina o Producto */}
                        <td className="py-3.5 px-4 max-w-[180px]">
                          <span className="font-semibold text-slate-700 line-clamp-2 leading-snug">
                            {row.machineOrProduct}
                          </span>
                        </td>

                        {/* 4. Acción Correctiva */}
                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="font-medium text-slate-800 line-clamp-2 leading-relaxed">
                            {row.actionDescription}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded">
                              Hallazgo #{row.findingNumber}
                            </span>
                          </div>
                        </td>

                        {/* 5. Fecha Requerida */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="space-y-1">
                            <div className="font-bold text-slate-800 flex items-center gap-1">
                              <Calendar size={12} className="text-slate-400" />
                              {format(row.deadline, 'dd/MM/yyyy')}
                            </div>
                            {row.isOverdue ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                                <AlertCircle size={10} className="text-rose-600 animate-pulse" />
                                Vencida ({Math.abs(row.daysToDeadline)}d)
                              </span>
                            ) : row.daysToDeadline <= 3 ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                                <Clock size={10} className="text-amber-600" />
                                Próxima ({row.daysToDeadline}d)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md">
                                {row.daysToDeadline}d restantes
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 6. Responsable */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <User size={13} className="text-slate-400 shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-slate-800 block truncate max-w-[140px]">
                                {row.responsibleName}
                              </span>
                              {row.responsibleEmail && (
                                <span className="text-[10px] text-slate-400 block truncate max-w-[140px]">
                                  {row.responsibleEmail}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 7. Estado de la Acción */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock size={12} className="animate-spin text-amber-500" />
                            Pendiente
                          </span>
                        </td>

                        {/* 8. Acciones / Ver */}
                        <td className="py-3.5 px-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => navigate(`/special-release/${row.releaseId}`)}
                              className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg transition-colors text-[11px] flex items-center gap-1 cursor-pointer"
                              title="Ver Liberación Especial"
                            >
                              <span>Ver LE</span>
                              <ArrowUpRight size={12} />
                            </button>
                            <a
                              href={`/findings/${row.findingId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg transition-colors text-[11px] flex items-center gap-1"
                              title="Ver Hallazgo en Correctivas"
                            >
                              <span>Hallazgo</span>
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, getDocs, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ChangeRequest, UserProfile, UserRole, AreaReview } from '../types';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, PlusCircle, Filter, Search, ChevronRight, User, Calendar, 
  CheckCircle, XCircle, Clock, CheckCircle2, AlertCircle, RefreshCw, Mail, ListCollapse
} from 'lucide-react';
import { format } from 'date-fns';

const MISSIONS = ['Seguridad y Medio Ambiente', 'Productividad', 'Calidad', 'Costos', 'Otros'];

const toDateSafe = (val: any): Date => {
  if (!val) return new Date();
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
};

export default function ChangeManagementDashboard({ user }: { user: UserProfile }) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Filters
  const [filterMission, setFilterMission] = useState('Todas');
  const [filterStatus, setFilterStatus] = useState('Todos');
  const [searchQuery, setSearchQuery] = useState('');

  // Real-time listener for Change Requests
  useEffect(() => {
    const q = query(collection(db, 'change_requests'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: ChangeRequest[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as ChangeRequest);
      });
      setRequests(data);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching change requests:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Map of change request ID -> actions status metrics
  const [crActionsMap, setCrActionsMap] = useState<Record<string, { pendingCount: number; totalCount: number }>>({});

  // Listen to linked findings and fetch their corrective actions to determine action status
  useEffect(() => {
    const q = query(collection(db, 'findings'), where('isChangeRequest', '==', true));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const findingsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const statusMap: Record<string, { pendingCount: number; totalCount: number }> = {};

      for (const f of findingsList) {
        const crId = (f as any).changeRequestId;
        if (!crId) continue;

        if (!statusMap[crId]) {
          statusMap[crId] = { pendingCount: 0, totalCount: 0 };
        }

        // Fetch corrective actions for this finding
        const actionsSnap = await getDocs(collection(db, 'findings', f.id, 'correctiveActions'));
        actionsSnap.docs.forEach(aDoc => {
          const actionData = aDoc.data();
          statusMap[crId].totalCount += 1;
          if (actionData.status === 'pending') {
            statusMap[crId].pendingCount += 1;
          }
        });
      }
      setCrActionsMap(statusMap);
    });

    return () => unsubscribe();
  }, []);

  // Filter logic
  const filteredRequests = requests.filter(r => {
    const matchMission = filterMission === 'Todas' || r.mission === filterMission;
    const matchStatus = filterStatus === 'Todos' || r.status === filterStatus;
    
    const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const queryNorm = normalize(searchQuery);
    const matchSearch = !queryNorm || 
      normalize(r.title || '').includes(queryNorm) ||
      normalize(r.description || '').includes(queryNorm) ||
      normalize(r.creatorName || '').includes(queryNorm) ||
      `m-#${r.changeNumber}`.includes(queryNorm) ||
      `#${r.changeNumber}`.includes(queryNorm);

    return matchMission && matchStatus && matchSearch;
  });

  // Extract pending reviews for the current logged-in user
  const myPendingReviews = requests.filter(r => {
    if (r.status !== 'pending_review' || !r.reviews) return false;
    
    // Check if any of the reviews is assigned to the current user and is pending
    return Object.entries(r.reviews).some(([areaKey, val]) => {
      const areaReview = val as AreaReview;
      return areaReview.applies && 
             areaReview.status === 'pending' && 
             areaReview.responsibleId === user.id;
    });
  });

  // Extract pending final approvals for the current logged-in user
  const myPendingFinalApprovals = requests.filter(r => {
    return r.status === 'pending_approval' && 
           r.finalApproverId === user.id && 
           r.finalApprovalStatus === 'pending';
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3" id="loading-spinner">
        <RefreshCw className="animate-spin text-emerald-600" size={32} />
        <span className="text-slate-500 text-sm font-medium">Cargando Gestión de Cambios...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto" id="change-management-dashboard-root">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-700 rounded-3xl p-8 sm:p-10 text-white shadow-xl relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6" id="dashboard-header">
        <div className="space-y-3 z-10">
          <div className="flex items-center gap-2 bg-emerald-700/40 w-fit px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase">
            <RefreshCw size={14} className="animate-pulse" />
            <span>Módulo de Calidad</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Gestión de Cambios</h1>
          <p className="text-emerald-100 text-sm max-w-2xl leading-relaxed">
            Gestione las propuestas de modificación, revisiones de impacto por áreas, aprobaciones y planes de acción correctivos vinculados.
          </p>
        </div>
        <button
          onClick={() => navigate('/new')}
          id="btn-new-change-request"
          className="flex items-center gap-2 bg-white hover:bg-emerald-50 text-emerald-900 font-bold px-6 py-3.5 rounded-2xl shadow-lg hover:shadow-xl transition-all cursor-pointer text-sm w-fit self-start md:self-auto"
        >
          <PlusCircle size={18} />
          <span>Solicitar Cambio</span>
        </button>
      </div>

      {/* Counters Section */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" id="status-counters-grid">
        {/* Total Card */}
        <div 
          onClick={() => setFilterStatus('Todos')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md ${
            filterStatus === 'Todos' ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-500' : 'border-slate-100 bg-white hover:border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Solicitudes</span>
            <FileText size={16} className="text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-800 mt-2">{requests.length}</div>
        </div>

        {/* Draft Card */}
        <div 
          onClick={() => setFilterStatus('draft')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md ${
            filterStatus === 'draft' ? 'border-slate-600 bg-slate-50 ring-1 ring-slate-500' : 'border-slate-100 bg-white hover:border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Borrador</span>
            <FileText size={16} className="text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-700 mt-2">
            {requests.filter(r => r.status === 'draft').length}
          </div>
        </div>

        {/* Pending Review Card */}
        <div 
          onClick={() => setFilterStatus('pending_review')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md ${
            filterStatus === 'pending_review' ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-500' : 'border-slate-100 bg-white hover:border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">En Revisión</span>
            <Clock size={16} className="text-blue-500" />
          </div>
          <div className="text-2xl font-black text-blue-700 mt-2">
            {requests.filter(r => r.status === 'pending_review').length}
          </div>
        </div>

        {/* Pending Approval Card */}
        <div 
          onClick={() => setFilterStatus('pending_approval')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md ${
            filterStatus === 'pending_approval' ? 'border-amber-600 bg-amber-50/50 ring-1 ring-amber-500' : 'border-slate-100 bg-white hover:border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Pend. Aprobación</span>
            <AlertCircle size={16} className="text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-700 mt-2">
            {requests.filter(r => r.status === 'pending_approval').length}
          </div>
        </div>

        {/* Approved Card */}
        <div 
          onClick={() => setFilterStatus('approved')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md ${
            filterStatus === 'approved' ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-500' : 'border-slate-100 bg-white hover:border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Aprobados</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2">
            {requests.filter(r => r.status === 'approved').length}
          </div>
        </div>

        {/* Rejected Card */}
        <div 
          onClick={() => setFilterStatus('rejected')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between shadow-sm hover:shadow-md ${
            filterStatus === 'rejected' ? 'border-red-600 bg-red-50/50 ring-1 ring-red-500' : 'border-slate-100 bg-white hover:border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Rechazados</span>
            <XCircle size={16} className="text-red-500" />
          </div>
          <div className="text-2xl font-black text-red-700 mt-2">
            {requests.filter(r => r.status === 'rejected').length}
          </div>
        </div>
      </div>

      {/* Grid of Pending Tasks */}
      <div className="space-y-4" id="my-pending-tasks-section">
        <div className="flex items-center gap-2">
          <AlertCircle className="text-emerald-600" size={20} />
          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Mis Tareas Pendientes</h2>
        </div>
        
        {myPendingReviews.length === 0 && myPendingFinalApprovals.length === 0 ? (
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-center text-slate-500 text-xs font-semibold">
            🎉 No tienes tareas pendientes de revisión o aprobación asignadas en este momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Reviews pending */}
            {myPendingReviews.map(r => {
              // Find which areas are assigned to this user and are pending
              const pendingAreas = Object.entries(r.reviews)
                .filter(([_, val]) => {
                  const areaReview = val as AreaReview;
                  return areaReview.applies && areaReview.status === 'pending' && areaReview.responsibleId === user.id;
                })
                .map(([key]) => {
                  const map: Record<string, string> = {
                    ingenieriaProcesos: 'Ingeniería de Procesos',
                    produccion: 'Producción',
                    mantenimiento: 'Mantenimiento',
                    calidad: 'Calidad',
                    supplyChain: 'Supply Chain',
                    hse: 'Salud, Seguridad y Medio Ambiente',
                    infraestructura: 'Infraestructura',
                    recursosHumanos: 'Recursos Humanos'
                  };
                  return map[key] || key;
                });

              return (
                <div 
                  key={`pending-review-${r.id}`}
                  onClick={() => navigate(`/change-request/${r.id}`)}
                  className="bg-amber-50/70 border border-amber-200 rounded-2xl p-5 hover:bg-amber-50 cursor-pointer transition-all flex items-start gap-4 shadow-sm hover:shadow-md"
                >
                  <div className="p-3 bg-amber-100 text-amber-700 rounded-xl">
                    <ListCollapse size={20} />
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex justify-between items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Revisión de Área</span>
                        {r.company && (
                          <span className="bg-indigo-100 text-indigo-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                            {r.company}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 font-mono">SC-#{r.changeNumber}</span>
                    </div>
                    <h3 className="font-bold text-slate-800 text-sm truncate">{r.title}</h3>
                    <p className="text-xs text-slate-600">
                      Tenes pendiente la revisión para: <strong className="text-amber-950">{pendingAreas.join(', ')}</strong>
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Final Approvals pending */}
            {myPendingFinalApprovals.map(r => (
              <div 
                key={`pending-final-${r.id}`}
                onClick={() => navigate(`/change-request/${r.id}`)}
                className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 hover:bg-emerald-50 cursor-pointer transition-all flex items-start gap-4 shadow-sm hover:shadow-md"
              >
                <div className="p-3 bg-emerald-100 text-emerald-800 rounded-xl">
                  <CheckCircle2 size={20} />
                </div>
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Aprobación Final</span>
                      {r.company && (
                        <span className="bg-indigo-100 text-indigo-800 text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                          {r.company}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 font-mono">SC-#{r.changeNumber}</span>
                  </div>
                  <h3 className="font-bold text-slate-800 text-sm truncate">{r.title}</h3>
                  <p className="text-xs text-slate-600">
                    Fuiste asignado como el <strong className="text-emerald-950">Aprobador Final</strong> para autorizar este cambio.
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters & Search Controls */}
      <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md space-y-4" id="filters-container">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:flex-1">
            <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            <input
              type="text"
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-700 font-medium"
              placeholder="Buscar por título, descripción, solicitante o Nro..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap sm:flex-nowrap gap-3 w-full md:w-auto">
            {/* Mission Filter */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 w-full sm:w-auto">
              <Filter size={16} className="text-slate-400 flex-shrink-0" />
              <select
                className="bg-transparent border-0 outline-none text-xs font-semibold text-slate-600 focus:ring-0 cursor-pointer w-full"
                value={filterMission}
                onChange={(e) => setFilterMission(e.target.value)}
              >
                <option value="Todas">Misión: Todas</option>
                {MISSIONS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 w-full sm:w-auto">
              <Filter size={16} className="text-slate-400 flex-shrink-0" />
              <select
                className="bg-transparent border-0 outline-none text-xs font-semibold text-slate-600 focus:ring-0 cursor-pointer w-full"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="Todos">Estado: Todos</option>
                <option value="draft">Borrador</option>
                <option value="pending_review">En Revisión</option>
                <option value="pending_approval">Pendiente Aprobación</option>
                <option value="approved">Aprobado</option>
                <option value="rejected">Rechazado</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main List */}
      <div className="flex flex-col gap-4" id="requests-list-container">
        {filteredRequests.length === 0 ? (
          <div className="bg-white rounded-3xl border border-slate-100 p-12 text-center shadow-md space-y-3" id="no-requests-fallback">
            <div className="p-4 bg-slate-50 rounded-full w-fit mx-auto text-slate-400">
              <FileText size={36} />
            </div>
            <h3 className="text-base font-bold text-slate-700">No se encontraron solicitudes</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Ajuste los filtros de búsqueda o presione "Solicitar Cambio" para registrar una nueva propuesta.
            </p>
          </div>
        ) : (
          filteredRequests.map((r) => {
            const date = toDateSafe(r.createdAt);
            const formattedDate = format(date, 'dd/MM/yyyy');

            // Compute counts of reviews
            const activeReviews = (Object.values(r.reviews || {}) as AreaReview[]).filter(rev => rev.applies);
            const totalActiveReviews = activeReviews.length;
            const approvedActiveReviews = activeReviews.filter(rev => rev.status === 'approved').length;
            const rejectedActiveReviews = activeReviews.filter(rev => rev.status === 'rejected').length;

            return (
              <motion.div
                key={r.id}
                whileHover={{ y: -2 }}
                onClick={() => navigate(`/change-request/${r.id}`)}
                className="bg-white rounded-2xl border border-slate-100 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer transition-all hover:border-emerald-200 hover:shadow-lg shadow-sm"
              >
                <div className="space-y-3 flex-grow min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                      SC-#{r.changeNumber}
                    </span>
                    
                    {/* Status Badge */}
                    {r.status === 'draft' && (
                      <span className="bg-slate-100 text-slate-600 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-slate-200">
                        Borrador
                      </span>
                    )}
                    {r.status === 'pending_review' && (
                      <span className="bg-blue-50 text-blue-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-blue-100 flex items-center gap-1">
                        <Clock size={12} className="animate-pulse" />
                        En Revisión ({approvedActiveReviews}/{totalActiveReviews})
                      </span>
                    )}
                    {r.status === 'pending_approval' && (
                      <span className="bg-amber-50 text-amber-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-amber-100 flex items-center gap-1">
                        <Clock size={12} />
                        Aprobación Final
                      </span>
                    )}
                    {r.status === 'approved' && (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
                        <span className="bg-emerald-50 text-emerald-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-emerald-100 flex items-center gap-1 w-fit">
                          <CheckCircle size={12} />
                          Aprobado
                        </span>
                        {crActionsMap[r.id] && crActionsMap[r.id].totalCount > 0 && (
                          crActionsMap[r.id].pendingCount > 0 ? (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-amber-200 w-fit">
                              con acciones pendientes
                            </span>
                          ) : (
                            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-emerald-200 w-fit font-bold">
                              acciones completadas
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {r.status === 'rejected' && (
                      <span className="bg-red-50 text-red-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-red-100 flex items-center gap-1">
                        <XCircle size={12} />
                        Rechazado
                      </span>
                    )}

                    <span className="bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-lg tracking-wide uppercase">
                      {r.mission}
                    </span>

                    {r.company && (
                      <span className="bg-indigo-50 text-indigo-700 text-[10px] font-extrabold px-2 py-0.5 rounded-lg tracking-wide uppercase">
                        {r.company}
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-slate-800 tracking-tight leading-snug truncate">
                    {r.title}
                  </h3>

                  <p className="text-slate-500 text-xs font-normal line-clamp-2 max-w-4xl leading-relaxed">
                    {r.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400 text-xs">
                    <div className="flex items-center gap-1 font-medium">
                      <User size={13} />
                      <span>{r.creatorName}</span>
                    </div>
                    <div className="flex items-center gap-1 font-medium">
                      <Calendar size={13} />
                      <span>{formattedDate}</span>
                    </div>
                  </div>
                </div>

                {/* Progress Circle or State indicator on Desktop */}
                <div className="flex items-center gap-4 self-end md:self-auto border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 w-full md:w-auto justify-between md:justify-end">
                  {r.status === 'pending_review' && totalActiveReviews > 0 && (
                    <div className="text-right">
                      <div className="text-xs text-slate-400 font-medium">Revisiones</div>
                      <div className="text-sm font-bold text-slate-700">
                        {approvedActiveReviews} / {totalActiveReviews} aprobadas
                        {rejectedActiveReviews > 0 && (
                          <span className="text-red-500 ml-1">({rejectedActiveReviews} rechazadas)</span>
                        )}
                      </div>
                    </div>
                  )}

                  {r.status === 'approved' && (
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl text-xs font-semibold">
                        <CheckCircle2 size={15} />
                        <span>Aprobado</span>
                      </div>
                      {crActionsMap[r.id] && crActionsMap[r.id].totalCount > 0 && (
                        crActionsMap[r.id].pendingCount > 0 ? (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2 py-0.5 rounded-lg whitespace-nowrap uppercase tracking-wider">
                            con acciones pendientes
                          </span>
                        ) : (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-lg whitespace-nowrap uppercase tracking-wider">
                            acciones completadas
                          </span>
                        )
                      )}
                    </div>
                  )}

                  {r.status === 'rejected' && (
                    <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-3 py-1.5 rounded-xl text-xs font-semibold">
                      <XCircle size={15} />
                      <span>Rechazado</span>
                    </div>
                  )}

                  <div className="p-2 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100 hover:text-slate-600 transition-colors">
                    <ChevronRight size={18} />
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}

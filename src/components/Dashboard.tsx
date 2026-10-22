import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Finding, UserProfile, FindingStatus, UserRole, ActionStatus, CorrectiveAction } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, FileText, ChevronRight, ChevronDown, ChevronUp, Filter, Bell, Mail, Settings, CalendarDays, Sparkles, ShieldAlert, User } from 'lucide-react';
import { format, isAfter, addDays, isPast } from 'date-fns';

const toDateSafe = (val: any): Date => {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

export default function Dashboard({ user, category }: { user: UserProfile; category?: 'corrective' | 'improvement' | null }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [allActions, setAllActions] = useState<CorrectiveAction[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Filters
  const [filterCompany, setFilterCompany] = useState('Todas');
  const [filterUser, setFilterUser] = useState('Todos');
  const [isMounted, setIsMounted] = useState(false);
  const navigate = useNavigate();

  // Column level filters
  const [colFilterNumber, setColFilterNumber] = useState('');
  const [colFilterCompany, setColFilterCompany] = useState('Todas');
  const [colFilterDate, setColFilterDate] = useState('');
  const [colFilterDescription, setColFilterDescription] = useState('');
  const [colFilterOwner, setColFilterOwner] = useState('');
  const [colFilterStatus, setColFilterStatus] = useState('Todos');

  const isImprovement = category === 'improvement';

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    // Fetch users for filtering option
    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, 'users'));
        const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile));
        setUsersList(list);
      } catch (e) {
        console.error('Error fetching users for filter:', e);
      }
    };
    fetchUsers();
  }, []);

  useEffect(() => {
    setLoading(true);
    
    // 1. Findings Listener: All users can view all findings
    const findingsQuery = query(collection(db, 'findings'), orderBy('createdAt', 'desc'));

    const unsubscribeFindings = onSnapshot(findingsQuery, async (snapshot) => {
      let fList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any } as Finding));
      
      // Filter based on active category
      const filteredByCategory = fList.filter(f => {
        if (isImprovement) {
          return f.findingCategory === 'improvement';
        } else {
          return f.findingCategory !== 'improvement';
        }
      });

      setFindings(filteredByCategory);
      
      // Fetch all corrective actions for findings in parallel (much faster, non-blocking!)
      try {
        const actionsPromises = filteredByCategory.map(async (f) => {
          const actionsSnap = await getDocs(collection(db, 'findings', f.id, 'correctiveActions'));
          return actionsSnap.docs.map(doc => {
            const data = doc.data() as any;
            return { ...data, id: doc.id, findingId: f.id } as CorrectiveAction;
          });
        });
        const actionsResults = await Promise.all(actionsPromises);
        setAllActions(actionsResults.flat());
      } catch (err) {
        console.error('Error fetching actions in parallel:', err);
      }
      
      setLoading(false);
    }, (error) => {
      console.error('Error in findings listener:', error);
      handleFirestoreError(error, OperationType.LIST, 'findings');
      setLoading(false);
    });

    // 2. Notifications Listener
    const qNotif = query(
      collection(db, 'notifications'),
      where('to', '==', user.email),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const unsubscribeNotifs = onSnapshot(qNotif, (snapshot) => {
      setNotifications(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribeFindings();
      unsubscribeNotifs();
    };
  }, [user.id, user.role, user.email, isImprovement]);

  // Clientside filtering combining general and column-level filters
  const filteredFindings = findings.filter(f => {
    // General filters
    const matchesCompany = filterCompany === 'Todas' || f.company === filterCompany;
    let matchesUser = filterUser === 'Todos';
    if (!matchesUser) {
      const associatedActions = allActions.filter(a => a.findingId === f.id);
      const isResponsibleOfAny = associatedActions.some(a => a.responsibleId === filterUser);
      const isOwner = f.ownerId === filterUser;
      const isAnalysisResp = f.analysisResponsibleId === filterUser;
      matchesUser = isResponsibleOfAny || isOwner || isAnalysisResp;
    }
    if (!matchesCompany || !matchesUser) return false;

    // Column-level filters
    // 1. Nº
    if (colFilterNumber.trim() !== '') {
      const numStr = `#${f.findingNumber}`;
      const searchNum = colFilterNumber.toLowerCase().trim();
      if (!numStr.toLowerCase().includes(searchNum) && !String(f.findingNumber).includes(searchNum)) {
        return false;
      }
    }

    // 2. Empresa (column-level)
    if (colFilterCompany !== 'Todas' && f.company !== colFilterCompany) {
      return false;
    }

    // 3. Fecha del desvío
    if (colFilterDate.trim() !== '') {
      const formattedDate = f.findingDate ? format(toDateSafe(f.findingDate), 'dd/MM/yyyy') : '-';
      if (!formattedDate.toLowerCase().includes(colFilterDate.toLowerCase().trim())) {
        return false;
      }
    }

    // 4. Detalle del hallazgo
    if (colFilterDescription.trim() !== '') {
      if (!f.description.toLowerCase().includes(colFilterDescription.toLowerCase().trim())) {
        return false;
      }
    }

    // 5. Dueño
    if (colFilterOwner.trim() !== '') {
      const searchOwner = colFilterOwner.toLowerCase().trim();
      const ownerEmailStr = (f.ownerEmail || '').toLowerCase();
      if (!ownerEmailStr.includes(searchOwner)) {
        return false;
      }
    }

    // 6. Estado
    if (colFilterStatus !== 'Todos' && f.status !== colFilterStatus) {
      return false;
    }

    return true;
  });

  const filteredActions = allActions.filter(a => {
    const f = findings.find(find => find.id === a.findingId);
    if (!f) return false;
    const matchesCompany = filterCompany === 'Todas' || f.company === filterCompany;
    const matchesUser = filterUser === 'Todos' || a.responsibleId === filterUser;
    return matchesCompany && matchesUser;
  });

  // KPIs calculations
  const totalFindings = filteredFindings.length;

  // Corrective KPI values
  const pendingAnalysisCount = filteredFindings.filter(f => f.status === FindingStatus.PENDING_ANALYSIS).length;
  const overdueInvestigations = filteredFindings.filter(f => 
    f.status === FindingStatus.PENDING_ANALYSIS && f.analysisDeadline && isPast(toDateSafe(f.analysisDeadline))
  ).length;

  const activePendingActions = filteredActions.filter(a => a.status === ActionStatus.PENDING);
  
  const overdueActionsCount = activePendingActions.filter(a => {
    if (!a.deadline) return false;
    return isPast(toDateSafe(a.deadline));
  }).length;

  const actionsDueSoonCount = activePendingActions.filter(a => {
    if (!a.deadline) return false;
    const deadlineDate = toDateSafe(a.deadline);
    const thirtyDaysFromNow = addDays(new Date(), 30);
    return isAfter(deadlineDate, new Date()) && isAfter(thirtyDaysFromNow, deadlineDate);
  }).length;

  // Closed on time statistics
  const closedActions = filteredActions.filter(a => a.status === 'finished' || a.status === 'Completed' || a.status === 'Finalizada' || a.status === 'Finalizado' || a.status === 'finished_verified');
  const closedOnTime = closedActions.filter(a => {
    if (!a.deadline) return true;
    const dl = toDateSafe(a.deadline);
    const execDateStr = (a as any).executionDate || (a as any).updatedAt;
    if (!execDateStr) return true;
    const execDate = toDateSafe(execDateStr);
    return execDate <= dl;
  }).length;

  const closedOnTimePercentage = closedActions.length > 0 
    ? Math.round((closedOnTime / closedActions.length) * 100)
    : 100;

  // List of people with actions due in 30 days
  const peopleWithActionsDueSoon = activePendingActions.filter(a => {
    if (!a.deadline) return false;
    const deadlineDate = toDateSafe(a.deadline);
    const thirtyDaysFromNow = addDays(new Date(), 30);
    return isAfter(deadlineDate, new Date()) && isAfter(thirtyDaysFromNow, deadlineDate);
  });

  const groupedPeopleDueSoon: { displayName: string; email: string; count: number }[] = [];
  const mapPeople = new Map<string, { name: string; count: number }>();
  
  peopleWithActionsDueSoon.forEach(a => {
    const email = a.responsibleEmail || '';
    const emailPart = email ? email.split('@')[0] : 'Sin asignado';
    const val = mapPeople.get(email) || { name: usersList.find(u => u.email === email)?.displayName || emailPart, count: 0 };
    mapPeople.set(email, { name: val.name, count: val.count + 1 });
  });

  mapPeople.forEach((val, email) => {
    groupedPeopleDueSoon.push({ displayName: val.name, email, count: val.count });
  });

  const companiesList = ['Todas', 'TMC', 'Fertec', 'Metallo', 'Leaf', 'Fabril'];

  // Recharts Chart configurations
  const correctiveChartData = [
    { name: 'P. Análisis', value: pendingAnalysisCount, color: '#f59e0b' },
    { name: 'P. Acción', value: filteredFindings.filter(f => f.status === FindingStatus.PENDING_ACTION).length, color: '#3b82f6' },
    { name: 'P. Verif.', value: filteredFindings.filter(f => f.status === FindingStatus.PENDING_VERIFICATION).length, color: '#8b5cf6' },
    { name: 'Completado', value: filteredFindings.filter(f => f.status === FindingStatus.COMPLETED).length, color: '#10b981' },
    { name: 'Cancelado', value: filteredFindings.filter(f => f.status === FindingStatus.CANCELLED).length, color: '#ef4444' },
  ];

  const improvementChartData = [
    { name: 'P. Acción', value: filteredFindings.filter(f => f.status === FindingStatus.PENDING_ACTION).length, color: '#3b82f6' },
    { name: 'P. Verif.', value: filteredFindings.filter(f => f.status === FindingStatus.PENDING_VERIFICATION).length, color: '#8b5cf6' },
    { name: 'Completo', value: filteredFindings.filter(f => f.status === FindingStatus.COMPLETED).length, color: '#047857' },
    { name: 'Rechazada', value: filteredFindings.filter(f => f.status === FindingStatus.REJECTED).length, color: '#ef4444' },
  ];

  const chartData = isImprovement ? improvementChartData : correctiveChartData;

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-12 text-slate-400">
      <Clock className="animate-spin mb-4 text-slate-400" size={32} />
      <p>Cargando información en tiempo real...</p>
    </div>
  );

  return (
    <div className="space-y-8 font-sans">
      {/* Header & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2 text-slate-900">
            {isImprovement ? (
              <>
                <Sparkles className="text-emerald-500" size={26} />
                Gestión de Mejoras • Dashboard
              </>
            ) : (
              <>
                <ShieldAlert className="text-blue-500" size={26} />
                Gestión de Correctivas • Dashboard
              </>
            )}
          </h1>
          <p className="text-slate-500 mt-1">
            {isImprovement 
              ? 'Monitoreo de sugerencias de mejora y planes continuos.' 
              : 'Indicadores clave y estado del sistema de no conformidades del SGC.'}
          </p>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Company filter */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl">
            <Filter size={16} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase">Empresa:</span>
            <select 
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="bg-transparent border-none outline-none text-xs font-bold text-slate-700 pr-4 select-element"
            >
              {companiesList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* User filter */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl">
            <User size={16} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase">Asignado:</span>
            <select 
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="bg-transparent border-none outline-none text-xs font-bold text-slate-700 pr-4 select-element"
            >
              <option value="Todos">Todos</option>
              {usersList.map(u => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatCard 
          title={isImprovement ? "Total de Hallazgos" : "Total Hallazgos"} 
          value={totalFindings} 
          icon={<FileText className={isImprovement ? "text-emerald-600" : "text-blue-600"} />}
          color={isImprovement ? "emerald" : "blue"}
        />
        {isImprovement ? (
          <StatCard 
            title="Sugerencias Cargadas" 
            value={filteredActions.length} 
            icon={<CheckCircle2 className="text-emerald-600" />}
            color="emerald"
          />
        ) : (
          <StatCard 
            title="Inv. Vencidas" 
            value={overdueInvestigations} 
            icon={<AlertCircle className="text-red-600" />}
            color="red"
          />
        )}
        <StatCard 
          title="Acciones Vencidas" 
          value={overdueActionsCount} 
          icon={<AlertCircle className="text-red-600" />}
          color="red"
        />
        <StatCard 
          title="Próximos 30 días" 
          value={actionsDueSoonCount} 
          icon={<CalendarDays className="text-purple-600" />}
          color="purple"
        />
        <StatCard 
          title="Cerradas a tiempo" 
          value={`${closedOnTime} (${closedOnTimePercentage}%)`} 
          icon={<CheckCircle2 className="text-emerald-600" />}
          color="emerald"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Distribución por Etapas</h3>
          <div className="h-[300px] w-full min-h-[300px] relative">
            {isMounted && (
              <ResponsiveContainer width="100%" height={300} minWidth={0}>
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* List of Pending Tareas */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 mb-4">Mis Tareas Pendientes</h3>
            <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
              {filteredFindings
                .filter(f => f.pendingActionUserIds?.includes(user.id) && f.status !== FindingStatus.COMPLETED && f.status !== FindingStatus.CANCELLED && f.status !== FindingStatus.REJECTED)
                .map(f => (
                  <div 
                    key={f.id}
                    onClick={() => navigate(`/findings/${f.id}`)}
                    className="group flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-400">#{f.findingNumber}</span>
                      <span className="text-sm font-semibold text-slate-800 line-clamp-1 group-hover:text-blue-600 transition-colors">{f.description}</span>
                      <span className="text-[10px] text-slate-500 font-bold mt-0.5">{f.company} • {f.status}</span>
                    </div>
                    <ChevronRight size={16} className={`text-slate-300 transition-colors ${isImprovement ? 'group-hover:text-emerald-500' : 'group-hover:text-blue-500'}`} />
                  </div>
                ))}
              {filteredFindings.filter(f => f.pendingActionUserIds?.includes(user.id) && f.status !== FindingStatus.COMPLETED && f.status !== FindingStatus.CANCELLED && f.status !== FindingStatus.REJECTED).length === 0 && (
                <p className="text-sm text-slate-400 text-center py-12 italic">No tiene tareas pendientes en este módulo.</p>
              )}
            </div>
          </div>

          {/* Overdue Persons Panel (only if isImprovement & Admin or has entries) */}
          {isImprovement && groupedPeopleDueSoon.length > 0 && (
            <div className="border-t border-slate-100 pt-6 mt-6">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Personas con tareas próximas a vencer</h4>
              <div className="space-y-2">
                {groupedPeopleDueSoon.slice(0, 3).map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-purple-50 p-2 rounded-lg border border-purple-100">
                    <span className="text-xs font-semibold text-purple-900 line-clamp-1">{p.displayName}</span>
                    <span className="text-xs font-bold text-purple-700 bg-purple-200 px-2 py-0.5 rounded-full">{p.count} por vencer</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-800">
            {isImprovement ? 'Listado de Mejoras' : 'Listado de Hallazgos'}
          </h3>
          <button 
            onClick={() => navigate('/new')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${isImprovement ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
          >
            Registrar Nuevo
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-wider">
                <th className="px-6 py-4 font-semibold">Nº</th>
                <th className="px-6 py-4 font-semibold">Empresa</th>
                <th className="px-6 py-4 font-semibold">Fecha del desvío</th>
                <th className="px-6 py-4 font-semibold">Detalle del hallazgo</th>
                <th className="px-6 py-4 font-semibold">Dueño</th>
                <th className="px-6 py-4 font-semibold">Estado</th>
                <th className="px-6 py-4 font-semibold"></th>
              </tr>
              {/* Row with inputs for column filters */}
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-6 py-2">
                  <input
                    type="text"
                    value={colFilterNumber}
                    onChange={(e) => setColFilterNumber(e.target.value)}
                    placeholder="Filtrar..."
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-semibold text-slate-700 min-w-[70px]"
                  />
                </th>
                <th className="px-6 py-2">
                  <select
                    value={colFilterCompany}
                    onChange={(e) => setColFilterCompany(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-semibold text-slate-700 select-element min-w-[100px]"
                  >
                    <option value="Todas">Todas</option>
                    <option value="TMC">TMC</option>
                    <option value="Fertec">Fertec</option>
                    <option value="Metallo">Metallo</option>
                    <option value="Leaf">Leaf</option>
                    <option value="Fabril">Fabril</option>
                  </select>
                </th>
                <th className="px-6 py-2">
                  <input
                    type="text"
                    value={colFilterDate}
                    onChange={(e) => setColFilterDate(e.target.value)}
                    placeholder="Filtrar..."
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-semibold text-slate-700 min-w-[100px]"
                  />
                </th>
                <th className="px-6 py-2">
                  <input
                    type="text"
                    value={colFilterDescription}
                    onChange={(e) => setColFilterDescription(e.target.value)}
                    placeholder="Filtrar..."
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-semibold text-slate-700 min-w-[150px]"
                  />
                </th>
                <th className="px-6 py-2">
                  <input
                    type="text"
                    value={colFilterOwner}
                    onChange={(e) => setColFilterOwner(e.target.value)}
                    placeholder="Filtrar..."
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-semibold text-slate-700 min-w-[120px]"
                  />
                </th>
                <th className="px-6 py-2">
                  <select
                    value={colFilterStatus}
                    onChange={(e) => setColFilterStatus(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 font-semibold text-slate-700 select-element min-w-[120px]"
                  >
                    <option value="Todos">Todos</option>
                    <option value={FindingStatus.PENDING_ANALYSIS}>Pend. Análisis</option>
                    <option value={FindingStatus.PENDING_ACTION}>Pend. Acción</option>
                    <option value={FindingStatus.PENDING_VERIFICATION}>Pend. Verificación</option>
                    <option value={FindingStatus.COMPLETED}>Completado</option>
                    <option value={FindingStatus.CANCELLED}>Cancelado</option>
                    <option value={FindingStatus.REJECTED}>Rechazada</option>
                  </select>
                </th>
                <th className="px-6 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredFindings.map((f) => (
                <tr 
                  key={f.id} 
                  className="hover:bg-slate-50 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/findings/${f.id}`)}
                >
                  <td className={`px-6 py-4 text-sm font-bold ${isImprovement ? 'text-emerald-700' : 'text-blue-600'}`}>#{f.findingNumber}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-700">{f.company}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">
                    {f.findingDate ? format(toDateSafe(f.findingDate), 'dd/MM/yyyy') : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-800 max-w-xs truncate">{f.description}</td>
                  <td className="px-6 py-4 text-sm text-slate-400 font-mono truncate max-w-[120px]">{f.ownerEmail}</td>
                  <td className="px-6 py-4 text-sm">
                    <StatusBadge status={f.status} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <ChevronRight size={18} className={`text-slate-300 inline-block transition-transform group-hover:translate-x-1 ${isImprovement ? 'group-hover:text-emerald-600' : 'group-hover:text-blue-600'}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredFindings.length === 0 && (
            <div className="py-16 text-center text-slate-400 italic">No se encontraron registros en este módulo de gestión.</div>
          )}
        </div>
      </div>

      {/* Notifications Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-4"
      >
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 transition-colors cursor-pointer text-left focus:outline-none"
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-white border border-slate-200 ${isImprovement ? 'text-emerald-600' : 'text-blue-600'}`}>
              <Bell size={18} />
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-sm">Notificaciones Recientes (Bandeja Personal)</h4>
              <p className="text-xs text-slate-400">Ver últimas alertas y correos automáticos dirigidos a usted</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-500">
            <span className="text-xs font-bold font-mono bg-slate-200/60 px-2 py-0.5 rounded-md text-slate-600">
              {notifications.length} alertas
            </span>
            {showNotifications ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </button>

        {showNotifications && (
          <div className="mt-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200 italic">
                No hay notificaciones registradas para {user.email}.
              </div>
            ) : (
              <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                {notifications.map((notif) => (
                  <div key={notif.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 flex gap-4">
                    <div className={`p-2 rounded-full h-fit mt-1 ${isImprovement ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                      <Mail size={16} />
                    </div>
                    <div className="flex-grow">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sm text-slate-800">{notif.subject}</span>
                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase leading-none ${isImprovement ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                          {notif.type}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-2">{notif.body}</p>
                      {notif.error && (
                        <p className="text-xs text-red-500 mt-1 italic font-medium bg-red-50 border border-red-100 rounded px-2 py-1">
                          Err: {notif.error}
                        </p>
                      )}
                      <div className="mt-2 text-[10px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
                        <span>Enviado: {notif.createdAt ? format(toDateSafe(notif.createdAt), 'dd/MM/yyyy HH:mm') : 'Recién ahora'}</span>
                        <div className="flex items-center gap-1.5 font-mono">
                          {notif.via && (
                            <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[9px] font-bold uppercase">
                              {notif.via === 'simulation' ? 'SGC' : notif.via}
                            </span>
                          )}
                          {notif.status && (
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase leading-none ${
                              notif.status === 'sent' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                              notif.status === 'sending' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                              'bg-red-100 text-red-800 border border-red-200'
                            }`}>
                              {notif.status === 'sent' ? 'Enviado' : notif.status === 'sending' ? 'Enviando...' : 'Fallo'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: any; icon: React.ReactNode; color: string }) {
  // Safe rendering of colors
  const hoverStyles = {
    blue: 'hover:shadow-blue-500/5 hover:border-blue-300',
    emerald: 'hover:shadow-emerald-500/5 hover:border-emerald-300',
    red: 'hover:shadow-red-500/5 hover:border-red-300',
    purple: 'hover:shadow-purple-500/5 hover:border-purple-300',
  }[color] || 'hover:shadow-slate-500/5';

  const iconBg = {
    blue: 'bg-blue-50',
    emerald: 'bg-emerald-50',
    red: 'bg-red-50',
    purple: 'bg-purple-50',
  }[color] || 'bg-slate-50';

  return (
    <motion.div 
      whileHover={{ y: -4 }}
      className={`bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all flex flex-col justify-between h-36 ${hoverStyles}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className={`p-3 rounded-xl ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div>
        <div className="text-xl font-extrabold text-slate-850 tracking-tight">{value}</div>
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-1">{title}</h4>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: FindingStatus }) {
  const styles = {
    [FindingStatus.PENDING_ANALYSIS]: 'bg-amber-55 text-amber-700 bg-amber-50 border-amber-100',
    [FindingStatus.PENDING_ACTION]: 'bg-blue-55 text-blue-700 bg-blue-50 border-blue-100',
    [FindingStatus.PENDING_VERIFICATION]: 'bg-purple-55 text-purple-700 bg-purple-50 border-purple-100',
    [FindingStatus.COMPLETED]: 'bg-emerald-55 text-emerald-700 bg-emerald-50 border-emerald-100',
    [FindingStatus.CANCELLED]: 'bg-slate-55 text-slate-500 bg-slate-50 border-slate-200',
    [FindingStatus.REJECTED]: 'bg-red-55 text-red-700 bg-red-50 border-red-100',
  };

  const labels = {
    [FindingStatus.PENDING_ANALYSIS]: 'Pend. Análisis',
    [FindingStatus.PENDING_ACTION]: 'Pend. Acción',
    [FindingStatus.PENDING_VERIFICATION]: 'Pend. Verificación',
    [FindingStatus.COMPLETED]: 'Completado',
    [FindingStatus.CANCELLED]: 'Cancelado',
    [FindingStatus.REJECTED]: 'Rechazada',
  };

  return (
    <span className={`px-2.5 py-1 border rounded-lg text-xs font-bold whitespace-nowrap leading-none ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

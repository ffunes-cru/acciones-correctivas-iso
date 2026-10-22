import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, where, Timestamp, collectionGroup } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Finding, FindingStatus, CorrectiveAction, ActionStatus, UserProfile } from '../types';
import { format, isPast, differenceInDays, addDays, isAfter, startOfDay } from 'date-fns';
import { 
  FileText, 
  Download, 
  Clock, 
  AlertTriangle, 
  ChevronRight, 
  Copy, 
  CheckCircle,
  Calendar,
  User,
  Building2,
  FileSpreadsheet,
  CalendarDays,
  ExternalLink,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { getCachedToken, googleSignInForWorkspace } from '../lib/googleWorkspace';

const toDateSafe = (val: any): Date => {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

interface OverdueAnalysis {
  findingNumber: number;
  company: string;
  process: string;
  responsibleEmail: string;
  deadline: Date;
  daysOverdue: number;
  id: string;
}

interface OverdueAction {
  findingNumber: number;
  company: string;
  actionDescription: string;
  responsibleEmail: string;
  deadline: Date;
  daysOverdue: number;
  findingId: string;
}

interface UpcomingAction {
  findingNumber: number;
  company: string;
  actionDescription: string;
  responsibleEmail: string;
  deadline: Date;
  daysToDeadline: number;
  findingId: string;
}

interface PendingVerification {
  findingNumber: number;
  company: string;
  ownerEmail: string;
  updatedAt: Date;
  id: string;
}

export default function Reports({ user, category }: { user: UserProfile; category?: 'corrective' | 'improvement' | null }) {
  const [loading, setLoading] = useState(true);
  const [overdueAnalyses, setOverdueAnalyses] = useState<OverdueAnalysis[]>([]);
  const [overdueActions, setOverdueActions] = useState<OverdueAction[]>([]);
  const [upcomingActions, setUpcomingActions] = useState<UpcomingAction[]>([]);
  const [pendingVerifications, setPendingVerifications] = useState<PendingVerification[]>([]);
  
  const isImprovement = category === 'improvement';

  useEffect(() => {
    async function fetchReportData() {
      setLoading(true);
      try {
        // 1. Fetch Findings
        const findingsSnap = await getDocs(collection(db, 'findings'));
        let allFindings = findingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Finding));
        
        // Filter by category
        if (isImprovement) {
          allFindings = allFindings.filter(f => f.findingCategory === 'improvement');
        } else {
          allFindings = allFindings.filter(f => f.findingCategory !== 'improvement');
        }

        const findingMap = new Map(allFindings.map(f => [f.id, f]));

        const overdueA: OverdueAnalysis[] = [];
        const pendingV: PendingVerification[] = [];

        allFindings.forEach(f => {
          // Overdue Analysis
          if (f.status === FindingStatus.PENDING_ANALYSIS && f.analysisDeadline) {
            const deadlineDate = toDateSafe(f.analysisDeadline);
            const now = startOfDay(new Date());
            const target = startOfDay(deadlineDate);
            if (isPast(deadlineDate)) {
              overdueA.push({
                findingNumber: f.findingNumber,
                company: f.company,
                process: f.process,
                responsibleEmail: f.analysisResponsibleEmail || 'No asignado',
                deadline: deadlineDate,
                daysOverdue: Math.abs(differenceInDays(target, now)),
                id: f.id
              });
            }
          }
          
          // Pending Verification
          if (f.status === FindingStatus.PENDING_VERIFICATION) {
            pendingV.push({
              findingNumber: f.findingNumber,
              company: f.company,
              ownerEmail: f.ownerEmail,
              updatedAt: toDateSafe(f.updatedAt),
              id: f.id
            });
          }
        });

        // 2. Fetch Actions manually per finding in parallel (avoiding collectionGroup index issues & non-blocking!)
        const overdueAct: OverdueAction[] = [];
        const upcomingAct: UpcomingAction[] = [];
        const todayAtStart = startOfDay(new Date());

        const actionsPromises = allFindings.map(async (f) => {
          const actionsSnap = await getDocs(collection(db, 'findings', f.id, 'correctiveActions'));
          return {
            finding: f,
            actions: actionsSnap.docs.map(doc => ({ ...doc.data(), id: doc.id } as CorrectiveAction))
          };
        });
        
        const actionsResults = await Promise.all(actionsPromises);

        actionsResults.forEach(({ finding: f, actions }) => {
          actions.forEach(act => {
            if (act.status !== ActionStatus.PENDING || !act.deadline) return;

            const deadlineDate = toDateSafe(act.deadline);
            const targetAtStart = startOfDay(deadlineDate);
            const diff = differenceInDays(targetAtStart, todayAtStart);
            
            if (diff < 0) {
              overdueAct.push({
                findingNumber: f.findingNumber,
                company: f.company,
                actionDescription: act.description,
                responsibleEmail: act.responsibleEmail,
                deadline: deadlineDate,
                daysOverdue: Math.abs(diff),
                findingId: f.id
              });
            } else if (diff >= 0 && diff <= 30) {
              upcomingAct.push({
                findingNumber: f.findingNumber,
                company: f.company,
                actionDescription: act.description,
                responsibleEmail: act.responsibleEmail,
                deadline: deadlineDate,
                daysToDeadline: diff,
                findingId: f.id
              });
            }
          });
        });

        setOverdueAnalyses(overdueA.sort((a, b) => b.daysOverdue - a.daysOverdue));
        setOverdueActions(overdueAct.sort((a, b) => b.daysOverdue - a.daysOverdue));
        setUpcomingActions(upcomingAct.sort((a, b) => a.daysToDeadline - b.daysToDeadline));
        setPendingVerifications(pendingV.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
      } catch (error) {
        console.error("Error fetching report data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchReportData();
  }, []);

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();
    
    // Data for sheet 1: Analyses
    const analysesData = overdueAnalyses.map(a => ({
      'Nro Hallazgo': a.findingNumber,
      'Empresa': a.company,
      'Proceso': a.process,
      'Responsable': a.responsibleEmail,
      'Fecha Límite': format(a.deadline, 'dd/MM/yyyy'),
      'Días de Atraso': a.daysOverdue
    }));
    const ws1 = XLSX.utils.json_to_sheet(analysesData);
    XLSX.utils.book_append_sheet(wb, ws1, "Análisis Vencidos");

    // Data for sheet 2: Overdue Actions
    const actionsData = overdueActions.map(a => ({
      'Nro Hallazgo': a.findingNumber,
      'Empresa': a.company,
      'Descripción Acción': a.actionDescription,
      'Responsable': a.responsibleEmail,
      'Fecha Límite': format(a.deadline, 'dd/MM/yyyy'),
      'Días de Atraso': a.daysOverdue
    }));
    const ws2 = XLSX.utils.json_to_sheet(actionsData);
    XLSX.utils.book_append_sheet(wb, ws2, "Acciones Vencidas");

    // Data for sheet 3: Upcoming Actions
    const upcomingData = upcomingActions.map(a => ({
      'Nro Hallazgo': a.findingNumber,
      'Empresa': a.company,
      'Descripción Acción': a.actionDescription,
      'Responsable': a.responsibleEmail,
      'Fecha Límite': format(a.deadline, 'dd/MM/yyyy'),
      'Faltan Días': a.daysToDeadline
    }));
    const ws3 = XLSX.utils.json_to_sheet(upcomingData);
    XLSX.utils.book_append_sheet(wb, ws3, "Acciones a Vencer (30d)");

    // Data for sheet 4: Pending Verifications
    const pendingVData = pendingVerifications.map(p => ({
      'Nro Hallazgo': p.findingNumber,
      'Empresa': p.company,
      'Dueño (Verificador)': p.ownerEmail,
      'Pendiente desde': format(p.updatedAt, 'dd/MM/yyyy HH:mm')
    }));
    const ws4 = XLSX.utils.json_to_sheet(pendingVData);
    XLSX.utils.book_append_sheet(wb, ws4, "Pendientes Verificación");

    XLSX.writeFile(wb, `Reporte_Vencimientos_SGC_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const copyToClipboard = () => {
    let text = "REPORTE DE VENCIMIENTOS Y PRÓXIMOS - SGC\n";
    text += `Generado el: ${format(new Date(), 'dd/MM/yyyy HH:mm')}\n\n`;

    if (overdueAnalyses.length > 0) {
      text += "--- ANÁLISIS DE CAUSA VENCIDOS ---\n";
      overdueAnalyses.forEach(a => {
        text += `Hallazgo #${a.findingNumber} (${a.company}) - Responsable: ${a.responsibleEmail} - Venció: ${format(a.deadline, 'dd/MM/yyyy')} (${a.daysOverdue} días)\n`;
      });
      text += "\n";
    }

    if (overdueActions.length > 0) {
      text += "--- ACCIONES CORRECTIVAS VENCIDAS ---\n";
      overdueActions.forEach(a => {
        text += `Hallazgo #${a.findingNumber} (${a.company}) - Acción: ${a.actionDescription} - Responsable: ${a.responsibleEmail} - Venció: ${format(a.deadline, 'dd/MM/yyyy')} (${a.daysOverdue} días)\n`;
      });
      text += "\n";
    }

    if (upcomingActions.length > 0) {
      text += "--- ACCIONES A VENCER EN 30 DÍAS ---\n";
      upcomingActions.forEach(a => {
        text += `Hallazgo #${a.findingNumber} (${a.company}) - Acción: ${a.actionDescription} - Responsable: ${a.responsibleEmail} - Vence: ${format(a.deadline, 'dd/MM/yyyy')} (faltan ${a.daysToDeadline} días)\n`;
      });
      text += "\n";
    }

    if (pendingVerifications.length > 0) {
      text += "--- HALLAZGOS PENDIENTES DE VERIFICACIÓN ---\n";
      pendingVerifications.forEach(p => {
        text += `Hallazgo #${p.findingNumber} (${p.company}) - Verificador: ${p.ownerEmail} - Pendiente desde: ${format(p.updatedAt, 'dd/MM/yyyy')}\n`;
      });
    }

    if (overdueAnalyses.length === 0 && overdueActions.length === 0 && upcomingActions.length === 0 && pendingVerifications.length === 0) {
      text += "No se registran tareas pendientes de vencimiento inmediato.";
    }

    navigator.clipboard.writeText(text);
    alert('Reporte copiado al portapapeles. Ya puede pegarlo en su mail.');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <Clock className="animate-spin mb-4" size={32} />
        <p>Generando reporte en tiempo real...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="text-blue-500" size={28} />
            Monitor de Tareas y Vencimientos
          </h1>
          <p className="text-slate-500">Consolidado de tareas fuera de término y próximos vencimientos.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={copyToClipboard}
            className="flex items-center gap-2 bg-white text-slate-700 font-bold px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 transition-all shadow-sm cursor-pointer"
          >
            <Copy size={18} />
            Copiar para Mail
          </button>
          <button 
            onClick={downloadExcel}
            className="flex items-center gap-2 bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl hover:bg-emerald-700 transition-all shadow-sm cursor-pointer"
          >
            <FileSpreadsheet size={18} />
            Exportar Excel
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isImprovement ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-6`}>
        {!isImprovement && (
          <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 flex items-center gap-6">
            <div className="p-4 bg-amber-500 text-white rounded-2xl">
              <Clock size={32} />
            </div>
            <div>
              <div className="text-3xl font-black text-amber-900">{overdueAnalyses.length}</div>
              <div className="text-amber-800 text-sm font-medium">Análisis Vencidos</div>
            </div>
          </div>
        )}
        <div className="bg-rose-50 p-6 rounded-2xl border border-rose-100 flex items-center gap-6">
          <div className="p-4 bg-rose-500 text-white rounded-2xl">
            <AlertTriangle size={32} />
          </div>
          <div>
            <div className="text-3xl font-black text-rose-900">{overdueActions.length}</div>
            <div className="text-rose-800 text-sm font-medium">
              {isImprovement ? 'Mejoras Vencidas' : 'Acciones Vencidas'}
            </div>
          </div>
        </div>
        <div className="bg-purple-50 p-6 rounded-2xl border border-purple-100 flex items-center gap-6">
          <div className="p-4 bg-purple-500 text-white rounded-2xl">
            <CalendarDays size={32} />
          </div>
          <div>
            <div className="text-3xl font-black text-purple-900">{upcomingActions.length}</div>
            <div className="text-purple-800 text-sm font-medium">A vencer (30 días)</div>
          </div>
        </div>
        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-center gap-6">
          <div className="p-4 bg-blue-500 text-white rounded-2xl">
            <CheckCircle size={32} />
          </div>
          <div>
            <div className="text-3xl font-black text-blue-900">{pendingVerifications.length}</div>
            <div className="text-blue-800 text-sm font-medium">Pend. Verificación</div>
          </div>
        </div>
      </div>

      {/* Overdue Analyses Table */}
      {!isImprovement && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Clock size={18} className="text-amber-500" />
              Análisis de Causa Raíz Vencidos
            </h3>
            <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-1 rounded font-bold uppercase">
              Prioridad Alta
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
                  <th className="px-6 py-3 font-semibold">Hallazgo</th>
                  <th className="px-6 py-3 font-semibold">Empresa / Proceso</th>
                  <th className="px-6 py-3 font-semibold">Responsable</th>
                  <th className="px-6 py-3 font-semibold">Vencimiento</th>
                  <th className="px-6 py-3 font-semibold">Días</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {overdueAnalyses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                      ¡Excelente! No hay análisis de causa fuera de término.
                    </td>
                  </tr>
                ) : (
                  overdueAnalyses.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 font-bold text-blue-600">
                        #{a.findingNumber}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-800">{a.company}</div>
                        <div className="text-[10px] text-slate-400 uppercase">{a.process}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {a.responsibleEmail}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {format(a.deadline, 'dd/MM/yyyy')}
                      </td>
                      <td className="px-6 py-4">
                        <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded-full">
                          +{a.daysOverdue} d
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Overdue Actions Table */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-500" />
            {isImprovement ? 'Acciones de Mejora Vencidas' : 'Acciones Correctivas Vencidas'}
          </h3>
          <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-1 rounded font-bold uppercase">
            Incumplimiento
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold">Hallazgo</th>
                <th className="px-6 py-3 font-semibold">Acción Correctiva</th>
                <th className="px-6 py-3 font-semibold">Responsable</th>
                <th className="px-6 py-3 font-semibold">Vencimiento</th>
                <th className="px-6 py-3 font-semibold">Atraso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {overdueActions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                    No hay acciones correctivas pendientes de vencimiento.
                  </td>
                </tr>
              ) : (
                overdueActions.map((a, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4 font-bold text-blue-600">
                      #{a.findingNumber}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-800 line-clamp-1">{a.company}</div>
                      <p className="text-xs text-slate-500 italic mt-1 line-clamp-2">"{a.actionDescription}"</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {a.responsibleEmail}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {format(a.deadline, 'dd/MM/yyyy')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-rose-100 text-rose-700 text-xs font-bold px-2 py-1 rounded-full">
                        +{a.daysOverdue} d
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Upcoming Actions Table */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <CalendarDays size={18} className="text-purple-500" />
            Acciones a Vencer (Próximos 30 días)
          </h3>
          <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-1 rounded font-bold uppercase">
            Preventivo
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold">Hallazgo</th>
                <th className="px-6 py-3 font-semibold">Acción Correctiva</th>
                <th className="px-6 py-3 font-semibold">Responsable</th>
                <th className="px-6 py-3 font-semibold">Vencimiento</th>
                <th className="px-6 py-3 font-semibold">Faltan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {upcomingActions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                    No se registran acciones con vencimiento próximo en 30 días.
                  </td>
                </tr>
              ) : (
                upcomingActions.map((a, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4 font-bold text-blue-600">
                      #{a.findingNumber}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-800 line-clamp-1">{a.company}</div>
                      <p className="text-xs text-slate-500 italic mt-1 line-clamp-2">"{a.actionDescription}"</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {a.responsibleEmail}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 border-l border-slate-50">
                      {format(a.deadline, 'dd/MM/yyyy')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-1 rounded-full">
                        {a.daysToDeadline} d
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending Verifications Table */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <CheckCircle size={18} className="text-blue-500" />
            Hallazgos Pendientes de Verificación de Eficacia
          </h3>
          <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-1 rounded font-bold uppercase">
            Cierre de Ciclo
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wider">
                <th className="px-6 py-3 font-semibold">Hallazgo</th>
                <th className="px-6 py-3 font-semibold">Empresa / Detalle</th>
                <th className="px-6 py-3 font-semibold">Verificador (Dueño)</th>
                <th className="px-6 py-3 font-semibold">Pendiente Desde</th>
                <th className="px-6 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pendingVerifications.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                    No hay hallazgos pendientes de verificación final.
                  </td>
                </tr>
              ) : (
                pendingVerifications.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4 font-bold text-blue-600">
                      #{p.findingNumber}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-800">{p.company}</div>
                      <div className="text-[10px] text-slate-400 uppercase">Listo para verificar</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {p.ownerEmail}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {format(p.updatedAt, 'dd/MM/yyyy')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-1 rounded-full">
                        Pendiente
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="bg-slate-100 p-6 rounded-2xl text-center">
        <p className="text-sm text-slate-500">
          Usted puede usar el botón <strong>"Copiar para Mail"</strong> para obtener un resumen textual limpio que puede pegar directamente en Outlook o Gmail para realizar reclamos grupales.
        </p>
      </div>
    </div>
  );
}

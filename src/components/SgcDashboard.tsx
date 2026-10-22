import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, UserRole, Finding, CorrectiveAction, ISOCalendar, ISOTask, ChangeRequest, SpecialRelease } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { motion, AnimatePresence } from 'motion/react';
import { 
  CalendarDays, ShieldAlert, Sparkles, RefreshCw, ShieldCheck, 
  AlertCircle, CheckCircle2, Clock, Printer, Download, 
  ChevronDown, ChevronUp, FileText, Building2, Calendar, 
  Users, ArrowLeftRight, TrendingUp, AlertTriangle, BadgeCheck
} from 'lucide-react';
import { jsPDF } from 'jspdf';

// Helper to convert Firestore dates to safe JS Date
const toDateSafe = (val: any): Date | null => {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Interface for unified overdue item
interface OverdueItem {
  id: string;
  module: 'AC' | 'AM' | 'ISO' | 'GC';
  typeLabel: string;
  description: string;
  responsibleName: string;
  responsibleEmail: string;
  deadline: Date;
  daysOverdue: number;
  sourceId: string; // ID of the parent Finding, Calendar, or CR
}

export function SgcDashboard({ user }: { user: UserProfile }) {
  const [selectedCompany, setSelectedCompany] = useState<string>('TMC');
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1); // 1-indexed

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Raw fetched data
  const [findings, setFindings] = useState<Finding[]>([]);
  const [allActions, setAllActions] = useState<CorrectiveAction[]>([]);
  const [calendars, setCalendars] = useState<ISOCalendar[]>([]);
  const [calendarTasks, setCalendarTasks] = useState<ISOTask[]>([]);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [specialReleases, setSpecialReleases] = useState<SpecialRelease[]>([]);

  // Calculated metrics
  const [metrics, setMetrics] = useState({
    acTotal: 0,
    acOverdue: 0,
    acCompliance: 100,
    acScore: 30,

    amTotal: 0,
    amOverdue: 0,
    amCompliance: 100,
    amScore: 20,

    isoTotal: 0,
    isoOverdue: 0,
    isoCompliance: 100,
    isoScore: 30,

    gcTotal: 0,
    gcOverdue: 0,
    gcCompliance: 100,
    gcScore: 20,

    leCount: 0,
    lePenalty: 0,

    finalScore: 100
  });

  const [overdueItemsList, setOverdueItemsList] = useState<OverdueItem[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    ac: false,
    am: false,
    iso: false,
    gc: false,
    le: false
  });

  const companiesList = ['TMC', 'Fertec', 'Fabril', 'Leaf', 'Metallo'];
  const monthsList = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' }
  ];

  const yearsList = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  // Toggle accordion sections
  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Fetch all SGC data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch Findings (Corrective and Improvement)
        const findingsSnap = await getDocs(collection(db, 'findings'));
        const findingsList = findingsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Finding));
        setFindings(findingsList);

        // Fetch subcollection CorrectiveActions for all findings in parallel
        const actionsPromises = findingsList.map(async (f) => {
          const actionsSnap = await getDocs(collection(db, 'findings', f.id, 'correctiveActions'));
          return actionsSnap.docs.map(doc => ({
            id: doc.id,
            findingId: f.id,
            ...doc.data()
          } as CorrectiveAction));
        });
        const actionsResults = await Promise.all(actionsPromises);
        setAllActions(actionsResults.flat());

        // 2. Fetch ISO Calendars and their tasks
        const calendarsSnap = await getDocs(collection(db, 'iso_calendars'));
        const calendarsList = calendarsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as ISOCalendar));
        setCalendars(calendarsList);

        const calendarTasksPromises = calendarsList.map(async (cal) => {
          const tasksSnap = await getDocs(collection(db, 'iso_calendars', cal.id, 'tasks'));
          return tasksSnap.docs.map(doc => ({
            id: doc.id,
            calendarId: cal.id,
            ...doc.data()
          } as any));
        });
        const calendarTasksResults = await Promise.all(calendarTasksPromises);
        setCalendarTasks(calendarTasksResults.flat());

        // 3. Fetch Change Requests
        const crSnap = await getDocs(collection(db, 'change_requests'));
        const crList = crSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as ChangeRequest));
        setChangeRequests(crList);

        // 4. Fetch Special Releases
        const srSnap = await getDocs(collection(db, 'special_releases'));
        const srList = srSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as SpecialRelease));
        setSpecialReleases(srList);

      } catch (err) {
        console.error('Error loading SGC Dashboard data:', err);
        setError('Ocurrió un error al cargar la información del SGC desde la base de datos.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Re-calculate metrics whenever filters or raw data change
  useEffect(() => {
    if (loading || error) return;

    // Define end of the selected report month/year
    const reportDateEnd = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999);
    const today = new Date();
    const evaluationDate = reportDateEnd < today ? reportDateEnd : today;

    const overdueList: OverdueItem[] = [];

    // --- 1. ACCIONES CORRECTIVAS (AC) ---
    // Total open/due findings (investigations) and corrective actions
    let acTotal = 0;
    let acOverdue = 0;

    // Filter corrective findings for the company
    const compCorrectiveFindings = findings.filter(f => 
      f.company === selectedCompany && f.findingCategory !== 'improvement'
    );

    compCorrectiveFindings.forEach(f => {
      // Cause Analysis phase
      if (f.analysisDeadline) {
        const dLine = toDateSafe(f.analysisDeadline);
        if (dLine && dLine <= evaluationDate) {
          acTotal += 1;
          const isPendingAnalysis = f.status === 'pending_analysis' || 
                                    f.status === 'Análisis Pendiente' || 
                                    f.status === 'Pendiente de Análisis';
          
          if (isPendingAnalysis) {
            acOverdue += 1;
            const diffMs = evaluationDate.getTime() - dLine.getTime();
            const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
            overdueList.push({
              id: `f_investigation_${f.id}`,
              module: 'AC',
              typeLabel: 'Investigación de Causa',
              description: `Análisis pendiente para Hallazgo #${f.findingNumber}: ${f.description}`,
              responsibleName: f.analysisResponsibleId ? 'Responsable Asignado' : 'Creador de Hallazgo',
              responsibleEmail: f.analysisResponsibleEmail || f.ownerEmail || '',
              deadline: dLine,
              daysOverdue: days,
              sourceId: f.id
            });
          }
        }
      }

      // Actions under this corrective finding
      const actionsForFinding = allActions.filter(a => a.findingId === f.id);
      actionsForFinding.forEach(a => {
        if (a.deadline) {
          const dLine = toDateSafe(a.deadline);
          if (dLine && dLine <= evaluationDate) {
            acTotal += 1;
            const isPendingAction = a.status === 'pending' || a.status === 'Pendiente';
            if (isPendingAction) {
              acOverdue += 1;
              const diffMs = evaluationDate.getTime() - dLine.getTime();
              const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              overdueList.push({
                id: `act_${a.id}`,
                module: 'AC',
                typeLabel: 'Acción Correctiva',
                description: `AC vinculada a Hallazgo #${f.findingNumber}: ${a.description}`,
                responsibleName: a.responsibleId ? 'Responsable' : 'Sin asignar',
                responsibleEmail: a.responsibleEmail || '',
                deadline: dLine,
                daysOverdue: days,
                sourceId: f.id
              });
            }
          }
        }
      });
    });

    const acCompliance = acTotal > 0 ? ((acTotal - acOverdue) / acTotal) * 100 : 100;
    const acScore = 30 * (acCompliance / 100);

    // --- 2. ACCIONES DE MEJORA (AM) ---
    let amTotal = 0;
    let amOverdue = 0;

    // Filter improvement findings for the company
    const compImprovementFindings = findings.filter(f => 
      f.company === selectedCompany && f.findingCategory === 'improvement'
    );

    compImprovementFindings.forEach(f => {
      // Actions under this improvement finding
      const actionsForFinding = allActions.filter(a => a.findingId === f.id);
      actionsForFinding.forEach(a => {
        if (a.deadline) {
          const dLine = toDateSafe(a.deadline);
          if (dLine && dLine <= evaluationDate) {
            amTotal += 1;
            const isPendingAction = a.status === 'pending' || a.status === 'Pendiente';
            if (isPendingAction) {
              amOverdue += 1;
              const diffMs = evaluationDate.getTime() - dLine.getTime();
              const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              overdueList.push({
                id: `act_am_${a.id}`,
                module: 'AM',
                typeLabel: 'Plan de Mejora',
                description: `Acción vinculada a Mejora #${f.findingNumber}: ${a.description}`,
                responsibleName: a.responsibleId ? 'Responsable' : 'Sin asignar',
                responsibleEmail: a.responsibleEmail || '',
                deadline: dLine,
                daysOverdue: days,
                sourceId: f.id
              });
            }
          }
        }
      });
    });

    const amCompliance = amTotal > 0 ? ((amTotal - amOverdue) / amTotal) * 100 : 100;
    const amScore = 20 * (amCompliance / 100);

    // --- 3. CALENDARIO ISO (ISO) ---
    let isoTotal = 0;
    let isoOverdue = 0;

    // Find the ISO calendar for the selected company and selected year
    const activeCalendar = calendars.find(cal => 
      cal.company === selectedCompany && cal.year === selectedYear
    );

    if (activeCalendar) {
      const tasksForCalendar = calendarTasks.filter(t => t.calendarId === activeCalendar.id);
      tasksForCalendar.forEach(t => {
        if (t.deadline) {
          const dLine = toDateSafe(t.deadline);
          if (dLine && dLine <= evaluationDate) {
            isoTotal += 1;
            const isNotCompleted = t.status !== 'Completado' && t.status !== 'Completed' && t.status !== 'finalizado';
            if (isNotCompleted) {
              isoOverdue += 1;
              const diffMs = evaluationDate.getTime() - dLine.getTime();
              const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              overdueList.push({
                id: `iso_task_${t.id}`,
                module: 'ISO',
                typeLabel: 'Tarea ISO',
                description: `${t.taskType === 'audit' ? 'Auditoría' : 'Actividad SGC'}: ${t.taskName || t.name}`,
                responsibleName: t.responsibleName || 'Responsable',
                responsibleEmail: t.responsibleEmail || '',
                deadline: dLine,
                daysOverdue: days,
                sourceId: activeCalendar.id
              });
            }
          }
        }
      });
    }

    const isoCompliance = isoTotal > 0 ? ((isoTotal - isoOverdue) / isoTotal) * 100 : 100;
    const isoScore = 30 * (isoCompliance / 100);

    // --- 4. GESTIÓN DEL CAMBIO (GC) ---
    let gcTotal = 0;
    let gcOverdue = 0;

    // Filter change requests for company
    const compChangeRequests = changeRequests.filter(r => r.company === selectedCompany);
    compChangeRequests.forEach(cr => {
      // 1. Check individual area reviews
      if (cr.reviews) {
        Object.entries(cr.reviews).forEach(([areaKey, review]) => {
          const rVal = review as any;
          if (rVal && rVal.applies && rVal.deadline) {
            const dLine = toDateSafe(rVal.deadline);
            if (dLine && dLine <= evaluationDate) {
              gcTotal += 1;
              const isPending = rVal.status === 'pending';
              if (isPending) {
                gcOverdue += 1;
                const diffMs = evaluationDate.getTime() - dLine.getTime();
                const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
                
                // Format area label elegantly
                const areaLabel = areaKey
                  .replace(/([A-Z])/g, ' $1')
                  .replace(/^./, str => str.toUpperCase())
                  .trim();

                overdueList.push({
                  id: `cr_review_${cr.id}_${areaKey}`,
                  module: 'GC',
                  typeLabel: `Revisión ${areaLabel}`,
                  description: `Evaluación de área pendiente para PROPUESTA #${cr.changeNumber}: ${cr.title}`,
                  responsibleName: rVal.responsibleName || 'Responsable de Área',
                  responsibleEmail: rVal.responsibleEmail || '',
                  deadline: dLine,
                  daysOverdue: days,
                  sourceId: cr.id
                });
              }
            }
          }
        });
      }

      // 2. Check final approval
      if (cr.finalApprovalDeadline) {
        const dLine = toDateSafe(cr.finalApprovalDeadline);
        if (dLine && dLine <= evaluationDate) {
          gcTotal += 1;
          const isPendingApproval = cr.finalApprovalStatus === 'pending';
          if (isPendingApproval) {
            gcOverdue += 1;
            const diffMs = evaluationDate.getTime() - dLine.getTime();
            const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
            overdueList.push({
              id: `cr_final_${cr.id}`,
              module: 'GC',
              typeLabel: 'Aprobación Final',
              description: `Aprobación final de Dirección pendiente para PROPUESTA #${cr.changeNumber}: ${cr.title}`,
              responsibleName: cr.finalApproverName || 'Aprobador Final',
              responsibleEmail: cr.finalApproverEmail || '',
              deadline: dLine,
              daysOverdue: days,
              sourceId: cr.id
            });
          }
        }
      }
    });

    const gcCompliance = gcTotal > 0 ? ((gcTotal - gcOverdue) / gcTotal) * 100 : 100;
    const gcScore = 20 * (gcCompliance / 100);

    // --- 5. LIBERACIÓN ESPECIAL (LE - PENALTY) ---
    // Solamente las liberaciones especiales hechas en el mes del reporte
    const compMonthSpecialReleases = specialReleases.filter(sr => {
      if (sr.company !== selectedCompany) return false;
      const srDate = toDateSafe(sr.date) || toDateSafe(sr.createdAt);
      if (!srDate) return false;
      return srDate.getFullYear() === selectedYear && (srDate.getMonth() + 1) === selectedMonth;
    });

    const leCount = compMonthSpecialReleases.length;
    let lePenalty = 0;
    if (leCount === 1) lePenalty = 20;
    else if (leCount === 2) lePenalty = 30;
    else if (leCount >= 3) lePenalty = 35;

    // --- FINAL HEALTH SCORE ---
    let finalScore = acScore + amScore + isoScore + gcScore - lePenalty;
    if (finalScore < 0) finalScore = 0;
    if (finalScore > 100) finalScore = 100;

    setMetrics({
      acTotal,
      acOverdue,
      acCompliance,
      acScore,

      amTotal,
      amOverdue,
      amCompliance,
      amScore,

      isoTotal,
      isoOverdue,
      isoCompliance,
      isoScore,

      gcTotal,
      gcOverdue,
      gcCompliance,
      gcScore,

      leCount,
      lePenalty,

      finalScore: Math.round(finalScore * 10) / 10
    });

    setOverdueItemsList(overdueList);

  }, [selectedCompany, selectedYear, selectedMonth, findings, allActions, calendars, calendarTasks, changeRequests, specialReleases, loading, error]);

  // Export to PDF function
  const handleExportPDF = () => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const primaryColor = [79, 70, 229]; // Indigo [R, G, B]
    const neutralDark = [30, 41, 59]; // Slate-800
    const accentRed = [239, 68, 68]; // Red-500

    // Frame Border
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.rect(12, 12, 186, 273);

    // --- Header Block ---
    doc.setFillColor(248, 250, 252);
    doc.rect(12, 12, 186, 28, 'F');
    doc.line(12, 40, 198, 40);
    doc.line(65, 12, 65, 40);
    doc.line(148, 12, 148, 40);

    // Left Column: Logo Text
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('SGC PORTAL', 20, 24);
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`EMPRESA: ${selectedCompany}`, 20, 31);

    // Center Column: Document Title
    doc.setTextColor(neutralDark[0], neutralDark[1], neutralDark[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text('REPORTE MENSUAL DE SALUD SGC', 69, 23);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Período Evaluado: ${monthsList.find(m => m.value === selectedMonth)?.label} de ${selectedYear}`, 69, 29);

    // Right Column: Form Metadatos
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(7.5);
    doc.text(`Emisión: ${new Date().toLocaleDateString('es-AR')}`, 152, 21);
    doc.text(`Generador: ${user.displayName}`, 152, 26);
    doc.text('Estado del SGC: Oficial', 152, 31);

    // --- Score Summary Banner ---
    let y = 48;
    const bannerHeight = 44; // Made taller to perfectly contain the speedometer drawing
    doc.setFillColor(248, 250, 252);
    doc.rect(16, y, 178, bannerHeight, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(16, y, 178, bannerHeight);

    // Helper to generate speedometer canvas as image data
    const generateSpeedometerImage = (score: number): string => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      // High quality scaling & clear
      ctx.clearRect(0, 0, 400, 240);

      // Center and Radius of gauge
      const cx = 200;
      const cy = 175;
      const r = 125;
      const strokeWidth = 20;

      // 1. Draw Semicircle Track Background
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
      ctx.strokeStyle = '#f1f5f9';
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 2. Draw Active Semicircle Arc (Progress)
      if (score > 0) {
        ctx.beginPath();
        const startAngle = Math.PI;
        const endAngle = Math.PI + (score / 100) * Math.PI;
        ctx.arc(cx, cy, r, startAngle, endAngle);
        
        // Gradient for stroke (Horizontal)
        const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
        grad.addColorStop(0, '#ef4444');   // Red
        grad.addColorStop(0.5, '#f59e0b'); // Yellow/Orange
        grad.addColorStop(1, '#10b981');   // Green
        
        ctx.strokeStyle = grad;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // 3. Draw Aesthetic Tick Marks and Labels
      const ticks = [0, 25, 50, 75, 100];
      ticks.forEach((t) => {
        const tickAngle = Math.PI + (t / 100) * Math.PI;
        const x1 = cx + (r - 16) * Math.cos(tickAngle);
        const y1 = cy + (r - 16) * Math.sin(tickAngle);
        const x2 = cx + (r - 24) * Math.cos(tickAngle);
        const y2 = cy + (r - 24) * Math.sin(tickAngle);
        
        // Draw tick line
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Draw label
        const lx = cx + (r + 18) * Math.cos(tickAngle);
        const ly = cy + (r + 18) * Math.sin(tickAngle);
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${t}%`, lx, ly);
      });

      // 4. Draw Needle
      const needleAngle = Math.PI + (score / 100) * Math.PI;
      const needleLen = 105;
      const midLen = needleLen * 0.72;
      
      const midX = cx + midLen * Math.cos(needleAngle);
      const midY = cy + midLen * Math.sin(needleAngle);
      const needleX = cx + needleLen * Math.cos(needleAngle);
      const needleY = cy + needleLen * Math.sin(needleAngle);

      // Main shaft
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(midX, midY);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.stroke();

      // High-visibility active red tip
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(needleX, needleY);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 5. Elegant Pivot Cap
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, 2 * Math.PI);
      ctx.fillStyle = '#1e293b';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ef4444';
      ctx.fill();

      // 6. Draw Big Bold Score Underneath
      ctx.font = '900 38px sans-serif';
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${score}%`, cx, cy + 15);

      return canvas.toDataURL('image/png');
    };

    // Draw Speedometer inside the PDF
    const speedometerImgData = generateSpeedometerImage(metrics.finalScore);
    if (speedometerImgData) {
      // Placing speedometer on the left side of the banner card
      // Width: 60mm, Height: 36mm (approx 1.66 aspect ratio)
      doc.addImage(speedometerImgData, 'PNG', 20, y + 4, 60, 36);
    }

    // Label Details on the right side
    const detailsX = 86;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(neutralDark[0], neutralDark[1], neutralDark[2]);
    doc.text('INDICE DE SALUD DEL SISTEMA (HEALTH INDEX)', detailsX, y + 10);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Calculado en base a vencimientos acumulados y penalizaciones por desvíos.', detailsX, y + 15);

    // Rating Badge Drawing
    const isExcellent = metrics.finalScore >= 80;
    const isAcceptable = metrics.finalScore >= 60 && metrics.finalScore < 80;
    const ratingLabel = isExcellent ? 'EXCELENTE' : (isAcceptable ? 'ACEPTABLE' : 'CRÍTICO');
    const badgeBgColor = isExcellent ? [209, 250, 229] : (isAcceptable ? [254, 243, 199] : [254, 226, 226]); // emerald-100, amber-100, red-100
    const badgeTextColor = isExcellent ? [5, 150, 105] : (isAcceptable ? [217, 119, 6] : [220, 38, 38]); // emerald-600, amber-600, red-600

    doc.setFillColor(badgeBgColor[0], badgeBgColor[1], badgeBgColor[2]);
    
    // Draw rounded-like badge background manually
    const badgeX = detailsX;
    const badgeY = y + 19;
    const badgeW = 46;
    const badgeH = 6;
    doc.rect(badgeX, badgeY, badgeW, badgeH, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(badgeTextColor[0], badgeTextColor[1], badgeTextColor[2]);
    doc.text(`RATING: ${ratingLabel}`, badgeX + 3, badgeY + 4.2);

    // Extra description
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`Puntaje obtenido: ${metrics.finalScore}% sobre 100% posible.`, detailsX, y + 31);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Desvíos detectados penalizan la salud general del SGC de forma directa.`, detailsX, y + 36);

    // --- Modules Table ---
    y += (bannerHeight + 10); // Spacing adjusted since the banner is taller
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(neutralDark[0], neutralDark[1], neutralDark[2]);
    doc.text('1. Desglose de Puntos y Cumplimiento de Módulos', 16, y);

    y += 4;
    // Table Headers
    doc.setFillColor(79, 70, 229); // Indigo Header
    doc.rect(16, y, 178, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    doc.text('Módulo de SGC', 19, y + 5);
    doc.text('Peso Máx', 82, y + 5);
    doc.text('Cumplimiento', 105, y + 5);
    doc.text('Puntos Obtenidos', 140, y + 5);
    doc.text('Tareas Vencidas', 170, y + 5);

    // Module Rows helper
    const moduleRows = [
      { name: 'Acciones Correctivas (Investigaciones + AC)', max: '30 pts', comp: `${Math.round(metrics.acCompliance)}%`, score: `${Math.round(metrics.acScore * 10) / 10} pts`, overdue: `${metrics.acOverdue} venc.` },
      { name: 'Planificación Anual ISO (Auditorías + SGC)', max: '30 pts', comp: `${Math.round(metrics.isoCompliance)}%`, score: `${Math.round(metrics.isoScore * 10) / 10} pts`, overdue: `${metrics.isoOverdue} venc.` },
      { name: 'Acciones de Mejora (Planes continuos)', max: '20 pts', comp: `${Math.round(metrics.amCompliance)}%`, score: `${Math.round(metrics.amScore * 10) / 10} pts`, overdue: `${metrics.amOverdue} venc.` },
      { name: 'Gestión de Cambios (Revisiones + Firmas)', max: '20 pts', comp: `${Math.round(metrics.gcCompliance)}%`, score: `${Math.round(metrics.gcScore * 10) / 10} pts`, overdue: `${metrics.gcOverdue} venc.` },
      { name: 'Liberaciones Especiales (Penalidad)', max: 'Restar', comp: '-', score: `-${metrics.lePenalty} pts`, overdue: `${metrics.leCount} hechas` }
    ];

    doc.setTextColor(51, 65, 85);
    doc.setFont('helvetica', 'normal');
    
    let currentY = y + 7;
    moduleRows.forEach((row, idx) => {
      // Alternating backgrounds
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(16, currentY, 178, 8, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(16, currentY, 178, 8);

      doc.text(row.name, 19, currentY + 5.5);
      doc.text(row.max, 82, currentY + 5.5);
      doc.text(row.comp, 105, currentY + 5.5);
      doc.text(row.score, 140, currentY + 5.5);
      
      // Overdue column highlight red if > 0
      const hasOverdue = row.overdue !== '0 venc.' && row.overdue !== '-' && !row.name.includes('Penalidad');
      if (hasOverdue) {
        doc.setTextColor(accentRed[0], accentRed[1], accentRed[2]);
        doc.setFont('helvetica', 'bold');
      }
      doc.text(row.overdue, 170, currentY + 5.5);
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'normal');

      currentY += 8;
    });

    // Add Appendix for Overdue Items
    currentY += 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(neutralDark[0], neutralDark[1], neutralDark[2]);
    doc.text('2. Anexo: Detalle de Ítems Pendientes y Vencidos', 16, currentY);

    currentY += 5;
    if (overdueItemsList.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(16, 185, 129); // Green
      doc.text('¡Excelente! No se encontraron tareas o revisiones vencidas para los módulos analizados.', 19, currentY + 4);
    } else {
      // Headers for Overdue Appendix
      doc.setFillColor(15, 23, 42); // Black Slate
      doc.rect(16, currentY, 178, 7, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.text('Módulo', 18, currentY + 4.5);
      doc.text('Descripción / Detalle del desvío', 45, currentY + 4.5);
      doc.text('Plazo Límite', 132, currentY + 4.5);
      doc.text('Responsable', 156, currentY + 4.5);
      doc.text('Vencido', 191, currentY + 4.5, { align: 'right' });

      currentY += 7;
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'normal');

      // Slice to avoid exceeding 1 page, or create page break if too many
      overdueItemsList.forEach((item, index) => {
        if (currentY > 265) {
          doc.addPage();
          // Draw border on new page
          doc.setDrawColor(226, 232, 240);
          doc.rect(12, 12, 186, 273);
          currentY = 20;

          // Redraw headers on new page
          doc.setFillColor(15, 23, 42);
          doc.rect(16, currentY, 178, 7, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.text('Módulo', 18, currentY + 4.5);
          doc.text('Descripción / Detalle del desvío', 45, currentY + 4.5);
          doc.text('Plazo Límite', 132, currentY + 4.5);
          doc.text('Responsable', 156, currentY + 4.5);
          doc.text('Vencido', 191, currentY + 4.5, { align: 'right' });
          currentY += 7;
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(51, 65, 85);
        }

        // Alternating row background
        if (index % 2 === 0) {
          doc.setFillColor(254, 242, 242); // Soft Red for overdue rows
          doc.rect(16, currentY, 178, 7.5, 'F');
        }
        doc.setDrawColor(226, 232, 240);
        doc.rect(16, currentY, 178, 7.5);

        doc.setFont('helvetica', 'bold');
        doc.text(item.module, 18, currentY + 4.5);
        doc.setFont('helvetica', 'normal');
        
        // Truncate/Clean long descriptions - only keep traceability part (prefix before ':') for AC, AM, GC
        let displayDesc = item.description;
        if (item.module === 'AC' || item.module === 'AM' || item.module === 'GC') {
          if (displayDesc.includes(': ')) {
            displayDesc = displayDesc.split(': ')[0];
          }
        }
        const cleanDesc = displayDesc.length > 70 ? displayDesc.substring(0, 67) + '...' : displayDesc;
        doc.text(cleanDesc, 45, currentY + 4.5);
        
        doc.text(item.deadline.toLocaleDateString('es-AR'), 132, currentY + 4.5);
        
        const shortEmail = item.responsibleEmail ? item.responsibleEmail.split('@')[0] : 'Sin asignar';
        doc.text(shortEmail, 156, currentY + 4.5);
        
        doc.setTextColor(accentRed[0], accentRed[1], accentRed[2]);
        doc.setFont('helvetica', 'bold');
        doc.text(`${item.daysOverdue} d.`, 191, currentY + 4.5, { align: 'right' });
        doc.setTextColor(51, 65, 85);
        doc.setFont('helvetica', 'normal');

        currentY += 7.5;
      });
    }

    // Save Doc
    doc.save(`SGC-Salud-${selectedCompany}-${selectedYear}-${selectedMonth}.pdf`);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400 font-sans" id="sgc-loading">
        <Clock className="animate-spin mb-4 text-indigo-600" size={36} />
        <p className="text-sm font-semibold text-slate-600">Calculando indicadores mensuales de salud...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl max-w-2xl mx-auto my-8 flex items-start gap-3" id="sgc-error">
        <AlertCircle size={24} className="shrink-0 text-red-500 mt-0.5" />
        <div>
          <h3 className="font-bold text-lg">Error del Sistema</h3>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  // Determine health description
  const getHealthStatus = (score: number) => {
    if (score >= 85) return { label: 'Sobresaliente', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', desc: 'Sistema altamente controlado y al día.' };
    if (score >= 70) return { label: 'Conforme', color: 'text-sky-600 bg-sky-50 border-sky-200', desc: 'Sistema con desvíos menores tolerables.' };
    if (score >= 50) return { label: 'Alerta Media', color: 'text-amber-600 bg-amber-50 border-amber-200', desc: 'Requiere atención en tareas vencidas.' };
    return { label: 'Crítico', color: 'text-rose-600 bg-rose-50 border-rose-200', desc: 'Riesgo inminente de no conformidad del SGC.' };
  };

  const health = getHealthStatus(metrics.finalScore);

  // Speedometer path parameters
  const angle = (metrics.finalScore / 100) * 180; // 0 to 180 degrees
  const radians = (angle - 180) * (Math.PI / 180);
  const needleLen = 48;
  const needleX = 80 + needleLen * Math.cos(radians);
  const needleY = 80 + needleLen * Math.sin(radians);
  const midLen = needleLen * 0.7;
  const midX = 80 + midLen * Math.cos(radians);
  const midY = 80 + midLen * Math.sin(radians);

  return (
    <div className="space-y-8 font-sans animate-fade-in" id="sgc-dashboard-root">
      {/* Header Panel */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6" id="sgc-dashboard-header">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-2xl">
              <TrendingUp size={24} />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">SGC Salud y Velocímetro General</h1>
          </div>
          <p className="text-slate-500 text-xs">Monitoreo unificado de cumplimiento normativo y preventivo para dirección.</p>
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
            id="sgc-export-pdf"
          >
            <Printer size={15} />
            Exportar Reporte PDF
          </button>
        </div>
      </div>

      {/* Selectors and Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="sgc-filters">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col justify-between">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Building2 size={13} className="text-slate-400" />
            Empresa Evaluada
          </label>
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-extrabold text-sm cursor-pointer"
            id="sgc-company-select"
          >
            {companiesList.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col justify-between">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-400" />
            Mes del Reporte
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-extrabold text-sm cursor-pointer"
            id="sgc-month-select"
          >
            {monthsList.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col justify-between">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Calendar size={13} className="text-slate-400" />
            Año del Reporte
          </label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-extrabold text-sm cursor-pointer"
            id="sgc-year-select"
          >
            {yearsList.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Speedometer and Gauge Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="sgc-velocimeter-panel">
        {/* SGC Velocimeter Gauge Card */}
        <div className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 flex flex-col items-center justify-center text-center shadow-sm relative overflow-hidden">
          <div className="absolute top-4 left-4 bg-slate-100 px-3 py-1 rounded-full text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">
            Índice de Salud General
          </div>

          {/* SVG Gauge */}
          <div className="w-60 h-32 mt-6 relative flex items-center justify-center">
            <svg viewBox="0 0 160 90" className="w-full h-full">
              <defs>
                <linearGradient id="gauge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="35%" stopColor="#f59e0b" />
                  <stop offset="70%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
              
              {/* Semicircle Track */}
              <path
                d="M 20 80 A 60 60 0 0 1 140 80"
                fill="none"
                stroke="#f1f5f9"
                strokeWidth="11"
                strokeLinecap="round"
              />
              <path
                d="M 20 80 A 60 60 0 0 1 140 80"
                fill="none"
                stroke="url(#gauge-grad)"
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray="188.5"
                strokeDashoffset={188.5 - (188.5 * metrics.finalScore) / 100}
                className="transition-all duration-1000 ease-out"
              />

              {/* Aesthetic Tick Marks & Labels */}
              {[0, 25, 50, 75, 100].map((t) => {
                const tickAngle = (t / 100) * 180;
                const tickRad = (tickAngle - 180) * (Math.PI / 180);
                const x1 = 80 + 64 * Math.cos(tickRad);
                const y1 = 80 + 64 * Math.sin(tickRad);
                const x2 = 80 + 69 * Math.cos(tickRad);
                const y2 = 80 + 69 * Math.sin(tickRad);
                
                const tx = 80 + 77 * Math.cos(tickRad);
                const ty = 80 + 77 * Math.sin(tickRad);

                return (
                  <g key={t}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="#94a3b8"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                    />
                    <text
                      x={tx}
                      y={ty}
                      fill="#64748b"
                      fontSize="5.5"
                      fontWeight="800"
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      {t}%
                    </text>
                  </g>
                );
              })}

              {/* Main needle shaft */}
              <line
                x1="80"
                y1="80"
                x2={midX}
                y2={midY}
                stroke="#1e293b"
                strokeWidth="2.2"
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
              {/* High-visibility active red tip */}
              <line
                x1={midX}
                y1={midY}
                x2={needleX}
                y2={needleY}
                stroke="#ef4444"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />

              {/* Elegant multi-layer pivot cap */}
              <circle cx="80" cy="80" r="6" fill="#1e293b" />
              <circle cx="80" cy="80" r="3" fill="#f8fafc" />
              <circle cx="80" cy="80" r="1.2" fill="#ef4444" />
            </svg>
          </div>

          {/* Big Bold Score Display placed outside the SVG so it never overlaps the needle */}
          <div className="mt-4 mb-3 text-center">
            <span className="text-4.5xl font-black text-slate-800 tracking-tight">{metrics.finalScore}%</span>
          </div>

          <div className="space-y-1.5 mt-1">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${health.color}`}>
              {health.label}
            </span>
            <p className="text-slate-500 text-xs font-medium max-w-xs">{health.desc}</p>
          </div>
        </div>

        {/* Breakdown Panel */}
        <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-base font-extrabold text-slate-800 tracking-tight">Desglose Metrológico y Cumplimiento</h2>
            <div className="space-y-4">
              {/* AC ProgressBar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-blue-500" />
                    Acciones Correctivas (AC)
                  </span>
                  <span className="text-slate-800 font-extrabold">{Math.round(metrics.acScore * 10) / 10} / 30 pts</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                  <div className="bg-blue-500 h-full rounded-full transition-all duration-1000" style={{ width: `${metrics.acCompliance}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                  <span className="font-bold text-slate-700">
                    Vencidas: <span className={metrics.acOverdue > 0 ? "text-red-500 font-extrabold" : "text-slate-500"}>{metrics.acOverdue}</span>
                  </span>
                  <span>Cumplimiento: {Math.round(metrics.acCompliance)}%</span>
                </div>
              </div>

              {/* ISO ProgressBar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <CalendarDays size={14} className="text-purple-500" />
                    Planificación Anual ISO
                  </span>
                  <span className="text-slate-800 font-extrabold">{Math.round(metrics.isoScore * 10) / 10} / 30 pts</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                  <div className="bg-purple-500 h-full rounded-full transition-all duration-1000" style={{ width: `${metrics.isoCompliance}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                  <span className="font-bold text-slate-700">
                    Vencidas: <span className={metrics.isoOverdue > 0 ? "text-red-500 font-extrabold" : "text-slate-500"}>{metrics.isoOverdue}</span>
                  </span>
                  <span>Cumplimiento: {Math.round(metrics.isoCompliance)}%</span>
                </div>
              </div>

              {/* AM ProgressBar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-emerald-500" />
                    Acciones de Mejora (AM)
                  </span>
                  <span className="text-slate-800 font-extrabold">{Math.round(metrics.amScore * 10) / 10} / 20 pts</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                  <div className="bg-emerald-500 h-full rounded-full transition-all duration-1000" style={{ width: `${metrics.amCompliance}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                  <span className="font-bold text-slate-700">
                    Vencidas: <span className={metrics.amOverdue > 0 ? "text-red-500 font-extrabold" : "text-slate-500"}>{metrics.amOverdue}</span>
                  </span>
                  <span>Cumplimiento: {Math.round(metrics.amCompliance)}%</span>
                </div>
              </div>

              {/* GC ProgressBar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-600 flex items-center gap-1.5">
                    <RefreshCw size={14} className="text-teal-500" />
                    Gestión de Cambios (GC)
                  </span>
                  <span className="text-slate-800 font-extrabold">{Math.round(metrics.gcScore * 10) / 10} / 20 pts</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden flex">
                  <div className="bg-teal-500 h-full rounded-full transition-all duration-1000" style={{ width: `${metrics.gcCompliance}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                  <span className="font-bold text-slate-700">
                    Vencidas: <span className={metrics.gcOverdue > 0 ? "text-red-500 font-extrabold" : "text-slate-500"}>{metrics.gcOverdue}</span>
                  </span>
                  <span>Cumplimiento: {Math.round(metrics.gcCompliance)}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Special Release Penalty Banner */}
          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${metrics.lePenalty > 0 ? 'bg-red-50 text-red-500' : 'bg-slate-100 text-slate-400'}`}>
                <ShieldCheck size={20} />
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-slate-700">Liberaciones Especiales Realizadas</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">Penalización directa a la salud del sistema por desvíos.</p>
              </div>
            </div>
            <div className="text-right">
              <span className={`text-sm font-extrabold ${metrics.lePenalty > 0 ? 'text-red-500' : 'text-slate-600'}`}>
                {metrics.leCount} en el mes
              </span>
              <p className="text-[10px] text-slate-400 font-bold mt-0.5">-{metrics.lePenalty} pts directos</p>
            </div>
          </div>
        </div>
      </div>

      {/* Accordion List of Overdue Items by Module */}
      <div className="space-y-4" id="sgc-overdue-accordion">
        <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
          <AlertCircle size={20} className="text-amber-500" />
          Detalle de Ítems Abiertos y Vencidos en la Empresa
        </h2>

        {/* AC Accordion Card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => toggleSection('ac')}
            className="w-full flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/50 transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <ShieldAlert size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Acciones Correctivas (Investigaciones + AC)</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Módulo de desvíos y no conformidades.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${metrics.acOverdue > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                {metrics.acOverdue} Vencidas
              </span>
              {expandedSections.ac ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          <AnimatePresence>
            {expandedSections.ac && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-white"
              >
                <div className="p-4 sm:p-6 space-y-4 divide-y divide-slate-100">
                  {overdueItemsList.filter(i => i.module === 'AC').length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4 font-semibold">No se encontraron tareas o investigaciones vencidas en este módulo.</p>
                  ) : (
                    overdueItemsList.filter(i => i.module === 'AC').map(item => (
                      <div key={item.id} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[10px] font-bold border border-blue-100">
                            {item.typeLabel}
                          </span>
                          <p className="text-slate-700 font-medium leading-relaxed">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-slate-400 font-medium whitespace-nowrap shrink-0">
                          <span>Vence: <strong className="text-slate-600">{item.deadline.toLocaleDateString('es-AR')}</strong></span>
                          <span>Resp: <strong className="text-slate-600">{item.responsibleEmail.split('@')[0]}</strong></span>
                          <span className="text-red-500 font-extrabold">{item.daysOverdue} días vencida</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ISO Accordion Card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => toggleSection('iso')}
            className="w-full flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/50 transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <CalendarDays size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Planificación Anual ISO</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Auditorías y actividades mandatorias registradas.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${metrics.isoOverdue > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                {metrics.isoOverdue} Vencidas
              </span>
              {expandedSections.iso ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          <AnimatePresence>
            {expandedSections.iso && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-white"
              >
                <div className="p-4 sm:p-6 space-y-4 divide-y divide-slate-100">
                  {overdueItemsList.filter(i => i.module === 'ISO').length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4 font-semibold">No se encontraron auditorías ni actividades SGC vencidas en este módulo.</p>
                  ) : (
                    overdueItemsList.filter(i => i.module === 'ISO').map(item => (
                      <div key={item.id} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <span className="inline-block px-2 py-0.5 bg-purple-50 text-purple-600 rounded-md text-[10px] font-bold border border-purple-100">
                            {item.typeLabel}
                          </span>
                          <p className="text-slate-700 font-medium leading-relaxed">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-slate-400 font-medium whitespace-nowrap shrink-0">
                          <span>Vence: <strong className="text-slate-600">{item.deadline.toLocaleDateString('es-AR')}</strong></span>
                          <span>Resp: <strong className="text-slate-600">{item.responsibleName}</strong></span>
                          <span className="text-red-500 font-extrabold">{item.daysOverdue} días vencida</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* AM Accordion Card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => toggleSection('am')}
            className="w-full flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/50 transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Acciones de Mejora (AM)</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Sugerencias y planes continuos cargados.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${metrics.amOverdue > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                {metrics.amOverdue} Vencidas
              </span>
              {expandedSections.am ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          <AnimatePresence>
            {expandedSections.am && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-white"
              >
                <div className="p-4 sm:p-6 space-y-4 divide-y divide-slate-100">
                  {overdueItemsList.filter(i => i.module === 'AM').length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4 font-semibold">No se encontraron planes de mejora vencidos en este módulo.</p>
                  ) : (
                    overdueItemsList.filter(i => i.module === 'AM').map(item => (
                      <div key={item.id} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <span className="inline-block px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-bold border border-emerald-100">
                            {item.typeLabel}
                          </span>
                          <p className="text-slate-700 font-medium leading-relaxed">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-slate-400 font-medium whitespace-nowrap shrink-0">
                          <span>Vence: <strong className="text-slate-600">{item.deadline.toLocaleDateString('es-AR')}</strong></span>
                          <span>Resp: <strong className="text-slate-600">{item.responsibleEmail.split('@')[0]}</strong></span>
                          <span className="text-red-500 font-extrabold">{item.daysOverdue} días vencida</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* GC Accordion Card */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => toggleSection('gc')}
            className="w-full flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/50 transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-teal-50 text-teal-600 rounded-xl">
                <RefreshCw size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Gestión de Cambios (GC)</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Revisiones técnicas y firmas pendientes de áreas.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 text-[10px] font-extrabold rounded-full ${metrics.gcOverdue > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                {metrics.gcOverdue} Vencidas
              </span>
              {expandedSections.gc ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
          </button>

          <AnimatePresence>
            {expandedSections.gc && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-white"
              >
                <div className="p-4 sm:p-6 space-y-4 divide-y divide-slate-100">
                  {overdueItemsList.filter(i => i.module === 'GC').length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4 font-semibold">No se encontraron revisiones o firmas de cambio vencidas.</p>
                  ) : (
                    overdueItemsList.filter(i => i.module === 'GC').map(item => (
                      <div key={item.id} className="pt-3 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <span className="inline-block px-2 py-0.5 bg-teal-50 text-teal-600 rounded-md text-[10px] font-bold border border-teal-100">
                            {item.typeLabel}
                          </span>
                          <p className="text-slate-700 font-medium leading-relaxed">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-slate-400 font-medium whitespace-nowrap shrink-0">
                          <span>Vence: <strong className="text-slate-600">{item.deadline.toLocaleDateString('es-AR')}</strong></span>
                          <span>Resp: <strong className="text-slate-600">{item.responsibleName}</strong></span>
                          <span className="text-red-500 font-extrabold">{item.daysOverdue} días vencida</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

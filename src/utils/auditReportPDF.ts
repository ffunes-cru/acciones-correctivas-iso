import { jsPDF } from 'jspdf';
import { ISOCalendar, ISOTask } from '../types';
import { getAuditProcessDetails } from './auditProcessDetails';

export const getAuditScopeDefault = (companyName?: string, calendarName?: string): string => {
  const comp = (companyName || '').trim().toLowerCase();
  const cal = (calendarName || '').trim().toLowerCase();
  
  if (comp.includes('fertec') || cal.includes('fertec')) {
    return `Comercialización, diseño y desarrollo, montaje y servicio de postventa de fertilizadoras de arrastre, autopropulsadas e incorporadoras para la agricultura.
Comercialización, diseño y desarrollo, montaje y servicio de postventa de tolvas, acoplados y semirremolques, destinados al transporte de sustancias a granel, granos y fertilizantes`;
  }
  
  if (comp.includes('tmc') || cal.includes('tmc')) {
    return `Diseño, desarrollo, fabricación, montaje, comercialización y servicio de postventa de sembradoras.`;
  }

  return '';
};

export const DEFAULT_AUDIT_CRITERIA = `Los criterios de auditoría utilizados como referencia son los requisitos establecidos en:
❖ La norma ISO 9001:2015;
❖ Los documentos del SGC.
❖ Los Requisitos Legales Reglamentarios aplicables para la actividad.
❖ Enmienda 1 ISO/ IAF publicada en Febrero de 2024.`;

function getAuditProcessName(taskName: string): string {
  let cleanName = taskName;
  if (cleanName.includes(':')) {
    cleanName = cleanName.split(':')[1].trim();
  }
  if (cleanName.includes('-')) {
    const parts = cleanName.split('-');
    const lastPart = parts[parts.length - 1].trim();
    if (/^[TQ][1-4]$/i.test(lastPart)) {
      parts.pop();
      cleanName = parts.join('-').trim();
    }
  }
  return cleanName || taskName;
}

function writeWrappedText(doc: jsPDF, text: string, x: number, y: number, maxW: number, lineHeight: number = 4.5): number {
  const lines = doc.splitTextToSize(text, maxW);
  let currentY = y;
  for (const line of lines) {
    if (currentY > 265) {
      doc.addPage();
      // Draw border on new page
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(15, 15, 180, 267);
      currentY = 25;
    }
    doc.text(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

export function generateAuditReportPDF(calendar: ISOCalendar, task: ISOTask, company: 'Crucianelli' | 'Fertec'): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Page borders
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.rect(15, 15, 180, 267); // Outer page border

  // Header block layout
  doc.line(15, 38, 195, 38); // Horizontal line for header
  doc.line(68, 15, 68, 38);  // Vertical line separating portal from title
  doc.line(150, 15, 150, 38); // Vertical line separating title from form metadata

  // SGC PORTAL and Company name rendering
  const primaryColor = [79, 70, 229]; // Indigo [R, G, B]
  const slateColor = [100, 116, 139];   // Slate-500
  const companyStr = (company || 'Crucianelli').toUpperCase();

  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('SGC PORTAL', 18, 25);

  doc.setFontSize(8.5);
  doc.setTextColor(slateColor[0], slateColor[1], slateColor[2]);
  doc.text(`EMPRESA: ${companyStr}`, 18, 32);

  // Title rendering (X: 68 to 150)
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('INFORME DE AUDITORÍA', 72, 24);
  doc.text('INTERNA DE CALIDAD', 72, 30);

  // Form metadata rendering (X: 150 to 195)
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Fecha: ${new Date().toLocaleDateString('es-AR')}`, 153, 24.5);
  doc.text('Página: 1 de 1', 153, 29.5);

  // General Data Table
  let y = 44;
  doc.setFillColor(245, 247, 250);
  doc.rect(15, y, 180, 36, 'F'); // Table background block
  doc.setDrawColor(200, 200, 200);
  doc.rect(15, y, 180, 36); // Outer border of table

  // Horizontal grid lines in metadata table
  doc.line(15, y + 12, 195, y + 12);
  doc.line(15, y + 24, 195, y + 24);

  // Vertical grid line
  doc.line(105, y, 105, y + 36);

  // Left column contents
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text('PROCESO AUDITADO:', 18, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(33, 37, 41);
  doc.text(getAuditProcessName(task.name), 18, y + 9);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('AÑO DE PLANIFICACIÓN:', 18, y + 17);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(33, 37, 41);
  doc.text(String(calendar.year), 18, y + 21);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('FECHA DE EJECUCIÓN:', 18, y + 29);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(33, 37, 41);
  const dateStr = task.completedAt 
    ? (typeof task.completedAt.toDate === 'function' ? task.completedAt.toDate() : new Date(task.completedAt)).toLocaleDateString('es-AR')
    : (task.deadline 
        ? (typeof task.deadline.toDate === 'function' ? task.deadline.toDate() : new Date(task.deadline)).toLocaleDateString('es-AR')
        : new Date().toLocaleDateString('es-AR'));
  doc.text(dateStr, 18, y + 33);

  // Right column contents
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('AUDITOR RESPONSABLE:', 108, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(33, 37, 41);
  doc.text(`${task.responsibleName} (${task.responsibleEmail})`, 108, y + 9);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('PERSONAL AUDITADO:', 108, y + 17);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(33, 37, 41);
  doc.text(task.auditedPersonnel || 'No especificado', 108, y + 21);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(80, 80, 80);
  doc.text('ESTADO DE LA AUDITORÍA:', 108, y + 29);
  doc.setFont('helvetica', 'bold');
  const isFinalizada = task.status === 'Finalizado' || task.status === 'Finalizada';
  if (isFinalizada) {
    doc.setTextColor(16, 124, 65); // Green
    doc.text('CONCLUIDA / FINALIZADA', 108, y + 33);
  } else {
    doc.setTextColor(224, 94, 0); // Orange
    doc.text('EN PROCESO / PENDIENTE', 108, y + 33);
  }

  y += 44; // Move Y down to start contents

  const drawSectionHeader = (title: string, color: [number, number, number]) => {
    if (y > 245) {
      doc.addPage();
      // Draw border on new page
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(15, 15, 180, 267);
      y = 25;
    }
    doc.setFillColor(...color);
    doc.rect(15, y, 180, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(title, 18, y + 4.2);
    y += 10;
  };

  // OBJETIVOS DE LA AUDITORÍA
  const auditDetails = getAuditProcessDetails(task.originalTaskName || task.name);
  if (auditDetails && auditDetails.objective) {
    drawSectionHeader('OBJETIVOS DE LA AUDITORÍA', [70, 80, 95]);
    doc.setTextColor(33, 37, 41);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    y = writeWrappedText(doc, auditDetails.objective, 18, y, 174, 4);
    y += 4;
  }

  // ALCANCE
  const scopeText = task.auditScope || getAuditScopeDefault(company, calendar.name);
  if (scopeText) {
    drawSectionHeader('ALCANCE', [70, 80, 95]);
    doc.setTextColor(33, 37, 41);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    y = writeWrappedText(doc, scopeText, 18, y, 174, 4);
    y += 4;
  }

  // CRITERIOS DE LA AUDITORÍA
  const criteriaText = task.auditCriteria || DEFAULT_AUDIT_CRITERIA;
  if (criteriaText) {
    drawSectionHeader('CRITERIOS DE LA AUDITORÍA', [70, 80, 95]);
    doc.setTextColor(33, 37, 41);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const safeCriteriaText = criteriaText.replace(/❖/g, '•');
    y = writeWrappedText(doc, safeCriteriaText, 18, y, 174, 4);
    y += 4;
  }

  // 1. FORTALEZAS ENCONTRADAS
  drawSectionHeader('1. FORTALEZAS ENCONTRADAS', [51, 65, 85]);
  doc.setTextColor(33, 37, 41);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const strengthsText = (task as any).strengths || 'No se registraron fortalezas de manera explícita.';
  y = writeWrappedText(doc, strengthsText, 18, y, 174);
  y += 6;

  // 2. OPORTUNIDADES DE MEJORA
  drawSectionHeader('2. OPORTUNIDADES DE MEJORA', [51, 65, 85]);
  const opps = (task as any).opportunities || [];
  doc.setTextColor(33, 37, 41);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  if (opps.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120, 120, 120);
    doc.text('No se registraron oportunidades de mejora en esta auditoría.', 18, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
  } else {
    opps.forEach((o: any, idx: number) => {
      let text = `${idx + 1}. ${o.text}`;
      if (o.isConfirmed && o.linkedFindingNumber) {
        text += ` (Vinculado a Hallazgo de Mejora #${o.linkedFindingNumber})`;
      }
      y = writeWrappedText(doc, text, 18, y, 174);
      y += 2;
    });
  }
  y += 6;

  // 3. NO CONFORMIDADES MENORES
  drawSectionHeader('3. NO CONFORMIDADES MENORES', [51, 65, 85]);
  const minors = (task as any).minorNonConformities || [];
  doc.setTextColor(33, 37, 41);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  if (minors.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120, 120, 120);
    doc.text('No se registraron No Conformidades Menores.', 18, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
  } else {
    minors.forEach((m: any, idx: number) => {
      let text = `${idx + 1}. ${m.text}`;
      if (m.process) text += ` [Proceso: ${m.process}]`;
      if (m.isConfirmed && m.linkedFindingNumber) {
        text += ` (Vinculado a Hallazgo Correctivo #${m.linkedFindingNumber})`;
      }
      y = writeWrappedText(doc, text, 18, y, 174);
      y += 2;
    });
  }
  y += 6;

  // 4. NO CONFORMIDADES MAYORES
  drawSectionHeader('4. NO CONFORMIDADES MAYORES', [51, 65, 85]);
  const majors = (task as any).majorNonConformities || [];
  doc.setTextColor(33, 37, 41);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  if (majors.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(120, 120, 120);
    doc.text('No se registraron No Conformidades Mayores.', 18, y);
    doc.setFont('helvetica', 'normal');
    y += 5;
  } else {
    majors.forEach((m: any, idx: number) => {
      let text = `${idx + 1}. ${m.text}`;
      if (m.process) text += ` [Proceso: ${m.process}]`;
      if (m.isConfirmed && m.linkedFindingNumber) {
        text += ` (Vinculado a Hallazgo Correctivo #${m.linkedFindingNumber})`;
      }
      y = writeWrappedText(doc, text, 18, y, 174);
      y += 2;
    });
  }
  y += 6;

  // 5. CONCLUSIÓN DE AUDITORÍA
  drawSectionHeader('5. CONCLUSIÓN DE AUDITORÍA', [51, 65, 85]);
  doc.setTextColor(33, 37, 41);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const commentsText = task.comments || 'No se ingresaron conclusiones ni comentarios adicionales.';
  y = writeWrappedText(doc, commentsText, 18, y, 174);
  y += 8;

  return doc;
}

import { jsPDF } from 'jspdf';
import { ISOCalendar, ISOTask } from '../types';
import { getAuditScopeDefault, DEFAULT_AUDIT_CRITERIA } from './auditReportPDF';

interface AuditProcessDetail {
  objective: string;
  clauses: string[];
  deliverables: Array<{
    title: string;
    desc: string;
    evidence: string[];
  }>;
}

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

export function generateAuditTemplatePDF(
  calendar: ISOCalendar,
  task: ISOTask,
  companyName: string,
  auditorName: string,
  details: AuditProcessDetail
): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const company = (companyName || '').toLowerCase().includes('fertec') ? 'Fertec' : 'Crucianelli';

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
  const companyStr = (companyName || company || 'Crucianelli').toUpperCase();

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
  doc.setFontSize(10);
  doc.text('GUÍA Y LISTA DE VERIFICACIÓN', 72, 23);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('PLANIFICACIÓN DE AUDITORÍA INTERNA', 72, 28);
  doc.text('SGC - ISO 9001:2015', 72, 33);

  // Form metadata rendering (X: 150 to 195)
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Fecha Impresión: ${new Date().toLocaleDateString('es-AR')}`, 153, 28.0);

  // General Data Table
  let y = 43;
  doc.setFillColor(248, 250, 252);
  doc.rect(15, y, 180, 32, 'F'); // Table background block
  doc.setDrawColor(200, 200, 200);
  doc.rect(15, y, 180, 32); // Outer border of table

  // Horizontal grid lines in metadata table
  doc.line(15, y + 16, 195, y + 16);
  // Vertical grid line
  doc.line(105, y, 105, y + 32);

  // Contents
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(70, 80, 95);
  doc.text('PROCESO / ÁREA AUDITADA:', 18, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(33, 37, 41);
  doc.text(getAuditProcessName(task.name).toUpperCase(), 18, y + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(70, 80, 95);
  doc.text('AUDITOR LÍDER:', 108, y + 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(33, 37, 41);
  doc.text(auditorName || 'SGC Auditor', 108, y + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(70, 80, 95);
  doc.text('PERSONAL AUDITADO:', 18, y + 21);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(task.auditedPersonnel || '................................................................................', 18, y + 26);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(70, 80, 95);
  doc.text('CALENDARIO DE ORIGEN:', 108, y + 21);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(33, 37, 41);
  doc.text(calendar.name || 'Planificación SGC', 108, y + 26);

  y += 38;

  // Objective section
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(191, 219, 254);
  doc.rect(15, y, 180, 16, 'F');
  doc.rect(15, y, 180, 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 58, 138);
  doc.text('OBJETIVOS DE LA AUDITORÍA:', 18, y + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  writeWrappedText(doc, details.objective, 18, y + 10, 174, 3.8);

  y += 20;

  // Alcance section
  const scopeText = task.auditScope || getAuditScopeDefault(companyName || company, calendar.name);
  if (scopeText) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, y, 180, 18, 'F');
    doc.rect(15, y, 180, 18);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(70, 80, 95);
    doc.text('ALCANCE:', 18, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    writeWrappedText(doc, scopeText, 18, y + 9, 174, 3.5);

    y += 22;
  }

  // Criterios section
  const criteriaText = task.auditCriteria || DEFAULT_AUDIT_CRITERIA;
  if (criteriaText) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, y, 180, 22, 'F');
    doc.rect(15, y, 180, 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(70, 80, 95);
    doc.text('CRITERIOS DE LA AUDITORÍA:', 18, y + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    const safeCriteria = criteriaText.replace(/❖/g, '•');
    writeWrappedText(doc, safeCriteria, 18, y + 9, 174, 3.4);

    y += 26;
  }

  // Clauses / Requirements section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('REQUISITOS ISO 9001:2015 EVALUADOS EN ESTE PROCESO:', 15, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  for (const clause of details.clauses) {
    if (y > 270) {
      doc.addPage();
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(15, 15, 180, 267);
      y = 25;
    }
    const cleanClause = clause.trim();
    doc.text(`• ${cleanClause}`, 18, y);
    y += 4.5;
  }

  y += 3;

  // Deliverables and Evidence Checklist Section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('LISTA DE COMPROBACIÓN (ENTREGABLES Y EVIDENCIAS REQUERIDAS):', 15, y);
  y += 6;

  let deliverableIndex = 1;
  for (const deliv of details.deliverables) {
    if (y > 240) {
      doc.addPage();
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(15, 15, 180, 267);
      y = 25;
    }

    // Header block for deliverable
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, y, 180, 7.5, 'F');
    doc.rect(15, y, 180, 7.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`${deliverableIndex}. Requisito: ${deliv.title}`, 18, y + 5);
    y += 11;

    // Description text
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('Descripción:', 18, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    y = writeWrappedText(doc, deliv.desc, 35, y, 155, 4);
    y += 2;

    // Evidence Checklist
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text('Evidencias objetivas sugeridas a verificar:', 18, y);
    y += 4.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);

    for (const ev of deliv.evidence) {
      if (y > 265) {
        doc.addPage();
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.rect(15, 15, 180, 267);
        y = 25;
      }

      // Draw standard checkbox
      doc.setDrawColor(148, 163, 184);
      doc.rect(20, y - 2.8, 3, 3);

      // Write evidence text wrapped
      y = writeWrappedText(doc, ev, 25, y, 165, 4);
      y += 1.5;
    }

    y += 1.5;

    // Notes area for Auditor
    if (y > 240) {
      doc.addPage();
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(15, 15, 180, 267);
      y = 25;
    }

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Notas de auditoría y hallazgos encontrados:', 18, y);
    y += 5.5;

    // Draw three lined spaces for the auditor to handwrite comments
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.15);
    
    doc.line(18, y, 190, y);
    y += 6;
    doc.line(18, y, 190, y);
    y += 6;
    doc.line(18, y, 190, y);
    
    y += 8;
    deliverableIndex++;
  }

  // Footer on last page or general closing
  if (y > 250) {
    doc.addPage();
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.2);
    doc.rect(15, 15, 180, 267);
    y = 25;
  }

  y = 255;
  doc.setDrawColor(200, 200, 200);
  doc.line(15, y, 195, y);

  // Signatures or notes
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  doc.text('Lista de Verificación de Auditoría Interna - Generado automáticamente por SGC Crucianelli/Fertec', 18, y + 4);
  doc.text('Firma del Auditor Líder: _________________________________', 125, y + 4);

  return doc;
}

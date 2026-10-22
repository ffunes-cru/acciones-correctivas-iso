import { jsPDF } from 'jspdf';

export function generateUserManualPDF(userName: string = 'Usuario SGC'): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const primaryColor = [79, 70, 229]; // Indigo [R, G, B]
  const slateDark = [30, 41, 59];     // Slate-800
  const slateMuted = [100, 116, 139]; // Slate-500
  const bgLight = [248, 250, 252];    // Slate-50

  let currentPage = 1;

  // Helper to draw outer frame border and header
  const drawPageHeaderAndFrame = (isFirstPage: boolean = false) => {
    // Outer Frame Border
    doc.setDrawColor(203, 213, 225); // Slate-300
    doc.setLineWidth(0.3);
    doc.rect(12, 12, 186, 273);

    // Header Box
    doc.setFillColor(bgLight[0], bgLight[1], bgLight[2]);
    doc.rect(12, 12, 186, 26, 'F');
    doc.line(12, 38, 198, 38);
    doc.line(65, 12, 65, 38);
    doc.line(148, 12, 148, 38);

    // Header Left - Branding
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('SGC PORTAL', 18, 23);
    doc.setFontSize(8);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text('Crucianelli S.A. / TMC', 18, 30);

    // Header Center - Document Title
    doc.setTextColor(slateDark[0], slateDark[1], slateDark[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('MANUAL DE USUARIO Y GUÍA OPERATIVA', 68, 23, { maxWidth: 76 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Sistema Unificado de Gestión de Calidad', 68, 29, { maxWidth: 76 });

    // Header Right - Metadata
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.setFontSize(7.5);
    doc.text(`Emisión: ${new Date().toLocaleDateString('es-AR')}`, 152, 21);
    doc.text(`Solicitado por: ${userName.substring(0, 18)}`, 152, 26);
    doc.text('Versión: 2.4 (Oficial)', 152, 31);

    // Footer
    doc.setFontSize(7.5);
    doc.setTextColor(slateMuted[0], slateMuted[1], slateMuted[2]);
    doc.text('Documento de Uso Interno Corporativo • Crucianelli S.A.', 16, 281);
    doc.text(`Página ${currentPage}`, 192, 281, { align: 'right' });
  };

  // Helper to ensure page bounds
  let y = 45;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > 270) {
      doc.addPage();
      currentPage++;
      drawPageHeaderAndFrame(false);
      y = 45;
    }
  };

  const writeSectionHeader = (title: string) => {
    ensureSpace(12);
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(16, y, 178, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(title.toUpperCase(), 20, y + 5.5);
    y += 12;
  };

  const writeSubHeader = (title: string) => {
    ensureSpace(8);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(title, 18, y);
    y += 5;
  };

  const writeParagraph = (text: string, indent: number = 18) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);

    const maxW = 194 - indent;
    const lines = doc.splitTextToSize(text, maxW);
    
    for (const line of lines) {
      ensureSpace(5);
      doc.text(line, indent, y);
      y += 4.5;
    }
    y += 2;
  };

  const writeBullet = (label: string, value: string) => {
    ensureSpace(5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text(`• ${label}: `, 20, y);

    const labelWidth = doc.getTextWidth(`• ${label}: `);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);

    const maxW = 192 - (20 + labelWidth);
    const lines = doc.splitTextToSize(value, maxW);

    if (lines.length > 0) {
      doc.text(lines[0], 20 + labelWidth, y);
      y += 4.5;
      for (let i = 1; i < lines.length; i++) {
        ensureSpace(5);
        doc.text(lines[i], 24, y);
        y += 4.5;
      }
    }
    y += 1;
  };

  // Draw initial page frame
  drawPageHeaderAndFrame(true);

  // --- SECCIÓN 0: GENERAL & PORTAL ---
  writeSectionHeader('1. Visión General y Portal SGC Unificado');
  writeSubHeader('1.1 Objetivo del Portal');
  writeParagraph('Proporcionar un punto de acceso único, centralizado y altamente auditable para todos los colaboradores pertenecientes al Grupo Crucianelli, integrando los módulos de calidad, cumplimiento normativo ISO y gestión de desvíos.');
  
  writeSubHeader('1.2 Paso a Paso de Uso');
  writeBullet('Paso 1 - Autenticación Corporativa', 'Ingrese mediante el botón "Ingresar con Google" utilizando su cuenta de correo corporativo oficial (@crucianelli.com).');
  writeBullet('Paso 2 - Lanzador de Módulos', 'En la pantalla principal del Portal, seleccione la tarjeta del módulo deseado y presione "Acceder al Módulo".');
  writeBullet('Paso 3 - Navegación Superior', 'Utilice la barra de menú superior para alternar entre el Dashboard principal, Nuevo Registro, Reportes, Configuración y Directorio.');
  writeBullet('Paso 4 - Retorno', 'En cualquier momento presione el botón "Módulos" para regresar al lanzador principal.');

  writeSubHeader('1.3 Roles del Sistema');
  writeBullet('Administrador (Admin)', 'Control total sobre todos los módulos, edición de configuraciones, gestión de usuarios, cierre final de hallazgos y log de correos.');
  writeBullet('Editor', 'Creación y gestión de registros, análisis de causa raíz, asignación y ejecución de acciones en los módulos correspondientes.');
  writeBullet('Lector (Viewer)', 'Acceso de consulta a tableros, velocímetros e indicadores de salud operacional sin permisos de alteración de datos.');

  y += 4;

  // --- SECCIÓN 1: SALUD SGC ---
  writeSectionHeader('2. Módulo 1: Salud del SGC y Velocímetro de Cumplimiento');
  writeSubHeader('2.1 Objetivo');
  writeParagraph('Ofrecer a la Dirección y Líderes de Calidad un tablero consolidado de salud organizacional basado en el porcentaje de acciones cerradas a tiempo frente a los objetivos establecidos.');

  writeSubHeader('2.2 Paso a Paso de Uso');
  writeBullet('Filtrado Dinámico', 'Seleccione la empresa (Crucianelli / TMC), año y mes evaluado en los selectores del encabezado.');
  writeBullet('Análisis del Velocímetro', 'Visualice la aguja del velocímetro que marca la tasa global de cumplimiento (Objetivo institucional: >= 85%).');
  writeBullet('Desglose por Módulos', 'Revise la tabla de puntos asignados a Acciones Correctivas (30 pts), Planificación ISO (30 pts), Mejoras (20 pts), Gestión de Cambios (20 pts) y penalidades de Liberaciones Especiales.');
  writeBullet('Reporte de Salud PDF', 'Presione "Descargar Reporte Consolidado" para emitir el informe oficial para reuniones de directorio.');

  y += 4;

  // --- SECCIÓN 2: ACCIONES CORRECTIVAS ---
  writeSectionHeader('3. Módulo 2: Acciones Correctivas (No Conformidades)');
  writeSubHeader('3.1 Objetivo');
  writeParagraph('Erradicar las causas raíz de los desvíos detectados en auditorías internas, reclamos de clientes o controles de proceso mediante un análisis de 5 Porqués y seguimiento riguroso de acciones correctivas.');

  writeSubHeader('3.2 Circuito de 5 Pasos');
  writeBullet('Paso 1 - Alta del Hallazgo', 'El Creador registra la No Conformidad, adjunta evidencias, asigna el proceso y define la persona responsable de la Investigación de Causa Raíz.');
  writeBullet('Paso 2 - Investigación de Causa Raíz', 'El Responsable de Causa Raíz completa la metodología de los 5 Porqués, define la Causa Raíz y establece Acciones de Contención inmediatas.');
  writeBullet('Paso 3 - Asignación de Acciones Correctivas', 'El Responsable de Causa Raíz define las tareas correctivas requeridas, indicando el Responsable de Acción y la Fecha Límite de Ejecución.');
  writeBullet('Paso 4 - Ejecución de la Acción Correctiva', 'El Responsable de Acción implementa las acciones correctivas en tiempo y forma, registrando las evidencias correspondientes.');
  writeBullet('Paso 5 - Verificación y Cierre', 'Una vez implementadas las acciones, el Creador o Administrador verifica la eficacia en terreno y procede al cierre del hallazgo.');

  y += 4;

  // --- SECCIÓN 3: MEJORA CONTINUA ---
  writeSectionHeader('4. Módulo 3: Acciones de Mejora Continua');
  writeSubHeader('4.1 Objetivo');
  writeParagraph('Permitir el registro ágil y seguimiento directo de oportunidades de mejora e iniciativas operativas sin requerir la burocracia de un análisis de causa raíz extenso.');

  writeSubHeader('4.2 Modo de Operación');
  writeBullet('Registro Rápido', 'Acceda a "Nuevo Hallazgo", seleccione el tipo "Acción de Mejora" e ingrese el detalle de la propuesta.');
  writeBullet('Asignación Directa', 'Asigne directamente el responsable de ejecución y la fecha de compromiso. El sistema enviará una notificación automática por correo.');
  writeBullet('Seguimiento', 'El responsable adjunta la evidencia de implementación y marca la tarea como realizada.');

  y += 4;

  // --- SECCIÓN 4: PLANIFICACIÓN ISO ---
  writeSectionHeader('5. Módulo 4: Planificación ISO 9001');
  writeSubHeader('5.1 Objetivo');
  writeParagraph('Garantizar el cumplimiento oportuno de auditorías internas, mantenimientos del SGC, revisiones por la dirección y tareas normativas programadas.');

  writeSubHeader('5.2 Circuito Operativo');
  writeBullet('Programación Anual', 'El Administrador ISO configura el calendario anual de auditorías y tareas recurrentes por cláusula de la norma ISO 9001.');
  writeBullet('Alertas Automatizadas', 'El sistema emite recordatorios automáticos por email a los responsables 7, 3 y 1 día antes del vencimiento.');
  writeBullet('Carga de Evidencias', 'El auditado o responsable adjunta el informe o constancia de ejecución antes del plazo límite.');
  writeBullet('Validación Calidad', 'El área de Calidad valida la documentación presentada y marca el hito como Aprobado.');

  y += 4;

  // --- SECCIÓN 5: LIBERACIONES ESPECIALES ---
  writeSectionHeader('6. Módulo 5: Liberación Especial de Calidad');
  writeSubHeader('6.1 Objetivo');
  writeParagraph('Evaluar y autorizar bajo un estricto protocolo de firmas técnicas la utilización o despacho condicional de insumos, piezas o lotes con desviaciones no críticas.');

  writeSubHeader('6.2 Protocolo de Dictámenes');
  writeBullet('Solicitud de Liberación', 'Calidad o Producción registra la pieza, código de lote, cantidad afectada y motivo de la desviación.');
  writeBullet('Circuito de Evaluación', 'Se requiere la evaluación técnica obligatoria de Calidad, Ingeniería y Producción.');
  writeBullet('Dictamen Final', 'El lote se aprueba o rechaza condicionalmente según las firmas digitales registradas.');

  y += 4;

  // --- SECCIÓN 6: GESTIÓN DE CAMBIOS ---
  writeSectionHeader('7. Módulo 6: Gestión de Cambios (MOC)');
  writeSubHeader('7.1 Objetivo');
  writeParagraph('Evaluar anticipadamente el impacto de modificaciones en procesos, equipamiento, productos o proveedores para mitigar riesgos operacionales.');

  writeSubHeader('7.2 Fases del Proceso MOC');
  writeBullet('Fase 1 - Propuesta de Cambio', 'El solicitante describe la situación actual vs. futura, objetivos del cambio y análisis de impacto inicial.');
  writeBullet('Fase 2 - Revision Interdisciplinaria', 'Las áreas involucradas revisan la propuesta y definen acciones preventivas o de adecuación.');
  writeBullet('Fase 3 - Aprobación y Ejecución', 'El Aprobador autoriza el cambio tras contar con todas las revisiones favorables emitidas.');

  y += 4;

  // --- SECCIÓN 7: USUARIOS Y PERMISOS ---
  writeSectionHeader('8. Administración de Usuarios y Seguridad de Datos');
  writeSubHeader('8.1 Directorio Centralizado');
  writeParagraph('El sistema mantiene una base unificada de usuarios autenticados mediante Google Workspace, asociando cada cuenta con su empresa, sector y nivel de permisos.');

  writeSubHeader('8.2 Matriz de Seguridad Firestore');
  writeBullet('Autenticación Obligatoria', 'Solo usuarios con cuentas corporativas autorizadas pueden consultar o crear registros.');
  writeBullet('Trazabilidad e Inmutabilidad', 'Todas las firmas digitales, cierres de hallazgos y aprobaciones MOC quedan registradas con stamp de fecha y usuario en Firestore.');

  // Finalize PDF
  doc.save('Manual_Usuario_SGC_Crucianelli.pdf');
}

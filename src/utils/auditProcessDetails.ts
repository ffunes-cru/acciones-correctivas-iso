export interface AuditProcessDetail {
  objective: string;
  clauses: string[];
  deliverables: { title: string; desc: string; evidence: string[] }[];
}

export function getAuditProcessName(taskName: string): string {
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

export function getAuditProcessDetails(taskName: string): AuditProcessDetail {
  const name = taskName.toLowerCase();
  
  if (name.includes('información documentada') || name.includes('informacion documentada')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Cláusula 7.5 Información Documentada",
        "  7.5.1 Generalidades",
        "  7.5.2 Creación y actualización",
        "  7.5.3 Control de la información documentada (7.5.3.1 y 7.5.3.2)"
      ],
      deliverables: [
        {
          title: "7.5.1: Generalidades",
          desc: "El SGC de la organización debe incluir la información documentada requerida por la norma y la que la organización determine como necesaria para la eficacia.",
          evidence: [
            "Manual de Calidad (si aplica).",
            "Listado Maestro de Documentos e Información Documentada (control de procedimientos, instructivos, políticas).",
            "Evidencia de que se han documentado los requisitos clave exigidos por la norma (ej. Alcance del SGC, Política de Calidad, Objetivos de Calidad)."
          ]
        },
        {
          title: "7.5.2: Creación y Actualización",
          desc: "Al crear y actualizar la información documentada, la organización debe asegurarse de que la identificación, el formato y la revisión/aprobación sean adecuados.",
          evidence: [
            "Procedimiento estructurado (o instructivo) para la creación, revisión, codificación y aprobación de documentos.",
            "Documentos con encabezados de control claros: Título, Código único, Fecha de vigencia, Número de versión.",
            "Firmas de aprobación (digitales o físicas) de los responsables de los documentos."
          ]
        },
        {
          title: "7.5.3: Control de la Información Documentada",
          desc: "La información documentada debe controlarse para asegurarse de que esté disponible, sea idónea para su uso, y esté protegida contra pérdida o uso inadecuado.",
          evidence: [
            "Matriz de control de registros (donde se defina almacenamiento, tiempo de retención y disposición final).",
            "Evidencia de copias de seguridad (backups) de los servidores o sistemas donde se aloja el software del SGC.",
            "Control de acceso a carpetas digitales (permisos de lectura/escritura) o archivos físicos bajo llave.",
            "Listado o identificación de documentos externos aplicables (normas legales, manuales de proveedores, etc.)."
          ]
        }
      ]
    };
  }
  
  if (name.includes('investigación y desarrollo') || name.includes('investizacion y desarrollo') || name.includes('diseño') || name.includes('diseno') || name.includes('i+d') || name.includes('desarrollo')) {
    return {
      objective: "Evaluar la conformidad del proceso de diseño y desarrollo de productos y servicios con los requisitos planificados, garantizando el control de las etapas clave según la norma ISO 9001.",
      clauses: [
        "8.3 \"Diseño y desarrollo de los productos y servicios\"."
      ],
      deliverables: [
        {
          title: "1. Requisito 8.3.2: Planificación del Diseño y Desarrollo",
          desc: "La organización debe determinar las etapas y controles para el diseño y desarrollo, considerando la complejidad de las actividades, las etapas del proceso necesarias (incluyendo las revisiones), y las responsabilidades involucradas.",
          evidence: [
            "Plan de Diseño y Desarrollo (Gantt, Cronograma o RoadMap): Documento donde se definan las fases del proyecto de ingeniería, fechas estimadas, recursos asignados y responsables.",
            "Matriz de Responsabilidades (ej. RACI): Definición clara de quién diseña, quién revisa, quién aprueba y quiénes son las partes interesadas (internas o externas) que interactúan en el desarrollo."
          ]
        },
        {
          title: "2. Requisito 8.3.3: Entradas para el Diseño y Desarrollo",
          desc: "La empresa debe determinar los requisitos esenciales para los tipos específicos de productos y servicios que se van a diseñar.",
          evidence: [
            "Pliego de Condiciones / Requerimientos del Cliente: Documento inicial con las especificaciones técnicas solicitadas.",
            "Registro de Entradas de Diseño: Un listado o documento que consolide: Requisitos de desempeño y funcionales, Información proveniente de diseños previos similares (lecciones aprendidas), Requisitos legales y reglamentarios aplicables al producto (normas de seguridad, certificaciones obligatorias, etc.), Normas o códigos de prácticas que la organización se ha comprometido a implementar."
          ]
        },
        {
          title: "3. Requisito 8.3.4: Controles del Diseño y Desarrollo",
          desc: "Este es el núcleo operativo de la ingeniería. La norma exige aplicar controles para asegurarse de que se evalúan los resultados y se garantiza que el producto final cumplirá con lo esperado. Se divide en tres acciones clave:\nA. Revisiones: Evaluar la capacidad de los resultados para cumplir los requisitos.\nB. Verificación: Asegurar que las salidas cumplan con los requisitos de las entradas (¿El plano/cálculo responde a lo que pidió el cliente?).\nC. Validación: Asegurar que el producto resultante es capaz de satisfacer los requisitos para su aplicación especificada o uso previsto (¿Funciona bien en el mundo real?).",
          evidence: [
            "A. Revisiones -> Entregable: Minutas o actas de reuniones de diseño donde se evalúa el avance del proyecto y se detectan problemas de ingeniería de forma prematura.",
            "B. Verificación -> Entregable: Informes de cálculos de ingeniería, simulaciones de software (ej. CAD/CAE), revisión cruzada de planos por otro ingeniero, hojas de datos técnicas aprobadas.",
            "C. Validación -> Entregable: Informes de pruebas de prototipos, ensayos de laboratorio, pruebas de campo, testeo de software en entornos controlados, homologaciones."
          ]
        },
        {
          title: "4. Requisito 8.3.5: Salidas del Diseño y Desarrollo",
          desc: "Las salidas deben garantizar que se cumplen los requisitos de entrada, que son adecuadas para los procesos posteriores (compras, producción) y que especifican las características esenciales del producto.",
          evidence: [
            "Planos Técnicos y Hojas de Especificaciones: Planos finales aprobados para fabricación o ensamblaje.",
            "Lista de Materiales (BOM - Bill of Materials): Estructura del producto necesaria para que el área de Compras sepa qué adquirir.",
            "Manuales de Uso, Instructivos de Ensamble o Criterios de Aceptación: Documentación necesaria para que el área de Producción o Servicios opere sin errores y Control de Calidad sepa qué inspeccionar."
          ]
        },
        {
          title: "5. Requisito 8.3.6: Cambios del Diseño y Desarrollo",
          desc: "La organización debe identificar, revisar y controlar los cambios hechos durante el diseño o posteriormente, para asegurarse de que no haya un impacto adverso en la conformidad.",
          evidence: [
            "Registro de Control de Cambios de Ingeniería: Documento o registro en sistema donde se detalla: Cuál fue la modificación realizada (ej. cambio de un componente o material), Los resultados de la revisión del cambio (evaluación de impacto), La autorización del cambio (quién aprobó la modificación), Acciones tomadas para prevenir impactos negativos (ej. aviso a la planta productiva para retirar planos anteriores)."
          ]
        }
      ]
    };
  }

  if (name.includes('producción') || name.includes('produccion')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "8.5 Producción y provisión del servicio"
      ],
      deliverables: [
        {
          title: "Requisito 8.5.1: Control de la producción y de la provisión del servicio",
          desc: "La organización debe implementar la producción bajo condiciones controladas. Esto incluye contar con información documentada que defina las características del producto, los resultados a alcanzar, el uso de infraestructura adecuada y la implementación de actividades de seguimiento.",
          evidence: [
            "Programa de Producción: Orden del día, semanal o mensual de lo que se va a fabricar.",
            "Hojas de Ruta o Órdenes de Producción (OP): Documentos que viajan con el producto indicando la cantidad a fabricar y las etapas del proceso.",
            "Instructivos de Trabajo / Procedimientos Operativos Estándar (POEs): Manuales visuales o escritos a pie de máquina que le dicen al operario cómo operar.",
            "Registros de Control en Proceso: Planillas de autocontrol donde el operario anota mediciones, temperaturas o pesos durante la fabricación.",
            "Mantenimiento de Máquinas: Plan y registros de mantenimiento preventivo y calibración de los equipos de medición de la planta (ej: balanzas, termómetros)."
          ]
        },
        {
          title: "Requisito 8.5.2: Identificación y trazabilidad",
          desc: "La organización debe utilizar medios adecuados para identificar las salidas del proceso para asegurar la conformidad y controlar la identificación única cuando la trazabilidad sea un requisito.",
          evidence: [
            "Sistema de Etiquetado: Etiquetas físicas o códigos de barras/QR que identifiquen claramente el estado del producto (ej: \"Materia prima\", \"En proceso\", \"Aprobado\", \"Rechazado\").",
            "Registro de Número de Lote: Evidencia documental que permita vincular el producto final con las materias primas utilizadas (árbol de trazabilidad) y el turno que lo fabricó."
          ]
        },
        {
          title: "Requisito 8.5.3: Propiedad perteneciente a los clientes o proveedores externos",
          desc: "La empresa debe cuidar los bienes propiedad del cliente o de proveedores externos (como moldes, herramientas, embalajes o materias primas que ellos entreguen) mientras estén bajo su control.",
          evidence: [
            "Inventario de Propiedad de Terceros: Listado de los elementos que son del cliente (ej: un molde de inyección provisto por el cliente).",
            "Registros de Inspección de Entrada: Evidencia de que el material del cliente se revisó al recibirlo para verificar que no estuviera dañado.",
            "Reportes de Incidencias: Comunicaciones formales al cliente en caso de que su propiedad se haya perdido, deteriorado o sea inadecuada."
          ]
        },
        {
          title: "Requisito 8.5.4: Preservación",
          desc: "La organización debe preservar las salidas durante la producción y prestación del servicio en la medida necesaria para asegurar la conformidad con los requisitos (manipulación, control de contaminación, almacenamiento, transporte).",
          evidence: [
            "Registros de Condiciones Ambientales: Control de temperatura y humedad en almacenes de producto terminado o materias primas críticas.",
            "Procedimiento de Embalaje and Almacenamiento: Criterios claros de estiba (ej: \"Máximo 4 cajas de altura\") y uso de elementos de protección física."
          ]
        },
        {
          title: "Requisito 8.5.6: Control de los cambios",
          desc: "Se deben revisar y controlar los cambios no planificados en la producción para asegurar la continuidad de la conformidad.",
          evidence: [
            "Autorizaciones de Desvío Temporal: Registro de cuándo se cambió un parámetro de máquina o un componente autorizado por el jefe de planta o calidad debido a una emergencia, evaluando que no afecte al producto final."
          ]
        }
      ]
    };
  }

  if (name.includes('calidad') || name.includes('recepción') || name.includes('recepcion') || name.includes('reclamos')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Requisito 7.1.5",
        "Requisito 8.6",
        "Requisito 8.7",
        "Requisito 9.1.3",
        "Requisito 9.2"
      ],
      deliverables: [
        {
          title: "1. Requisito 7.1.5: Recursos de seguimiento y medición (Metrología / QC)",
          desc: "Si la empresa usa equipos para verificar que el producto cumple con los requisitos (calibres, balanzas, termómetros, medidores de presión, etc.), Calidad debe asegurar que esos equipos sean confiables.",
          evidence: [
            "Plan o Programa Anual de Calibración y Verificación: Cronograma de cuándo le toca mantenimiento y calibración a cada equipo.",
            "Certificados de Calibración: Informes emitidos por laboratorios externos acreditados (con trazabilidad a patrones nacionales o internacionales).",
            "Identificación del Estado de Calibración: Etiquetas pegadas en los mismos equipos en la planta que indiquen claramente si están \"Calibrados\", \"Vencidos\" o \"Fuera de Uso\"."
          ]
        },
        {
          title: "2. Tipo y Alcance del Control / Verificación de lo Comprado (Cláusula 8.4.2)",
          desc: "No basta con pedir bien; hay que revisar que lo que llega sea lo correcto. La norma exige que la empresa asegure que los productos o servicios externos no afecten la capacidad de entregar conformidad a sus propios clientes.",
          evidence: [
            "Registros de Control de Recepción: Albaranes, remitos o registros en el sistema (ERP) firmados por el almacén o el usuario solicitante, donde se valide que lo recibido coincide en cantidad y calidad con la Orden de Compra.",
            "Certificados de Calidad / Conformidad del Proveedor: Para materiales críticos, el documento emitido por el proveedor que avala que el lote cumple con las normas.",
            "Protocolo de Devoluciones o Producto No Conforme: Registro de qué haces cuando un proveedor entrega algo defectuoso (notas de crédito, registros de rechazo en almacén)."
          ]
        },
        {
          title: "3. Requisito 8.6: Liberación de los productos y servicios (QC)",
          desc: "Calidad debe garantizar que el producto no se entregue al cliente hasta que se haya verificado positivamente que cumple con todo lo planificado.",
          evidence: [
            "Planes de Inspección y Muestreo: Documentos que definan los criterios de aceptación y rechazo (ej: tablas AQL, tolerancias permitidas).",
            "Registros de Inspección: Planillas de control de calidad (de materia prima, control en proceso y control de producto final) completadas y firmadas.",
            "Evidencia de Trazabilidad de la Autorización: El registro debe mostrar claramente la identidad de la persona que autorizó la liberación (firma, sello o usuario digital del inspector)."
          ]
        },
        {
          title: "4. Requisito 8.7: Control de las salidas no conformes (QC / QA)",
          desc: "Calidad debe asegurar que cualquier producto que salga mal se identifique y controle para evitar su uso o entrega accidental.",
          evidence: [
            "Listado o Registro de Producto No Conforme: Bitácora donde se anoten los defectos detectados, cantidades y lotes afectados.",
            "Tarjetas o Etiquetas de Bloqueo: Evidencia física en planta de que el producto fallado está identificado (ej: etiqueta roja de \"RETENIDO\" o \"RECHAZADO\").",
            "Evidencia de la Disposición Final: Registros que demuestren qué se hizo con el desvío (actas de destrucción de scrap, informes de reproceso aprobado, o autorización firmada por el cliente si se aceptó bajo concesión)."
          ]
        },
        {
          title: "5. Requisitos 9.1.3 (Análisis) y 9.2 (Auditoría Interna) (QA)",
          desc: "Aseguramiento de la Calidad debe analizar los datos del SGC y coordinar los procesos de evaluación interna.",
          evidence: [
            "Informes de Tendencias de Calidad: Gráficos y análisis de tasas de rechazo, evolución de reclamos de clientes y costos de no calidad.",
            "Programa Anual de Auditorías Internas: Planificación a largo plazo de las auditorías.",
            "Plan e Informe de la Última Auditoría Interna: Detalle de los hallazgos detectados, y constancia de la competencia de los auditores internos (certificados de curso de auditor ISO 9001)."
          ]
        },
        {
          title: "6. Requisito 10.2: No conformidad y acción correctiva (QA / CAPA)",
          desc: "Cuando algo falla (una auditoría sale mal, hay un reclamo grave de un cliente o un defecto repetitivo), QA debe liderar el proceso para que el error no vuelva a ocurrir.",
          evidence: [
            "Registro de Acciones Correctivas (CAPAs): Formularios donde se abran los desvíos del sistema.",
            "Análisis de Causa Raíz: Evidencia de que se usaron metodologías de análisis (como los 5 Porqués, diagrama de Ishikawa / espina de pescado).",
            "Verificación de la Eficacia: Registro (firmado meses después de cerrar la acción) donde QA demuestre que comprobó que el problema realmente se solucionó y no se volvió a repetir."
          ]
        }
      ]
    };
  }

  if (name.includes('medición') || name.includes('medicion') || name.includes('instrumentos') || name.includes('calibración') || name.includes('calibracion')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Requisito 7.1.5",
        "Requisito 9.1"
      ],
      deliverables: [
        {
          title: "1. Requisito 7.1.5.1: Generalidades (Idoneidad de los recursos)",
          desc: "La organización debe asegurarse de que los recursos proporcionados sean apropiados para el tipo específico de actividades de seguimiento y medición que se realizan, y que se mantengan para asegurarse de su idoneidad continua.",
          evidence: [
            "Listado Maestro / Inventario de Equipos de Medición: Bitácora con la totalidad de los instrumentos de la empresa (calibres, balanzas, manómetros, durómetros, etc.), incluyendo marca, modelo, número de serie y ubicación.",
            "Ficha de Vida del Equipo (Hoja de vida): Historial individual de cada instrumento donde conste su fecha de ingreso, reparaciones y movimientos.",
            "Definición del Error Máximo Permitido (EMP): Documento técnico donde se defina la tolerancia de medición requerida para cada proceso (ej: \"Para el proceso X se necesita un instrumento con precisión de ±0.01 mm\")."
          ]
        },
        {
          title: "2. Requisito 7.1.5.2: Trazabilidad de la medición (Calibración y Verificación)",
          desc: "Cuando la trazabilidad de la medición es un requisito (o la empresa lo considera esencial), los equipos de medición deben calibrarse o verificarse a intervalos planificados o antes de su utilización, contra patrones de medición trazables internacional o nacionalmente.",
          evidence: [
            "Plan o Cronograma Anual de Calibración: Calendario que indique cuándo vence la validez de la medición de cada equipo.",
            "Certificados de Calibración Externa: Informes emitidos por laboratorios acreditados (ej: bajo norma ISO/IEC 17025) que demuestren la trazabilidad a patrones nacionales (como el INTI, NIST, etc.).",
            "Registros de Verificaciones Internas (Controles intermedios): Planillas de calibraciones o verificaciones diarias/semanales hechas en casa (ej: pesar una masa de control conocida antes de usar la balanza del laboratorio).",
            "Identificación del Estado de Calibración: Etiquetas físicas, códigos de colores o precintos sobre el instrumento que le indiquen visualmente al usuario si está apto para uso o vencido.",
            "Registro de Evaluación de Impacto (Análisis de desvío): Si un equipo se encuentra descalibrado, la empresa debe documentar un análisis de qué productos se midieron con ese equipo defectuoso y si es necesario recuperarlos o alertar al cliente."
          ]
        },
        {
          title: "3. Requisito 9.1.1: Generalidades (Seguimiento, medición, análisis y evaluación)",
          desc: "La organización debe determinar qué es necesario medir, los métodos de seguimiento, cuándo se deben llevar a cabo y cuándo se deben analizar los resultados para asegurar procesos válidos.",
          evidence: [
            "Matriz de Control o Plan de Control de Mediciones: Documento que defina los puntos críticos de control de las líneas de producción/servicio, especificando qué variable medir, con qué método y cada cuánto tiempo.",
            "Procedimientos o Instructivos de Ensayo/Medición: Guías documentadas sobre cómo el operario o laboratorista debe tomar la muestra y realizar la medición para evitar el error humano."
          ]
        },
        {
          title: "4. Requisito 9.1.3: Análisis y evaluación",
          desc: "Los resultados obtenidos de las mediciones deben ser analizados para evaluar la conformidad de los productos, el desempeño de los procesos y la eficacia del SGC.",
          evidence: [
            "Informes de Control Estadístico de Procesos (CEP / SPC): Gráficos de control (X-barra, R) que demuestren el comportamiento de los procesos de medición a lo largo del tiempo.",
            "Estudios de Capacidad del Proceso (Cp y Cpk): Análisis matemáticos que evalúen si el proceso de producción y su medición son capaces de mantenerse dentro de las tolerancias exigidas por el cliente."
          ]
        }
      ]
    };
  }

  if (name.includes('mantenimiento')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Requisito 7.1.3",
        "Requisito 7.1.4",
        "Requisito 8.5.1",
        "Requisito 7.1.5"
      ],
      deliverables: [
        {
          title: "Requisito 7.1.3: Infraestructura (El núcleo de Mantenimiento)",
          desc: "La organización debe determinar, proporcionar y mantener la infraestructura necesaria para la operación de sus procesos y lograr la conformidad de los productos y servicios (incluye edificios, servicios asociados como agua/gas/electricidad, maquinaria, herramientas y tecnologías de información).",
          evidence: [
            "Listado Maestro de Equipos / Inventario de Infraestructura: Registro de todas las máquinas de producción, instalaciones edilicias y servicios críticos (ej: compresores de aire, subestaciones eléctricas, calderas, chillers).",
            "Ficha Técnica u Hoja de Vida de los Equipos: Historial de cada máquina (fecha de compra, especificaciones, modificaciones y reparaciones mayores).",
            "Plan o Programa Anual de Mantenimiento Preventivo (PMP): Calendario estructurado donde se planifiquen las paradas y revisiones de cada equipo a lo largo del año.",
            "Registros de Ejecución de Mantenimiento Preventivo: Checklists, órdenes de trabajo (OT) cerradas y firmadas por los técnicos que demuestren que las tareas planificadas realmente se hicieron.",
            "Gestión de Mantenimiento Correctivo: Registro de las roturas inesperadas (OT de emergencia) y el análisis de por qué ocurrió la falla para evitar que se repita.",
            "Control de Repuestos Críticos (Stock de Pañol): Evidencia de que el área controla el inventario de piezas clave para que una máquina no quede parada semanas por falta de un repuesto."
          ]
        },
        {
          title: "Requisito 7.1.4: Ambiente para la operación de los procesos",
          desc: "La organización debe determinar, proporcionar y mantener el ambiente necesario (factores físicos como temperatura, humedad, iluminación, circulación de aire, higiene y ruido) cuando estos afecten la conformidad del producto.",
          evidence: [
            "Registros de Mantenimiento de Sistemas Críticos de Ambiente: Mantenimiento preventivo y limpieza de sistemas de climatización (HVAC), extractores de polvo, sistemas de filtrado de aire o campanas extractoras.",
            "Plan de Mantenimiento Edilicio: Pintura, reparación de techos (evitar goteras en depósitos o líneas), mantenimiento de luminarias (mediciones de luxes si aplica) y control de redes de agua."
          ]
        },
        {
          title: "Requisito 8.5.1: Control de la producción y de la provisión del servicio (Ítem d)",
          desc: "Las condiciones controladas de producción deben incluir la utilización de la infraestructura y el entorno adecuados para la operación de los procesos.",
          evidence: [
            "Indicadores de Gestión de Mantenimiento (KPIs): Datos que demuestren que la dirección evalúa el desempeño del área. Los más comunes son:",
            "  - % de Cumplimiento del Plan Preventivo (cuántas tareas planificadas se hicieron a tiempo).",
            "  - MTBF (Tiempo Medio Entre Fallas - mide la confiabilidad).",
            "  - MTTR (Tiempo Medio de Reparación - mide la velocidad de respuesta).",
            "  - Disponibilidad de Planta (% de tiempo que las máquinas estuvieron aptas para producir)."
          ]
        },
        {
          title: "Requisito 7.1.5: Recursos de seguimiento y medición (Herramientas de Mantenimiento)",
          desc: "Si los técnicos de mantenimiento usan instrumentos propios para validar que una máquina quedó bien (ej: multímetros para tableros eléctricos, torquímetros para ajustar piezas críticas, analizadores de vibración), esos equipos también deben controlarse.",
          evidence: [
            "Certificados de Calibración de herramientas de mantenimiento: Evidencia de que los instrumentos de medición del taller de mantenimiento están controlados y vigentes."
          ]
        }
      ]
    };
  }

  if (name.includes('comercialización') || name.includes('comercializacion') || name.includes('ventas') || name.includes('pedidos')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Cláusula 8.2 \"Requisitos para los productos y servicios\""
      ],
      deliverables: [
        {
          title: "1. Requisito 8.2.1: Comunicación con los clientes",
          desc: "La organización debe establecer una comunicación clara con los clientes que incluya proporcionar información sobre los productos/servicios, atender consultas, contratos o pedidos (incluyendo cambios), y obtener retroalimentación (incluyendo las quejas).",
          evidence: [
            "Fichas Técnicas, Catálogos o Tarifarios vigentes: Información oficial y actualizada que se le entrega al cliente para que conozca el alcance de lo que compra.",
            "Canales formales de consulta: Evidencia de cómo se reciben y canalizan los pedidos (emails, portales de clientes, CRM).",
            "Registro de Reclamos / Quejas de Clientes: Sistema de recepción de quejas (aunque QA los investigue, Comercial suele ser la puerta de entrada de la insatisfacción)."
          ]
        },
        {
          title: "2. Requisito 8.2.2: Determinación de los requisitos para los productos y servicios",
          desc: "Al definir qué se va a vender, la empresa debe asegurarse de que los requisitos queden claros, incluyendo los establecidos por el cliente, los que la empresa considere necesarios, los legales/reglamentarios aplicables y que tiene la capacidad de cumplir con los compromisos declarados.",
          evidence: [
            "Formularios de Solicitud de Cotización / Brief del Cliente: Documentos donde el vendedor anota exactamente qué necesita el cliente (dimensiones, plazos, normativas específicas).",
            "Análisis de Requisitos Legales: Evidencia de que el área comercial conoce las leyes o normativas comerciales/técnicas que aplican al producto antes de cotizarlo."
          ]
        },
        {
          title: "3. Requisito 8.2.3: Revisión de los requisitos para los productos y servicios (Revisión del Contrato)",
          desc: "Este es el punto más crítico para el auditor en esta área. La empresa debe revisar los requisitos antes de comprometerse a suministrar un producto o servicio (antes de firmar un contrato o aceptar una Orden de Compra). Debe confirmar que tiene capacidad técnica, operativa y financiera.",
          evidence: [
            "Evidencia de la Revisión de la Oferta (Factibilidad): Registro (firmas, correos o aprobaciones en sistema ERP) donde las áreas técnicas o de producción dieron el \"visto bueno\" a una cotización antes de enviarla al cliente.",
            "Aprobación de Órdenes de Compra (OC): Constancia de que el área comercial contrastó la Orden de Compra enviada por el cliente contra la cotización original para verificar que los precios, cantidades y plazos coincidan plenamente.",
            "Registros de diferencias resueltas: Si el cliente envió una OC con condiciones distintas a las cotizadas, debe haber evidencia de cómo se negoció y resolvió esa diferencia antes de aceptarla."
          ]
        },
        {
          title: "4. Requisito 8.2.4: Cambios en los requisitos para los productos y servicios",
          desc: "Si el cliente cambia de opinión y modifica el pedido a mitad de camino, la organización debe asegurarse de que la información documentada sea modificada y que el personal pertinente sea advertido.",
          evidence: [
            "Notas de Pedido Modificadas o Adendas de Contratos: Documentación del nuevo acuerdo.",
            "Notificaciones de Cambio Internas: Correos electrónicos, alertas del sistema o minutas donde el vendedor avisa formalmente a Producción, Compras o Diseño sobre el cambio del cliente para evitar que se fabrique la versión vieja."
          ]
        }
      ]
    };
  }

  if (name.includes('contexto') || name.includes('partes interesadas') || name.includes('riesgos') || name.includes('oportunidades')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "REQUERIMIENTO 4.1",
        "REQUERIMIENTO 4.2",
        "REQUERIMIENTO 6.1"
      ],
      deliverables: [
        {
          title: "1. Análisis de Contexto de la Organización (Cláusula 4.1)",
          desc: "El objetivo de la auditoría interna aquí es verificar que la dirección comprende las fuerzas externas e internas que pueden afectar el rumbo estratégico y los resultados del Sistema de Gestión de la Calidad (SGC).",
          evidence: [
            "Matriz FODA / PESTEL Institucional: Documento vigente que analice los factores políticos, económicos, sociales, tecnológicos, ecológicos y legales (PESTEL), junto con las fortalezas y debilidades internas.",
            "Acta de Revisión por la Dirección: Documento firmado que demuestre que la alta dirección revisó y actualizó este análisis de contexto en el último período (mínimo una vez al año).",
            "Evidencia de Comunicación: Registros (correos, minutas de capacitación o inducción) que demuestren que el contexto es conocido por los líderes de proceso clave."
          ]
        },
        {
          title: "2. Comprensión de las Necesidades y Expectativas de las Partes Interesadas (Cláusula 4.2)",
          desc: "La organización debe demostrar que no solo vive para el cliente, sino que reconoce a todos los actores que afectan o se ven afectados por su operación.",
          evidence: [
            "Matriz de Partes Interesadas Global: Un cuadro corporativo que identifique: Clientes, Proveedores, Accionistas, Empleados, Entidades Reguladoras, Comunidad. Requisitos: Qué exige cada uno (ej. los accionistas exigen rentabilidad; el gobierno, cumplimiento fiscal y laboral). Mecanismo de Seguimiento: Cómo la empresa se asegura de cumplir con esas expectativas (ej. auditorías legales, encuestas de clima, etc.).",
            "Matriz de Requisitos Legales: Un compendio actualizado de las leyes y normativas aplicables al negocio (laborales, ambientales, fiscales, de producto) y el estado de cumplimiento de la empresa."
          ]
        },
        {
          title: "3. Gestión de Riesgos y Oportunidades Globales (Cláusula 6.1)",
          desc: "En una auditoría global, se busca el \"enfoque de procesos\". El auditor interno debe verificar que la gestión de riesgos no es un papel estático, sino una herramienta de toma de decisiones.",
          evidence: [
            "Procedimiento de Gestión de Riesgos: Documento que defina la metodología oficial de la empresa (ej. si usan la norma ISO 31000, cómo calculan el impacto y la probabilidad, y qué niveles de riesgo requieren acción obligatoria).",
            "Matriz de Riesgos and Oportunidades por Proceso: Un mapa de riesgos corporativo o matrices individuales para cada área (Ventas, Compras, Operaciones, RRHH, etc.) que contengan: Identificación del riesgo u oportunidad; Evaluación inicial (Probabilidad x Impacto); Controles actuales implementados.",
            "Planes de Tratamiento de Riesgos: Planes de acción específicos para aquellos riesgos que salieron en niveles intolerables (Altos/Críticos). Debe incluir responsables, recursos y fechas.",
            "Evaluación de la Eficacia de las Acciones: Registros que demuestren que los líderes de proceso volvieron a evaluar el riesgo meses después para verificar si las acciones implementadas realmente funcionaron."
          ]
        }
      ]
    };
  }

  if (name.includes('posventa') || name.includes('postventa') || name.includes('garantía') || name.includes('garantia')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Requisito 8.2.1",
        "Requisito 8.5",
        "Requisito 9.1.2",
        "Requisito 10.2"
      ],
      deliverables: [
        {
          title: "1. Posteriores a la Entrega (Cláusula 8.5.5)",
          desc: "Este es el \"corazón\" de la posventa en ISO 9001. Exige que la organización determine y cumpla con el alcance de las actividades de posventa considerando: requisitos legales, consecuencias no deseadas del producto/servicio, su naturaleza y la retroalimentación del cliente.",
          evidence: [
            "Política o Términos de Garantía: Documento claro donde se definan las condiciones, coberturas y tiempos de la garantía de los productos o servicios.",
            "SLA (Service Level Agreements) o Acuerdos de Nivel de Servicio: Tiempos de respuesta comprometidos con el cliente (ej. tiempo de respuesta menor a 24 horas).",
            "Manuales de Mantenimiento y Soporte: Guías provistas al cliente para el uso correcto o mantenimiento preventivo.",
            "Órdenes de Servicio o Registros de Asistencia Técnica: Evidencia de los mantenimientos, reparaciones o soportes brindados (físicos o en software/CRM)."
          ]
        },
        {
          title: "2. Comunicación con el Cliente y Gestión de Reclamos (Cláusulas 8.2.1 y 10.2)",
          desc: "La norma exige canales claros para comunicarse con el cliente, especialmente para obtener retroalimentación y gestionar las quejas o reclamos de manera eficaz.",
          evidence: [
            "Procedimiento de Gestión de Reclamos y Quejas: Flujograma o documento que explique cómo se recibe, investiga y resuelve una inconformidad.",
            "Matriz o Registro de Peticiones, Quejas, Reclamos y Sugerencias (PQRS): Base de datos (o módulo de software) que rastree el estado de cada caso (Abierto, En proceso, Cerrado).",
            "Informes de Análisis de Causa Raíz: Para reclamos graves o repetitivos, se deben presentar metodologías (como los 5 Porqués o Diagrama de Ishikawa) que demuestren que se buscó el origen del problema.",
            "Planes de Acción Correctiva: Evidencia de las acciones tomadas para que el problema no vuelva a ocurrir."
          ]
        },
        {
          title: "3. Satisfacción del Cliente (Cláusula 9.1.2)",
          desc: "Posventa suele ser el área encargada de medir qué tan contentos están los clientes con el producto o servicio recibido. La norma exige realizar este seguimiento y analizar los datos.",
          evidence: [
            "Herramientas de Medición: Diseño de encuestas de satisfacción, encuestas NPS (Net Promoter Score) o llamadas de seguimiento posventa.",
            "Informes de Satisfacción del Cliente: Análisis estadístico y consolidado de los resultados de las mediciones (gráficos, porcentajes de cumplimiento).",
            "Minutas de Reuniones de Revisión: Evidencia de que los resultados de satisfacción se compartieron con la alta dirección para tomar decisiones."
          ]
        },
        {
          title: "4. Control de la Prestación del Servicio Posventa (Cláusula 8.5.1)",
          desc: "El servicio técnico o de soporte posventa debe ejecutarse bajo condiciones controladas. Esto significa que el personal debe saber qué hacer y contar con las herramientas adecuadas.",
          evidence: [
            "Hojas de Ruta o Protocolos de Servicio: Guías paso a paso de cómo el personal de soporte debe atender un problema técnico.",
            "Matriz de Competencias del Personal: Evidencia de que los técnicos o agentes de servicio posventa están capacitados para el puesto (certificaciones, cursos).",
            "Registros de Calibración / Mantenimiento de Equipos: Si el área utiliza herramientas de medición o software específico para el diagnóstico, se debe demostrar que están calibrados o actualizados."
          ]
        },
        {
          title: "5. Control de Cambios en el Servicio (Cláusula 8.5.6)",
          desc: "Si durante el soporte posventa se detecta que hay que modificar la forma en que se presta el servicio (por ejemplo, cambiar un componente por otro mejorado o modificar un contrato de soporte), esto debe controlarse.",
          evidence: [
            "Registro de Control de Cambios: Documento que valide quién autorizó el cambio en el servicio, por qué se hizo y qué impacto tuvo.",
            "Resumen de Indicadores (KPIs) sugeridos para la Auditoría: Tiempo Promedio de Resolución (MTTR), Índice de Satisfacción Posventa (CSAT / NPS), Tasa de Reincidencia."
          ]
        }
      ]
    };
  }

  if (name.includes('compras') || name.includes('proveedores')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Requisito 8.4: Control de los procesos, productos y servicios suministrados externamente"
      ],
      deliverables: [
        {
          title: "1. Evaluación, Selección y Reevaluación de Proveedores (Cláusula 8.4.1)",
          desc: "La norma exige que la organización determine y aplique criterios para evaluar, seleccionar, hacer seguimiento al desempeño y reevaluar a los proveedores externos. No puedes comprarle a cualquiera \"a ciegas\".",
          evidence: [
            "Procedimiento de Compras y Evaluación de Proveedores: El documento que explica el \"cómo se hace\" (desde que nace la necesidad hasta que se evalúa al proveedor).",
            "Criterios de Evaluación y Selección: Documento donde se define qué requisitos debe cumplir un proveedor para ser aceptado (ej. capacidad técnica, estabilidad financiera, certificaciones, precio, tiempos de entrega).",
            "Listado de Proveedores Aprobados (LPA): El catálogo oficial de los proveedores que pasaron el filtro y están autorizados para venderle a la empresa.",
            "Evaluaciones de Desempeño Periódicas: Registros (habitualmente semestrales o anuales) donde calificas si tus proveedores actuales cumplieron con lo prometido.",
            "Planes de Acción para Proveedores con Baja Calificación: Si un proveedor crítico sale reprobado, debes mostrar la carta o correo donde le exiges mejoras, o la evidencia de que fue suspendido."
          ]
        },
        {
          title: "2. Información para los Proveedores / Órdenes de Compra (Cláusula 8.4.3)",
          desc: "La norma exige que la comunicación con el proveedor sea clara, explícita y completa. El proveedor debe saber exactamente qué se le está pidiendo antes de fabricarlo o enviarlo.",
          evidence: [
            "Órdenes de Compra (OC) o Contratos Formales: Documentos que contengan especificaciones claras: códigos de producto, cantidades, precios, fechas y lugares de entrega, y requisitos de calidad (ej. \"Debe entregarse con certificado de análisis\").",
            "Fichas Técnicas o Planos Compartidos: Evidencia de que se le enviaron los requerimientos técnicos necesarios al proveedor para que no haya errores de interpretación."
          ]
        },
        {
          title: "3. Tipo y Alcance del Control / Verificación de lo Comprado (Cláusula 8.4.2)",
          desc: "No basta con pedir bien; hay que revisar que lo que llega sea lo correcto. La norma exige que la empresa asegure que los productos o servicios externos no afecten la capacidad de entregar conformidad a sus propios clientes.",
          evidence: [
            "Registros de Control de Recepción: Albaranes, remitos o registros en el sistema (ERP) firmados por el almacén o el usuario solicitante, donde se valide que lo recibido coincide en cantidad y calidad con la Orden de Compra.",
            "Certificados de Calidad / Conformidad del Proveedor: Para materiales críticos, el documento emitido por el proveedor que avala que el lote cumple con las normas.",
            "Protocolo de Devoluciones o Producto No Conforme: Registro de qué haces cuando un proveedor entrega algo defectuoso (notas de crédito, registros de rechazo en almacén)."
          ]
        }
      ]
    };
  }

  if (name.includes('recursos humanos') || name.includes('rrhh') || name.includes('personal') || name.includes('capacitación') || name.includes('capacitacion') || name.includes('competencia')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "7.1.2 Personas (Provisión de personal)",
        "7.2 Competencia (Educación, formación y experiencia)",
        "7.3 Toma de conciencia (Políticas, objetivos y SGC)"
      ],
      deliverables: [
        {
          title: "Requisito 7.1.2: Personas & Requisito 7.2: Competencia",
          desc: "La organización debe determinar y proporcionar las personas necesarias para la implementación eficaz de su SGC. Además, debe determinar la competencia necesaria del personal, asegurarse de que sean competentes basándose en la educación, formación o experiencia adecuadas y tomar acciones para adquirir la competencia necesaria cuando aplique.",
          evidence: [
            "Organigrama institucional actualizado y aprobado.",
            "Manual de Perfiles de Puesto (o Descriptivos de Cargo) que detallen claramente los requisitos de Educación, Formación, Experiencia y Habilidades para cada rol.",
            "Legajos de los empleados (Muestra seleccionada) que incluyan: Títulos, certificados de cursos, CVs firmados y constancias de experiencia laboral.",
            "Plan o Programa Anual de Capacitación/Formación.",
            "Registros de las capacitaciones ejecutadas (listas de asistencia, evaluaciones de eficacia, material entregado)."
          ]
        },
        {
          title: "Requisito 7.3: Toma de Conciencia",
          desc: "La organización debe asegurarse de que las personas que realizan el trabajo bajo el control de la organización tomen conciencia de la Política de Calidad, los Objetivos de Calidad pertinentes, su contribución a la eficacia del SGC y las implicaciones del incumplimiento de los requisitos.",
          evidence: [
            "Plan de inducción para personal nuevo (donde se incluyan temas del SGC).",
            "Evidencias de campañas de comunicación interna (folletos, correos, reuniones, protectores de pantalla con la Política de Calidad).",
            "Evaluaciones o encuestas de toma de conciencia realizadas al personal operativo/administrativo."
          ]
        }
      ]
    };
  }

  if (name.includes('dirección') || name.includes('direccion') || name.includes('revisión por la dirección') || name.includes('revision por la direccion')) {
    return {
      objective: "Determinar si la gestión del proceso auditado es conforme a los requisitos establecidos, se han implementado y se mantiene eficazmente acorde a lo definido en SGC y a los requerimientos de la norma ISO 9001.",
      clauses: [
        "Requisito 9.3.1: Generalidades",
        "Requisito 9.3.2: Entradas de la Revisión por la Dirección",
        "Requisito 9.3.3: Salidas de la Revisión por la Dirección (Outputs)"
      ],
      deliverables: [
        {
          title: "1. Requisito 9.3.1: Generalidades",
          desc: "La Alta Dirección debe revisar el Sistema de Gestión de la Calidad (SGC) a intervalos planificados para asegurarse de su conveniencia, adecuación, eficacia y alineación continua con la dirección estratégica.",
          evidence: [
            "Cronograma o Planificación Anual: Evidencia de que la reunión estaba planificada (ej. calendario anual de comité, plan de auditorías/revisiones).",
            "Convocatoria y Agenda de Trabajo: Documento formal enviado a los participantes (Alta Dirección y líderes de procesos) con el orden del día.",
            "Registro de Asistencia: Evidencia de la participación activa de la dirección (Gerente General, Directores, etc.)."
          ]
        },
        {
          title: "2. Requisito 9.3.2: Entradas de la Revisión por la Dirección (Inputs)",
          desc: "Este es el punto más crítico para el auditor. La norma exige que la revisión se planifique y se lleve a cabo incluyendo información sobre 7 puntos obligatorios. Como auditor, debes verificar que se presentó un informe o análisis detallado de cada uno de ellos:",
          evidence: [
            "Requisito A: El estado de las acciones de las revisiones por la dirección previas. -> Entregable: Matriz de seguimiento de acuerdos de la reunión anterior donde se vea qué tareas se cerraron y cuáles siguen pendientes.",
            "Requisito B: Los cambios en las cuestiones externas e internas que son pertinentes al SGC. -> Entregable: Matriz FODA, PESTEL o análisis de contexto actualizado; revisión de nuevas necesidades de las partes interesadas.",
            "Requisito C: La información sobre el desempeño y la eficacia del SGC, incluyendo las tendencias relativas a: \n- Satisfacción del cliente y retroalimentación de partes interesadas relevantes (Entregable: Informes de encuestas, quejas, felicitaciones).\n- El grado en que se han logrado los Objetivos de Calidad (Entregable: Tablero de indicadores/KPIs con las metas vs. lo alcanzado).\n- El desempeño de los procesos y conformidad de los productos/servicios (Entregable: Informes de calidad, reportes de mermas, niveles de servicio).\n- No conformidades y acciones correctivas (Entregable: Estado y cierre de desvíos detectados en el periodo).\n- Resultados de seguimiento y medición (Entregable: Calibraciones, controles operativos).\n- Resultados de las auditorías (Entregable: Informes de auditorías internas, de certificación o de clientes).\n- El desempeño de los proveedores externos (Entregable: Evaluaciones de desempeño de proveedores clave).",
            "Requisito D: La adecuación de los recursos. -> Entregable: Reporte o minuta donde se haya discutido si el personal, la infraestructura, la tecnología y el presupuesto son suficientes para el SGC.",
            "Requisito E: La eficacia de las acciones tomadas para abordar los riesgos y las oportunidades. -> Entregable: Matriz de Riesgos revisada y análisis de si los controles implementados funcionaron o si surgieron nuevos riesgos.",
            "Requisito F: Las oportunidades de mejora. -> Entregable: Propuestas formales presentadas por los líderes de proceso para optimizar el sistema."
          ]
        },
        {
          title: "3. Requisito 9.3.3: Salidas de la Revisión por la Dirección (Outputs)",
          desc: "La norma establece que las salidas de este proceso deben incluir cualquier decisión y acción vinculada a oportunidades de mejora, necesidades de cambio en el SGC y necesidades de recursos.",
          evidence: [
            "Acta o Informe Final de la Revisión por la Dirección: Es el documento madre. Debe estar firmado por la Alta Dirección y contener de forma explícita las conclusiones del desempeño del SGC.",
            "Plan de Acción Derivado: Una lista o matriz de compromisos donde cada decisión tomada tenga asignado: Qué se va a hacer, quién es el responsable de ejecutarlo y cuál es la fecha límite de cumplimiento.",
            "Asignación de Recursos Documentada: Evidencia de aprobación de presupuestos, compras de maquinaria o contratación de personal que la dirección haya decidido durante la revisión para mejorar el SGC."
          ]
        }
      ]
    };
  }

  return {
    objective: "Evaluar la conformidad de las actividades y procesos de la organización con los requisitos establecidos por la norma ISO 9001 y las directrices internas definidas por el SGC.",
    clauses: [
      "Cláusula 9.2 Auditoría interna",
      "  9.2.1 Planificación de auditorías",
      "  9.2.2 Programa de auditoría y realización de informes"
    ],
    deliverables: [
      {
        title: "9.2: Programa y Ejecución de Auditorías",
        desc: "La organización debe planificar, establecer, implementar y mantener uno o varios programas de auditoría que incluyan la frecuencia, los métodos, las responsabilidades y la presentación de informes.",
        evidence: [
          "Programa Anual de Auditorías Internas aprobado.",
          "Plan de auditoría específico enviado a los auditados con anticipación.",
          "Lista de verificación (checklist) utilizada por el auditor interno durante las entrevistas.",
          "Informe final de auditoría con la identificación de fortalezas y hallazgos."
        ]
      }
    ]
  };
}

export function getAuditConclusionDefault(taskName: string): string {
  const processName = getAuditProcessName(taskName);
  return `La auditoría realizada al proceso ${processName} del Sistema de Gestión de la Calidad de la organización, bajo los criterios de ISO 9001:2015 y requisitos legales aplicables, permitió verificar que los procesos auditados cumplen/no cumplen en gran medida con los criterios establecidos. Se identificaron [número] no conformidades menores relacionadas con [tema], que no comprometen la eficacia global del sistema pero requieren acciones correctivas. Asimismo, se observaron oportunidades de mejora en [áreas específicas], cuya implementación fortalecerá la capacidad del sistema para alcanzar los resultados previstos. En conclusión, el sistema es conforme y eficaz dentro del alcance auditado, sujeto a la corrección de las no conformidades detectadas.`;
}

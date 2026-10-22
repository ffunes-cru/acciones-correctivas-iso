import React, { useState } from 'react';
import { collection, serverTimestamp, doc, runTransaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, ChangeRequest, AreaQuestion } from '../types';
import { useNavigate } from 'react-router-dom';
import { 
  Send, ArrowLeft, Loader2, RefreshCw, ClipboardList, 
  HelpCircle, AlertCircle, FileText, CheckCircle 
} from 'lucide-react';
import { motion } from 'motion/react';
import { sendNotification } from '../services/notificationService';

const MISSIONS = ['Seguridad y Medio Ambiente', 'Productividad', 'Calidad', 'Costos', 'Otros'];

// Checklist definitions for each area
const INGENIERIA_QUESTIONS = [
  "Planos",
  "Esquemas de armado/montaje/instructivos",
  "Layout",
  "Matrices",
  "Planes de mantenimiento de matricería",
  "Planes de control",
  "¿Es necesario comprar algún equipo, herramienta o pasa/no pasa?",
  "¿Es necesario actualizar la estructura en TC/SAP?",
  "¿Hay que agregar algún nuevo equipo o instrumento al listado de metrología?",
  "¿Es necesario actualizar takt time?",
  "¿Se necesita capacitar al personal?",
  "¿Es necesario definir nuevos medios de abastecimiento?",
  "¿Es necesario crear/actualizar tarjetas Kanban?"
];

const PRODUCCION_QUESTIONS = [
  "¿La capacidad de la planta se ve afectada?",
  "¿Hay limitaciones de cantidad de operadores?",
  "¿El personal está capacitado para este cambio?",
  "¿Hay alguna planilla de control de procesos que debería implementarse/actualizarse?",
  "¿El flujo de trabajo se ve afectado?",
  "¿Hay algún KPI que necesite crearse o actualizarse?",
  "¿Hay algún cambio en la forma de declarar producción?",
  "¿Hay algún cambio en el mix semanal?",
  "¿Impacta en la forma de planificar la producción?"
];

const MANTENIMIENTO_QUESTIONS = [
  "¿Es necesario crear nuevos tag de equipos?",
  "¿Es necesario crear/actualizar nuevos planes de mantenimiento preventivo?",
  "¿Es necesario comprar repuestos para nuevos equipos?",
  "¿Es necesario disponer de manual de usuario y/o de reparaciones?",
  "¿Es necesario capacitar al personal para atender algún nuevo equipo/instrumento?",
  "¿Hay algún nuevo instrumento que tenga que ser agregado al programa de calibración?",
  "¿Es necesario actualizar algún otro documento asociado?",
  "¿Es necesario realizar alguna modificación de las utilidades?",
  "¿Es necesario instalar algún nuevo equipo?"
];

const CALIDAD_QUESTIONS = [
  "¿El cambio involucra la inclusión de un nuevo proveedor?",
  "¿Es necesario agregar/actualizar un plan de control especial para materias primas?",
  "¿Es necesario actualizar el procedimiento de control de muro intermedio?",
  "¿Es necesario actualizar el procedimiento de control de muro final?",
  "¿Hay algún nuevo instrumento de medición requerido?",
  "¿Es necesario actualizar el plan de calibraciones?",
  "¿Es necesario actualizar algún otro documento asociado?",
  "¿Se prevén nuevos desvíos o no conformidades?"
];

const SUPPLY_CHAIN_QUESTIONS = [
  "¿Necesitan crearse nuevos códigos?",
  "¿Hay que actualizar contrato marco?",
  "¿Está definida la forma de abastecimiento?",
  "¿Hay que actualizar datos en el maestro de materiales de algún código en SAP?",
  "¿Es necesario hacer una auditoría o enviar autoevaluación a algún proveedor?",
  "¿Hay algún código que necesita ser borrado en SAP?",
  "¿Hay impacto en costos?",
  "¿Están listas las especificaciones para compra de nuevos materiales?",
  "¿El cambio afecta las condiciones de almacenamiento / abastecimiento a planta?",
  "¿Es necesario cambiar/actualizar el recorrido de abastecimiento en planta?",
  "¿Es necesario actualizar el formulario de gestión de riesgos?"
];

const HSE_QUESTIONS = [
  "¿El cambio introduce nuevos peligros (químicos, mecánicos, eléctricos, ergonómicos) o modifica el nivel de riesgo de peligros existentes?",
  "¿Se requiere nuevo Equipo de Protección Personal (EPP) o la modificación/instalación de protecciones, sistemas LOTO (Bloqueo y Etiquetado) o paradas de emergencia?",
  "¿El cambio modifica la generación/gestión de residuos (tipo, volumen), el consumo de energía/agua, las emisiones (aire) o los efluentes (agua)?",
  "¿Este cambio impacta algún requisito legal o requiere actualizar permisos, licencias o estudios ante la autoridad competente?",
  "¿Es necesario capacitar al personal?"
];

const INFRAESTRUCTURA_QUESTIONS = [
  "¿Son necesarios nuevos escritorios?",
  "¿Se necesita nuevo cableado de red/electricidad para los nuevos puestos?",
  "¿Habrá nuevos puestos de trabajo en la planta?",
  "¿Son necesarias nuevas PC tanto para planta como para puestos administrativos?",
  "¿Es necesario trasladar equipamiento? ¿Hay espacio suficiente?",
  "¿Se requieren elementos de izaje?"
];

const RRHH_QUESTIONS = [
  "¿Es necesario actualizar el organigrama?",
  "¿Es necesario actualizar perfiles de puesto?",
  "¿Hay que hacer evaluación de competencias?",
  "¿Es necesario actualizar sistema de fichaje?",
  "¿Es necesario actualizar base de datos de personal?",
  "¿Es necesario hacer ajuste salarial?",
  "¿Es necesario adecuar el plan de capacitación?",
  "¿Hay que actualizar matriz de polivalencia?",
  "¿Es necesario realizar alguna comunicación especial: ej. desvinculación, cambio de puestos, etc.?",
  "¿Es necesario incorporar personal?",
  "¿El cambio tiene algún impacto legal?",
  "¿El cambio tiene algún impacto en el convenio colectivo de trabajo?",
  "¿Es necesaria alguna comunicación especial al sindicato?"
];

const mapQuestions = (list: string[]): AreaQuestion[] => {
  return list.map((q, idx) => ({
    id: `q-${idx}`,
    question: q,
    applies: '',
    requiresAction: ''
  }));
};

export default function NewChangeRequest({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    company: '',
    description: '',
    objective: '',
    mission: 'Calidad' as any,
    currentSituation: '',
    proposedSituation: '',
    impactAnalysis: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validations
    if (!formData.title.trim()) {
      alert('Por favor ingrese el título de la solicitud.');
      return;
    }
    if (!formData.company) {
      alert('Por favor seleccione la empresa.');
      return;
    }
    if (!formData.description.trim()) {
      alert('Por favor ingrese la descripción de la propuesta.');
      return;
    }
    if (!formData.objective.trim()) {
      alert('Por favor ingrese el objetivo del cambio.');
      return;
    }
    if (!formData.currentSituation.trim() || !formData.proposedSituation.trim()) {
      alert('Por favor complete el cuadro comparativo (Situación Actual y Propuesta).');
      return;
    }
    if (!formData.impactAnalysis.trim()) {
      alert('Por favor ingrese el análisis de impacto.');
      return;
    }

    setIsSubmitting(true);

    try {
      const counterRef = doc(db, 'config', 'counters');

      const result = await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        const counterData = counterDoc.exists() ? counterDoc.data() : {};
        
        let lastCRNumber = counterData.lastChangeRequestNumber || 0;
        const nextCRNumber = lastCRNumber + 1;

        const newRequestRef = doc(collection(db, 'change_requests'));

        // Prep reviews structure
        const reviews = {
          ingenieriaProcesos: { applies: false, status: 'pending', checklist: mapQuestions(INGENIERIA_QUESTIONS) },
          produccion: { applies: false, status: 'pending', checklist: mapQuestions(PRODUCCION_QUESTIONS) },
          mantenimiento: { applies: false, status: 'pending', checklist: mapQuestions(MANTENIMIENTO_QUESTIONS) },
          calidad: { applies: false, status: 'pending', checklist: mapQuestions(CALIDAD_QUESTIONS) },
          supplyChain: { applies: false, status: 'pending', checklist: mapQuestions(SUPPLY_CHAIN_QUESTIONS) },
          hse: { applies: false, status: 'pending', checklist: mapQuestions(HSE_QUESTIONS) },
          infraestructura: { applies: false, status: 'pending', checklist: mapQuestions(INFRAESTRUCTURA_QUESTIONS) },
          recursosHumanos: { applies: false, status: 'pending', checklist: mapQuestions(RRHH_QUESTIONS) }
        };

        const changeData = {
          changeNumber: nextCRNumber,
          title: formData.title.trim(),
          company: formData.company,
          description: formData.description.trim(),
          objective: formData.objective.trim(),
          mission: formData.mission,
          currentSituation: formData.currentSituation.trim(),
          proposedSituation: formData.proposedSituation.trim(),
          impactAnalysis: formData.impactAnalysis.trim(),
          creatorId: user.id,
          creatorEmail: user.email,
          creatorName: user.displayName || user.email,
          status: 'draft',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          reviews
        };

        // Write the new ChangeRequest document
        transaction.set(newRequestRef, changeData);

        // Update the global counters
        transaction.update(counterRef, {
          lastChangeRequestNumber: nextCRNumber
        });

        return { id: newRequestRef.id, changeNumber: nextCRNumber };
      });

      console.log('Change Request created successfully:', result);

      // Trigger automatic email notification to creator as requested:
      // "La app deberá enviar un mail al dueño del cambio notificando acerca de la creación de solicitud exitosa."
      const mailSubject = `[Crucianelli Calidad] Solicitud de Cambio Creada Exitosamente - SC-#${result.changeNumber}`;
      const mailBody = `Hola ${user.displayName || user.email},

Tu solicitud de cambio "SC-#${result.changeNumber}: ${formData.title}" se ha creado con éxito en estado BORRADOR.

Próximos pasos:
Ingresá al portal para definir las áreas de revisión que aplican, asignar a los responsables correspondientes, establecer la fecha límite requerida y enviar la propuesta formal a revisión.

Enlace al cambio:
${window.location.origin}/change-request/${result.id}

Atentamente,
Portal de Gestión de Calidad • Crucianelli`;

      await sendNotification({
        to: user.email,
        subject: mailSubject,
        body: mailBody,
        type: 'creation'
      });

      // Navigate to the details page of the newly created Change Request
      navigate(`/change-request/${result.id}`);

    } catch (err) {
      console.error('Error creating change request:', err);
      alert('Error al crear la solicitud de cambio: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6" id="new-change-request-form-container">
      {/* Back button */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-semibold cursor-pointer w-fit"
      >
        <ArrowLeft size={16} />
        <span>Volver al Listado</span>
      </button>

      {/* Title */}
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">Solicitar Cambio</h1>
        <p className="text-slate-500 text-sm">
          Fase 1: Ingrese la información básica y el análisis inicial para registrar su propuesta de cambio.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info Card */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
            <ClipboardList className="text-emerald-600" size={20} />
            <h2 className="text-base font-bold text-slate-800 tracking-tight">Definición General</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-2 space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Título de la Propuesta *
              </label>
              <input
                type="text"
                name="title"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 font-medium placeholder-slate-400"
                placeholder="Ej. Modificación de plantilla de soldado en línea Fertec"
                value={formData.title}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Empresa *
              </label>
              <select
                name="company"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-700 font-semibold cursor-pointer"
                value={formData.company}
                onChange={handleChange}
              >
                <option value="">Seleccionar...</option>
                {['TMC', 'Fertec', 'Fabril', 'Leaf', 'Metallo'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Misión de la Propuesta *
              </label>
              <select
                name="mission"
                required
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-700 font-semibold cursor-pointer"
                value={formData.mission}
                onChange={handleChange}
              >
                {MISSIONS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Descripción de la Propuesta *
            </label>
            <textarea
              name="description"
              required
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 font-medium placeholder-slate-400 leading-relaxed"
              placeholder="Describa de forma clara y exhaustiva en qué consiste la modificación sugerida..."
              value={formData.description}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Objetivo del Cambio *
            </label>
            <textarea
              name="objective"
              required
              rows={2}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 font-medium placeholder-slate-400 leading-relaxed"
              placeholder="¿Qué mejoras concretas o soluciones se pretenden alcanzar mediante este cambio?..."
              value={formData.objective}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Comparison Table Card */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
            <FileText className="text-emerald-600" size={20} />
            <h2 className="text-base font-bold text-slate-800 tracking-tight">Cuadro Comparativo</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400"></span>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Situación Actual *
                </label>
              </div>
              <textarea
                name="currentSituation"
                required
                rows={5}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 font-medium placeholder-slate-400 leading-relaxed"
                placeholder="Describa el estado, proceso, herramental o diseño de partida..."
                value={formData.currentSituation}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Situación Propuesta *
                </label>
              </div>
              <textarea
                name="proposedSituation"
                required
                rows={5}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 font-medium placeholder-slate-400 leading-relaxed"
                placeholder="Describa el nuevo estado propuesto y cómo se ejecutará..."
                value={formData.proposedSituation}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        {/* Impact Analysis Card */}
        <div className="bg-white rounded-3xl border border-slate-100 p-6 sm:p-8 shadow-md space-y-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
            <HelpCircle className="text-emerald-600" size={20} />
            <h2 className="text-base font-bold text-slate-800 tracking-tight">Análisis de Impacto</h2>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Impacto sobre Medio Ambiente, Seguridad, Calidad, Productividad, etc. *
            </label>
            <textarea
              name="impactAnalysis"
              required
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-slate-800 font-medium placeholder-slate-400 leading-relaxed"
              placeholder="Describa y evalúe los impactos previstos en cada una de las variables clave de planta..."
              value={formData.impactAnalysis}
              onChange={handleChange}
            />
          </div>
        </div>

        {/* Submit Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all cursor-pointer text-sm disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Creando Solicitud...</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Crear Solicitud de Cambio</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

import React, { useState } from 'react';
import { UserProfile } from '../types';
import { 
  BookOpen, Printer, Search, ShieldAlert, Sparkles, 
  CalendarDays, ShieldCheck, RefreshCw, TrendingUp, Users, Lock, 
  ArrowLeft, Info, Loader2
} from 'lucide-react';
import { generateUserManualPDF } from '../utils/userManualPDF';

interface UserManualProps {
  user: UserProfile;
  onBack?: () => void;
}

export default function UserManual({ user, onBack }: UserManualProps) {
  const [activeTab, setActiveTab] = useState<string>('general');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Export complete User Manual directly to downloadable .pdf file
  const handleExportPdf = () => {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);

    try {
      generateUserManualPDF(user.displayName || user.email);
    } catch (err) {
      console.error("Error exportando a PDF:", err);
      window.print();
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const modules = [
    { id: 'general', title: 'Portal & Visión General', icon: Info, color: 'text-slate-600 bg-slate-100 border-slate-200' },
    { id: 'dashboard', title: '1. SGC Salud & Velocímetro', icon: TrendingUp, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { id: 'corrective', title: '2. Acciones Correctivas', icon: ShieldAlert, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { id: 'improvement', title: '3. Acciones de Mejora', icon: Sparkles, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { id: 'iso', title: '4. Planificación ISO', icon: CalendarDays, color: 'text-purple-600 bg-purple-50 border-purple-200' },
    { id: 'special_release', title: '5. Liberación Especial', icon: ShieldCheck, color: 'text-blue-700 bg-blue-50 border-blue-200' },
    { id: 'change_management', title: '6. Gestión de Cambios', icon: RefreshCw, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { id: 'users', title: '7. Usuarios & Roles', icon: Users, color: 'text-amber-600 bg-amber-50 border-amber-200' },
    { id: 'security', title: '8. Permisos & Seguridad', icon: Lock, color: 'text-rose-600 bg-rose-50 border-rose-200' },
  ];

  const matchesSearch = (text: string) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.toLowerCase());
  };

  return (
    <div className="space-y-8 font-sans pb-16">
      {/* Header Bar - Hidden during printing */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {onBack && (
                <button
                  onClick={onBack}
                  className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  title="Volver"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <BookOpen size={28} />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Manual de Usuario & Guía del Sistema
                </h1>
                <p className="text-slate-500 text-xs sm:text-sm font-normal mt-0.5">
                  Portal de Gestión de Calidad • Crucianelli S.A. / TMC (Versión 2.4)
                </p>
              </div>
            </div>
          </div>

          {/* Actions: Export PDF */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleExportPdf}
              disabled={isGeneratingPdf}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold text-xs sm:text-sm py-2.5 px-5 rounded-xl transition-all shadow-md shadow-indigo-100 cursor-pointer disabled:cursor-wait"
            >
              {isGeneratingPdf ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Printer size={18} />
              )}
              <span>{isGeneratingPdf ? 'Generando PDF...' : 'Exportar a PDF'}</span>
            </button>
          </div>
        </div>

        {/* Filter / Search bar */}
        <div className="mt-6 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-96">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar en el manual (ej: 5 porqués, roles, ISO)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>

          <div className="text-xs text-slate-400 font-medium">
            Mostrando: <span className="text-slate-700 font-bold">{modules.find(m => m.id === activeTab)?.title}</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {modules.map((mod) => {
            const Icon = mod.icon;
            const isActive = activeTab === mod.id;
            return (
              <button
                key={mod.id}
                onClick={() => setActiveTab(mod.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border ${
                  isActive
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon size={15} className={isActive ? 'text-white' : 'text-slate-500'} />
                <span>{mod.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* PRINT COVER HEADER (Only visible when printing) */}
      <div className="hidden print:block text-center border-b border-slate-300 pb-6 mb-8">
        <h1 className="text-3xl font-bold text-slate-900">MANUAL DE USUARIO Y GUÍA OPERATIVA DE SISTEMA</h1>
        <h2 className="text-xl font-semibold text-slate-700 mt-2">Portal de Gestión de Calidad (SGC) • Crucianelli S.A. / TMC</h2>
        <p className="text-sm text-slate-500 mt-2">Documentación Técnica Operativa • Control de Calidad e ISO 9001/14001/45001</p>
        <p className="text-xs text-slate-400 mt-1">Fecha de Emisión: {new Date().toLocaleDateString('es-AR')} • Versión 2.4</p>
      </div>

      {/* MANUAL CONTENTS */}
      <div id="full-user-manual-content" className="space-y-10">

        {/* SECTION 0: GENERAL & PORTAL */}
        {matchesSearch('portal general usuario google login') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'general' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-slate-100 text-slate-700 rounded-2xl">
                <Info size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Portal Unificado y Acceso al Sistema</h2>
                <p className="text-xs text-slate-500">Estructura general, inicio de sesión corporativo y arquitectura del portal</p>
              </div>
            </div>

            {/* Banner de Exportación a PDF de Manual Completo */}
            <div className="mb-8 p-4 sm:p-5 bg-gradient-to-r from-indigo-50/90 via-blue-50/80 to-purple-50/90 border border-indigo-100 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden shadow-xs">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-sm shrink-0">
                  <Printer size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Exportar Manual Completo a PDF</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Genera e imprime la documentación integral del sistema con todos los módulos y reglas operativas.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                <button
                  onClick={handleExportPdf}
                  disabled={isGeneratingPdf}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold text-xs sm:text-sm py-2.5 px-5 rounded-xl transition-all shadow-sm cursor-pointer disabled:cursor-wait"
                >
                  {isGeneratingPdf ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Printer size={16} />
                  )}
                  <span>{isGeneratingPdf ? 'Generando PDF...' : 'Exportar a PDF'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Garantizar un punto de acceso centralizado, seguro y auditable para todas las herramientas de gestión de calidad, cumplimiento normativo ISO y mejora continua pertenecientes al Grupo Crucianelli. El portal elimina la dispersión de datos y unifica los tableros operacionales.
                </p>
              </div>

              {/* 3. Roles y Responsabilidades */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-indigo-600 shrink-0">Administrador:</span>
                    <span>Gestión total de usuarios, parametrización de normas ISO, acceso a reportes y log de correos.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-slate-700 shrink-0">Editor / Responsable:</span>
                    <span>Carga de hallazgos, ejecución de 5 porqués y resolución de tareas asignadas.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-slate-500 shrink-0">Lector (Viewer):</span>
                    <span>Visualización y seguimiento de indicadores de estado sin modificar registros.</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso con Mockup */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                2. Descripción Paso a Paso de Uso con Ilustración de Pantalla
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-3">
                  <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100">
                    <div className="font-bold text-xs text-indigo-900">Paso 1: Autenticación Corporativa</div>
                    <p className="text-xs text-indigo-700 mt-1">Presione "Ingresar con Google" en la pantalla de inicio usando su correo oficial @crucianelli.com.</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="font-bold text-xs text-slate-900">Paso 2: Lanzador de Módulos</div>
                    <p className="text-xs text-slate-600 mt-1">Seleccione la tarjeta del módulo que desea gestionar para ingresar a su panel de control específico.</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="font-bold text-xs text-slate-900">Paso 3: Navegación Flexible</div>
                    <p className="text-xs text-slate-600 mt-1">Utilice el botón "Módulos" en la barra superior para alternar rápidamente entre herramientas.</p>
                  </div>
                </div>

                {/* Mockup Ilustrativo del Portal de Gestión de Calidad */}
                <div className="lg:col-span-2 bg-slate-100 rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm space-y-4">
                  {/* Fake Browser Header */}
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] text-slate-500 font-mono shadow-2xs">
                    <div className="flex items-center gap-1.5 mr-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                    </div>
                    <span className="text-slate-400">https://</span>
                    <span className="text-slate-700 font-medium">acciones-correctivas-iso.vercel.app</span>
                  </div>

                  {/* Portal Body */}
                  <div className="bg-white rounded-2xl p-4 sm:p-6 border border-slate-200/80 space-y-6 shadow-2xs">
                    <div className="text-center">
                      <h4 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                        Portal de Gestión de Calidad
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      {/* Card 1: SGC Salud & Velocímetro */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3 flex flex-col justify-between hover:border-slate-300 transition-all">
                        <div className="space-y-2.5">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <TrendingUp size={18} />
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900">SGC Salud & Velocímetro</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Indicadores de salud unificados de todos los módulos, velocímetro de cumplimiento mensual por empresa y reportes descargables de calidad para Dirección.
                          </p>
                        </div>
                        <div className="pt-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50/80 px-2.5 py-1 rounded-lg">
                            Ver Indicadores →
                          </span>
                        </div>
                      </div>

                      {/* Card 2: Acciones Correctivas */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3 flex flex-col justify-between hover:border-slate-300 transition-all">
                        <div className="space-y-2.5">
                          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            <ShieldAlert size={18} />
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900">Acciones Correctivas</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Gestión de desvíos, no conformidades y auditorías de causa raíz. Permite definir investigaciones de tipo 5 Porqués y planes de acción preventivos permanentes.
                          </p>
                        </div>
                        <div className="pt-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50/80 px-2.5 py-1 rounded-lg">
                            Acceder al Módulo →
                          </span>
                        </div>
                      </div>

                      {/* Card 3: Acciones de Mejora */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3 flex flex-col justify-between hover:border-slate-300 transition-all">
                        <div className="space-y-2.5">
                          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <Sparkles size={18} />
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900">Acciones de Mejora</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Carga y seguimiento rápido de sugerencias y planes de mejora continua. Flujo de trabajo directo sin necesidad de informes de causa raíz complejos.
                          </p>
                        </div>
                        <div className="pt-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50/80 px-2.5 py-1 rounded-lg">
                            Acceder al Módulo →
                          </span>
                        </div>
                      </div>

                      {/* Card 4: Planificación ISO */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3 flex flex-col justify-between hover:border-slate-300 transition-all">
                        <div className="space-y-2.5">
                          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                            <CalendarDays size={18} />
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900">Planificación ISO</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Calendario unificado de control de tareas mandatorias y auditorías de baja frecuencia. Permite asignar responsables, gestionar vencimientos y registrar avances de la norma.
                          </p>
                        </div>
                        <div className="pt-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 bg-purple-50/80 px-2.5 py-1 rounded-lg">
                            Acceder al Módulo →
                          </span>
                        </div>
                      </div>

                      {/* Card 5: Liberación Especial */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3 flex flex-col justify-between hover:border-slate-300 transition-all">
                        <div className="space-y-2.5">
                          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            <ShieldCheck size={18} />
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900">Liberación Especial</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Evaluación y control de liberación de materias primas o productos terminados con desviaciones. Con circuito de firmas y notificaciones integradas.
                          </p>
                        </div>
                        <div className="pt-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50/80 px-2.5 py-1 rounded-lg">
                            Acceder al Módulo →
                          </span>
                        </div>
                      </div>

                      {/* Card 6: Gestión de Cambios */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3 flex flex-col justify-between hover:border-slate-300 transition-all">
                        <div className="space-y-2.5">
                          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <RefreshCw size={18} />
                          </div>
                          <h5 className="font-bold text-xs sm:text-sm text-slate-900">Gestión de Cambios</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Circuito de firmas, evaluación técnica multidireccional, asignación de planes de acción y comunicación automática de propuestas de modificación.
                          </p>
                        </div>
                        <div className="pt-2">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50/80 px-2.5 py-1 rounded-lg">
                            Acceder al Módulo →
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Permisos y Seguridad */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-3">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                4. Permisos y Reglas de Seguridad (Seguridad de Acceso)
              </h3>
              <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200/70 text-xs text-amber-900 space-y-1">
                <p className="font-bold">✓ Control de Acceso Estricto:</p>
                <p>Únicamente se permite el ingreso a usuarios cuya dirección de correo electrónico exista dentro de la colección <code className="bg-amber-100 px-1 rounded">users</code> de Firestore o cuenten con cuenta verificada en el dominio corporativo.</p>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 1: SGC SALUD */}
        {matchesSearch('salud velocimetro dashboard cumplimiento direccion') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'dashboard' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <TrendingUp size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 1: SGC Salud & Velocímetro de Cumplimiento</h2>
                <p className="text-xs text-slate-500">Consolidado estratégico de indicadores de calidad y velocímetro mensual</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Monitorear en tiempo real la efectividad del SGC. El Velocímetro de Cumplimiento mide la proporción de acciones correctivas, preventivas e ISO cerradas en término versus los objetivos fijados por la Dirección (Meta 85%+).
                </p>
              </div>

              {/* 3. Roles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p><strong className="text-indigo-600">Dirección / Gerencia:</strong> Revisión periódica de la aguja de salud y estado por empresa (Crucianelli / TMC).</p>
                  <p><strong className="text-slate-700">Líderes de Calidad:</strong> Garantizar la carga oportuna de resoluciones para mantener el indicador en zona verde (≥85%).</p>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso con Mockup */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                2. Guía Paso a Paso de Uso con Ilustración de Pantalla
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 space-y-2 text-xs text-slate-600">
                  <p className="p-2.5 bg-slate-50 rounded-xl border border-slate-200"><strong>Paso 1:</strong> Seleccione la Empresa en el filtro superior (Crucianelli S.A. o TMC).</p>
                  <p className="p-2.5 bg-slate-50 rounded-xl border border-slate-200"><strong>Paso 2:</strong> Defina el rango de fechas (Mes actual, Trimestre o Año).</p>
                  <p className="p-2.5 bg-slate-50 rounded-xl border border-slate-200"><strong>Paso 3:</strong> Revise las tarjetas de desglose por tipo de evento (Correctivas, Mejoras, ISO, Liberaciones).</p>
                  <p className="p-2.5 bg-indigo-50 text-indigo-900 font-semibold rounded-xl border border-indigo-100"><strong>Paso 4:</strong> Presione "Descargar Reporte PDF" para exportar el informe de gestión.</p>
                </div>

                {/* Mockup Velocimetro */}
                <div className="lg:col-span-2 bg-slate-900 rounded-2xl p-4 text-white shadow-md border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
                    <span className="font-mono text-emerald-400">il_velocimetro_sgc.png</span>
                    <span>Velocímetro de Cumplimiento de Calidad</span>
                  </div>
                  <div className="p-4 bg-slate-950 rounded-xl flex flex-col items-center justify-center space-y-2">
                    <div className="text-xs text-slate-400 uppercase tracking-widest">Salud del Sistema (Target: 85%)</div>
                    <div className="text-4xl font-extrabold text-emerald-400">88.5%</div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-300">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
                      <span>Zona Verde (Excelente Desempeño)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Permisos */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Permisos y Reglas de Seguridad</h3>
              <p>Lectura permitida para todos los usuarios autenticados. Cálculos ejecutados en el cliente sobre consultas optimizadas de Firestore.</p>
            </div>
          </section>
        )}

        {/* SECTION 2: ACCIONES CORRECTIVAS */}
        {matchesSearch('correctivas hallazgo causa raiz investigacion no conformidad desvio') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'corrective' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                <ShieldAlert size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 2: Acciones Correctivas</h2>
                <p className="text-xs text-slate-500">Investigación de causa raíz, desvíos y planes de acción correctivos</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Erradicar las causas raíz de las No Conformidades y desvíos detectados en auditorías internas, reclamos de clientes, controles de proceso, etc mediante una metodología estructurada de análisis de causas y seguimiento de acciones correctivas con responsables asignados y plazos estipulados.
                </p>
              </div>

              {/* 3. Roles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2.5 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p><strong className="text-blue-600 font-bold">Creador del Hallazgo:</strong> Registra el desvío, descripción detallada y asigna a la persona responsable de realizar la investigación de causa raíz y para cuándo debe completarlo.</p>
                  <p><strong className="text-slate-800 font-bold">Responsable de Causa Raíz:</strong> Es la persona responsable de liderar y llevar adelante la investigación de causa raíz, definir acciones de contención y acciones correctivas, asignar los responsables de ejecutar las acciones correctivas y las fechas requeridas (consensuando con el responsable de la acción).</p>
                  <p><strong className="text-amber-700 font-bold">Responsable de la Acción:</strong> Implementa y lleva a cabo la acción correctiva asignada en tiempo y forma, registrando las evidencias correspondientes.</p>
                  <p><strong className="text-emerald-700 font-bold">Creador del Hallazgo:</strong> Verifica la eficacia final de la implementación en terreno y cierra la No Conformidad.</p>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                2. Guía Paso a Paso de Uso
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-2">
                  <div className="font-bold text-xs text-blue-900 uppercase tracking-wide">Paso 1: Alta de Hallazgo</div>
                  <div className="text-[11px] font-semibold text-blue-700 bg-blue-100/70 w-fit px-2 py-0.5 rounded">
                    Rol: Creador del Hallazgo
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Registra el desvío, descripción detallada y asigna a la persona responsable de realizar la investigación de causa raíz y para cuándo debe completarlo.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 2: Análisis de Causas</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Responsable de Causa Raíz
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Lidera y lleva adelante la investigación de causa raíz, analiza el origen de la desviación y define las acciones de contención pertinentes.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 3: Asignar Acciones</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Responsable de Causa Raíz
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Define las acciones correctivas, asigna los responsables de ejecutar las acciones correctivas y las fechas requeridas (consensuando con el responsable de la acción).
                  </p>
                </div>

                <div className="p-4 bg-amber-50/70 rounded-2xl border border-amber-200/80 space-y-2">
                  <div className="font-bold text-xs text-amber-900 uppercase tracking-wide">Paso 4: Ejecución de la Acción</div>
                  <div className="text-[11px] font-semibold text-amber-800 bg-amber-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Responsable de Acción
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Implementa y lleva a cabo las tareas correctivas asignadas dentro de las fechas pactadas y registra las evidencias de ejecución correspondientes.
                  </p>
                </div>

                <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-200/80 space-y-2">
                  <div className="font-bold text-xs text-emerald-900 uppercase tracking-wide">Paso 5: Verificación y Cierre</div>
                  <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Creador del Hallazgo
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Verifica la eficacia final de la implementación en terreno y cierra formalmente la No Conformidad.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Permisos */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Permisos y Reglas de Seguridad (Firestore Rules)</h3>
              <p>Creación abierta a usuarios autenticados. La edición del Análisis de Causas está asignada al <strong>Responsable de Causa Raíz</strong> o Administrador. La Verificación y Cierre definitivo está habilitado para el <strong>Creador del Hallazgo</strong> o Administrador.</p>
            </div>
          </section>
        )}

        {/* SECTION 3: MEJORA CONTINUA */}
        {matchesSearch('mejora continua sugerencias agil sara') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'improvement' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <Sparkles size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 3: Acciones de Mejora Continua</h2>
                <p className="text-xs text-slate-500">Carga ágil y directa de sugerencias de mejora y optimizaciones</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Agilizar el registro de oportunidades de mejora y sugerencias operativas. Este módulo omite el requerimiento de análisis de causa raíz para permitir una implementación rápida con asignación directa de responsable y plazo.
                </p>
              </div>

              {/* 3. Roles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p><strong className="text-emerald-600">Cualquier Usuario Registrado:</strong> Puede proponer una acción de mejora continua.</p>
                  <p><strong className="text-slate-800">Responsable de Ejecución:</strong> Recibe la notificación por correo y lleva a cabo la mejora.</p>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                2. Guía Paso a Paso de Uso
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-100 space-y-2">
                  <div className="font-bold text-xs text-emerald-900 uppercase tracking-wide">Paso 1: Acceso a Carga</div>
                  <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Promotor de Mejora
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Ingrese a "Nuevo Hallazgo" dentro del Módulo de Mejora Continua para iniciar el registro.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 2: Detalle de la Oportunidad</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Promotor de Mejora
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Indique la empresa, el origen de la sugerencia y la descripción de la oportunidad de mejora propuesta.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 3: Asignación Directa</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Promotor / Coordinador
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Seleccione al Responsable de la Acción y la fecha requerida para la ejecución de la mejora.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 4: Confirmación y Alerta</div>
                  <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 w-fit px-2 py-0.5 rounded">
                    Sistema Automático
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Presione "Confirmar Carga de Acción de Mejora". El sistema notificará inmediatamente por e-mail al responsable asignado.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Permisos */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Permisos y Reglas de Seguridad</h3>
              <p>Creación fluida habilitada para todos los usuarios autenticados. La regla de Firestore permite la creación de la acción inicial sin restricciones de análisis de causa previa.</p>
            </div>
          </section>
        )}

        {/* SECTION 4: PLANIFICACION ISO */}
        {matchesSearch('iso auditoria mantenimientos clausula planificacion 9001') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'iso' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                <CalendarDays size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 4: Planificación ISO</h2>
                <p className="text-xs text-slate-500">Programación y seguimiento de tareas normativas, revisiones y auditorías</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Garantizar el cumplimiento ininterrumpido de las obligaciones de la norma ISO 9001. Permite agendar tareas periódicas (mensuales, semestrales, anuales) con alertas preventivas por mail.
                </p>
              </div>

              {/* 3. Roles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p><strong className="text-purple-600 font-bold">Administrador ISO:</strong> Único autorizado para dar de alta nuevos eventos normativos en el calendario.</p>
                  <p><strong className="text-slate-800 font-bold">Responsable Asignado:</strong> Ejecuta la tarea en la fecha límite y adjunta el informe o evidencia.</p>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                2. Guía Paso a Paso de Uso
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-purple-50/60 rounded-2xl border border-purple-100 space-y-2">
                  <div className="font-bold text-xs text-purple-900 uppercase tracking-wide">Paso 1: Crear Evento ISO</div>
                  <div className="text-[11px] font-semibold text-purple-700 bg-purple-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Administrador ISO
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Un Administrador ingresa a "Nueva Planificación" e ingresa título, cláusula ISO, frecuencia, fecha programada y responsable.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 2: Alertas Automáticas</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Sistema Automático
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    El sistema emite correos preventivos automáticos 7, 3 y 1 día antes del vencimiento del compromiso.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 3: Carga de Evidencias</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Responsable Asignado
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    El responsable ejecuta la actividad ISO correspondiente y adjunta el informe o constancia de ejecución.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 4: Aprobación ISO</div>
                  <div className="text-[11px] font-semibold text-purple-800 bg-purple-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Administrador ISO
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Calidad o el Administrador ISO valida la evidencia presentada y marca formalmente la tarea como Completada.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Permisos */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Permisos y Reglas de Seguridad</h3>
              <p>La creación de eventos en la colección <code className="bg-slate-100 px-1 rounded">iso_calendar</code> está restringida strictly a Administradores (<code className="bg-slate-100 px-1 rounded">isAdmin()</code>). La carga de evidencias puede realizarla el usuario asignado.</p>
            </div>
          </section>
        )}

        {/* SECTION 5: LIBERACION ESPECIAL */}
        {matchesSearch('liberacion especial lote pieza desvio firmas despiece') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'special_release' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-blue-50 text-blue-700 rounded-2xl">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 5: Solicitud de Liberación Especial</h2>
                <p className="text-xs text-slate-500">Aprobación condicional de lotes o componentes con desviaciones controladas</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-700"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Evaluar y registrar bajo estricto protocolo de firmas la autorización excepcional para utilizar un lote de materia prima o pieza terminada que presenta una desviación menor pero técnicamente aceptable.
                </p>
              </div>

              {/* 3. Roles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-700"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p><strong className="text-blue-700 font-bold">Solicitante (Calidad):</strong> Registra el lote afectado y la justificación.</p>
                  <p><strong className="text-slate-800 font-bold">Firmantes Autorizados:</strong> Calidad, Producción e Ingeniería deben ingresar su dictamen numérico y firma digital.</p>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-700"></span>
                2. Guía Paso a Paso de Uso
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-2">
                  <div className="font-bold text-xs text-blue-900 uppercase tracking-wide">Paso 1: Solicitud</div>
                  <div className="text-[11px] font-semibold text-blue-700 bg-blue-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Solicitante (Calidad)
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Ingrese a "Nueva Solicitud de Liberación Especial", registre el código de pieza, cantidad de unidades, lote afectado y motivo de la desviación.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 2: Evaluación Técnica</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Firmantes Autorizados
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Las áreas evaluadoras analizan la factibilidad técnica y el nivel de riesgo de la desviación propuesta.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 3: Circuito de Firmas</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Firmantes Autorizados
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Cada responsable emite su dictamen formal (Aprobado / Rechazado) asentando su firma digital justificada.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 4: Liberación y Notificación</div>
                  <div className="text-[11px] font-semibold text-blue-800 bg-blue-100/80 w-fit px-2 py-0.5 rounded">
                    Sistema Automático
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Si es aprobado por unanimidad, el sistema emite el certificado de liberación condicional notificando automáticamente al almacén y producción.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Permisos */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Permisos y Reglas de Seguridad</h3>
              <p>Una vez estampada una firma digital, Firestore impide su modificación o sobrescritura, garantizando la inmutabilidad de la auditoría técnica.</p>
            </div>
          </section>
        )}

        {/* SECTION 6: GESTION DE CAMBIOS */}
        {matchesSearch('gestion de cambios moc modificacion proceso producto impacto') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'change_management' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-emerald-50 text-emerald-700 rounded-2xl">
                <RefreshCw size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 6: Gestión de Cambios (MOC)</h2>
                <p className="text-xs text-slate-500">Evaluación de impacto y control de modificaciones en productos o instalaciones</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Objetivo */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-700"></span>
                  1. Objetivo del Módulo
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  Asegurar que cualquier cambio propuesto en procesos de manufactura, especificaciones de diseño, proveedores o equipos sea evaluado previamente para prevenir riesgos operativos, ambientales y de calidad.
                </p>
              </div>

              {/* 3. Roles */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-700"></span>
                  3. Roles y Responsabilidades
                </h3>
                <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <p><strong className="text-emerald-700 font-bold">Solicitante del Cambio:</strong> Formula la propuesta MOC con justificación técnica.</p>
                  <p><strong className="text-slate-800 font-bold">Revisores del cambio:</strong> Evalúan el impacto y viabilidad del cambio para cada una de sus áreas específicas y definen acciones correctivas en caso de que sean requeridas.</p>
                  <p><strong className="text-slate-800 font-bold">Aprobador del cambio:</strong> Es quien luego de todas las revisiones individuales autoriza la implementación del cambio.</p>
                </div>
              </div>
            </div>

            {/* 2. Paso a Paso */}
            <div className="mt-8 space-y-4">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-700"></span>
                2. Guía Paso a Paso de Uso
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-emerald-50/60 rounded-2xl border border-emerald-100 space-y-2">
                  <div className="font-bold text-xs text-emerald-900 uppercase tracking-wide">Paso 1: Alta y Definición</div>
                  <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/80 w-fit px-2 py-0.5 rounded">
                    Rol: Solicitante del Cambio
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Registrar descripción de la propuesta, objetivo del cambio, realizar cuadro comparativo entre la situación actual y futura, realizar análisis de impacto del cambio y definir a los revisores del cambio.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 2: Revisión por Áreas</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Revisores del cambio
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Registrar la revisión del cambio a cada área y asignación de acciones correctivas en caso de que sea necesario.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 3: Aprobación Final</div>
                  <div className="text-[11px] font-semibold text-slate-700 bg-slate-200/80 w-fit px-2 py-0.5 rounded">
                    Rol: Aprobador del cambio
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Aprobación final del cambio luego de completadas todas las revisiones e intervenciones requeridas.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                  <div className="font-bold text-xs text-slate-900 uppercase tracking-wide">Paso 4: Notificación Automática</div>
                  <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 w-fit px-2 py-0.5 rounded">
                    Sistema Automático
                  </div>
                  <p className="text-xs text-slate-600 pt-1 leading-relaxed">
                    Notificación automática de la aprobación / rechazo del cambio a todos los involucrados.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Permisos */}
            <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-xs text-slate-600">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">4. Permisos y Reglas de Seguridad</h3>
              <p>Colección <code className="bg-slate-100 px-1 rounded">change_requests</code> restringida a usuarios registrados con validación de roles para la aprobación final.</p>
            </div>
          </section>
        )}

        {/* SECTION 7: USUARIOS Y ROLES */}
        {matchesSearch('usuarios roles admin editor lector directorio permisos') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'users' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                <Users size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 7: Administración de Usuarios y Directorio SGC</h2>
                <p className="text-xs text-slate-500">Gestión de usuarios autorizados, áreas, empresas y niveles de permisos</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">1. Directorio de Usuarios y Roles</h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  El Administrador gestiona la lista de colaboradores autorizados desde la opción <strong>"Configuración Usuarios"</strong>. Cada perfil contiene e-mail, nombre, empresa (Crucianelli / TMC), área y rol asignado.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-bold">
                      <th className="p-3 border border-slate-200">Rol</th>
                      <th className="p-3 border border-slate-200">Creación</th>
                      <th className="p-3 border border-slate-200">Edición / Causa Raíz</th>
                      <th className="p-3 border border-slate-200">Cierre Definitivo</th>
                      <th className="p-3 border border-slate-200">Configuración Usuarios</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600 divide-y divide-slate-200">
                    <tr>
                      <td className="p-3 border border-slate-200 font-bold text-indigo-600">ADMINISTRADOR</td>
                      <td className="p-3 border border-slate-200">✓ Todos los módulos</td>
                      <td className="p-3 border border-slate-200">✓ Total sobre cualquier registro</td>
                      <td className="p-3 border border-slate-200">✓ Exclusivo</td>
                      <td className="p-3 border border-slate-200">✓ Exclusivo</td>
                    </tr>
                    <tr>
                      <td className="p-3 border border-slate-200 font-bold text-slate-800">EDITOR</td>
                      <td className="p-3 border border-slate-200">✓ Hallazgos, Mejoras, Solicitudes</td>
                      <td className="p-3 border border-slate-200">✓ Solo si es Responsable Asignado</td>
                      <td className="p-3 border border-slate-200">✗ No permitido</td>
                      <td className="p-3 border border-slate-200">✗ No permitido</td>
                    </tr>
                    <tr>
                      <td className="p-3 border border-slate-200 font-bold text-slate-500">LECTOR (Viewer)</td>
                      <td className="p-3 border border-slate-200">✗ No permitido</td>
                      <td className="p-3 border border-slate-200">✗ No permitido</td>
                      <td className="p-3 border border-slate-200">✗ No permitido</td>
                      <td className="p-3 border border-slate-200">✗ No permitido</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 8: SEGURIDAD Y PERMISOS FIRESTORE */}
        {matchesSearch('seguridad permisos firestore rules auth tokens google') && (
          <section className={`bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm print:shadow-none print:border-slate-300 print:p-0 ${activeTab === 'security' ? 'block' : 'hidden print:block'}`}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                <Lock size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Módulo 8: Matriz de Permisos & Reglas de Seguridad (Firestore Rules)</h2>
                <p className="text-xs text-slate-500">Garantía de integridad de datos a nivel de base de datos de Firebase</p>
              </div>
            </div>

            <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
              <p className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                La seguridad no depende únicamente de la interfaz gráfica. La base de datos de <strong>Google Cloud Firestore</strong> ejecuta reglas de seguridad a nivel de servidor (<code className="bg-slate-200 px-1 py-0.5 rounded text-slate-800 font-mono">firestore.rules</code>) que rechazan cualquier solicitud de lectura o escritura no autorizada.
              </p>

              <div className="bg-slate-900 text-slate-200 p-4 rounded-2xl font-mono text-[11px] overflow-x-auto space-y-1">
                <div className="text-slate-400">// Principales Reglas de Seguridad Activas</div>
                <div>match /findings/{'{findingId}'} {'{'}</div>
                <div className="pl-4 text-emerald-400">allow read: if isRegisteredUser();</div>
                <div className="pl-4 text-emerald-400">allow create: if isRegisteredUser();</div>
                <div className="pl-4 text-amber-300">allow update: if isRegisteredUser() && (isAdmin() || resource.data.analysisResponsibleId == request.auth.uid);</div>
                <div className="pl-4 text-rose-400">allow delete: if isAdmin();</div>
                <div>{'}'}</div>
              </div>
            </div>
          </section>
        )}

      </div>

      {/* PRINT FOOTER */}
      <div className="hidden print:block text-center border-t border-slate-300 pt-6 mt-12 text-xs text-slate-500">
        <p>© Crucianelli S.A. / TMC • Sistema Integrado de Gestión de Calidad (SGC)</p>
        <p>Documento de caracter reservado para uso interno exclusivo.</p>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs, limit, where, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sendNotification } from '../services/notificationService';
import { Finding, FindingStatus } from '../types';
import { format, isPast } from 'date-fns';
import { Mail, Bell, Calendar, User, Search, AlertCircle, PlayCircle, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

const toDateSafe = (val: any): Date => {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(0) : d;
};

export default function NotificationLog() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [debugLogs, setDebugLogs] = useState<any[]>([]);
  const [loadingDebug, setLoadingDebug] = useState(false);

  const fetchNotifications = async () => {
    const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    setNotifications(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    setLoading(false);
    fetchDebugLogs();
  };

  const fetchDebugLogs = async () => {
    setLoadingDebug(true);
    try {
      const q = query(collection(db, 'cron_debug'), orderBy('checkedAt', 'desc'), limit(20));
      const snap = await getDocs(q);
      setDebugLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingDebug(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const simulateOverdueChecks = async () => {
    setIsSimulating(true);
    try {
      const response = await fetch('/api/cron/check');
      await response.json();
      
      // Wait a bit for the cron to finish and write to Firestore
      setTimeout(async () => {
        await fetchNotifications();
        setIsSimulating(false);
        alert('Escaneo de servidor completado.');
      }, 2000);
    } catch (e) {
      console.error(e);
      alert('Error contactando al servidor.');
      setIsSimulating(false);
    }
  };

  const openInMailClient = (notif: any) => {
    const mailtoUrl = `mailto:${notif.to}?subject=${encodeURIComponent(notif.subject)}&body=${encodeURIComponent(notif.body)}`;
    window.location.href = mailtoUrl;
  };

  const filtered = notifications.filter(n => {
    const to = n.to || '';
    const subject = n.subject || '';
    const search = searchTerm || '';
    return to.toLowerCase().includes(search.toLowerCase()) || 
           subject.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell size={24} className="text-blue-600" />
            Historial de Notificaciones
          </h1>
          <p className="text-slate-500 text-sm">Registro de todos los correos electrónicos generados por el sistema.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button 
            onClick={simulateOverdueChecks}
            disabled={isSimulating}
            className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white font-bold px-4 py-2 rounded-xl transition-all shadow-sm"
          >
            {isSimulating ? <Loader2 className="animate-spin" size={18} /> : <PlayCircle size={18} />}
            Forzar Verificación Servidor
          </button>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text"
              placeholder="Buscar..."
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-48"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4">
        <AlertCircle className="text-blue-600 mt-1" size={24} />
        <div>
          <h4 className="font-bold text-blue-900">Nota sobre el envío de correos</h4>
          <p className="text-sm text-blue-800 leading-relaxed">
            El sistema verifica automáticamente los vencimientos cada 30 minutos. 
            También puede forzar una verificación manual con el botón superior. 
            Los correos se registran aquí y se envían a través de <strong>Resend</strong>.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Cargando bitácora...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs sm:text-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="px-6 py-4 font-semibold">Fecha</th>
                  <th className="px-6 py-4 font-semibold">Destinatario</th>
                  <th className="px-6 py-4 font-semibold">Asunto</th>
                  <th className="px-6 py-4 font-semibold">Estado</th>
                  <th className="px-6 py-4 font-semibold">Contenido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((notif) => (
                  <tr key={notif.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                      {notif.createdAt ? format(toDateSafe(notif.createdAt), 'dd/MM/yyyy HH:mm') : '-'}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-700">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-slate-300" />
                        {notif.to}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {notif.subject}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold uppercase w-fit">
                          {notif.type}
                        </span>
                        {notif.status && (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase w-fit ${
                            notif.status === 'sent' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                          }`}>
                            {notif.status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 max-w-xs">
                      <div className="line-clamp-2">{notif.body}</div>
                      {notif.error && <p className="text-red-500 mt-1 italic">Err: {notif.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-slate-400 italic">No se encontraron notificaciones</div>
          )}
        </div>
      )}

      {/* DEBUG SECTION */}
      <div className="mt-12 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Search size={20} className="text-slate-400" />
            Depuración del Sistema (Cron Logs)
          </h2>
          <button 
            onClick={fetchDebugLogs} 
            className="text-xs font-bold text-blue-600 hover:underline"
          >
            Actualizar logs
          </button>
        </div>
        <div className="bg-slate-900 rounded-2xl p-6 overflow-hidden border border-slate-800 shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[10px] text-slate-300">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="pb-3 px-2">Timestamp (CheckedAt)</th>
                  <th className="pb-3 px-2">Hallazgo #</th>
                  <th className="pb-3 px-2">Tipo</th>
                  <th className="pb-3 px-2">Deadline</th>
                  <th className="pb-3 px-2">Calculated Diff</th>
                  <th className="pb-3 px-2">Milestone</th>
                  <th className="pb-3 px-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {debugLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/50">
                    <td className="py-2 px-2 whitespace-nowrap">
                      {log.checkedAt ? format(toDateSafe(log.checkedAt), 'HH:mm:ss.SSS') : '-'}
                    </td>
                    <td className="py-2 px-2">#{log.fNum}</td>
                    <td className="py-2 px-2">{log.itemType}</td>
                    <td className="py-2 px-2">{log.target}</td>
                    <td className="py-2 px-2 font-bold text-white">{log.diff} days</td>
                    <td className="py-2 px-2">
                      <span className={log.milestoneFound !== 'none' ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                        {log.milestoneFound}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-[8px]">
                      {log.milestoneFound !== 'none' ? (
                        log.historyExists ? (
                          <span className="text-slate-500 underline decoration-dotted">Ya enviado hoy</span>
                        ) : (
                          <span className="text-emerald-400">Procesado/Nuevo</span>
                        )
                      ) : '-'}
                    </td>
                  </tr>
                ))}
                {debugLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-600 italic">No hay logs de depuración aún</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { 
  getSyncState, 
  subscribeToSyncState, 
  googleSignInForWorkspace, 
  triggerAutoSync, 
  SyncState,
  fetchServerConfig,
  syncViaBackendService,
  syncAllToGoogleSheets,
  getCachedToken
} from '../lib/googleWorkspace';
import { FileSpreadsheet, RefreshCw, AlertTriangle, Play, ExternalLink, HelpCircle } from 'lucide-react';

export default function GoogleSheetsSyncStatus() {
  const [syncState, setSyncState] = useState<SyncState>(getSyncState());
  const [isConnecting, setIsConnecting] = useState(false);
  const [config, setConfig] = useState<{ hasServiceAccount: boolean; serviceAccountEmail: string | null } | null>(null);

  useEffect(() => {
    // Load backend configuration
    fetchServerConfig().then(cfg => {
      setConfig(cfg);
    });

    // Subscribe to client sync status
    const unsubscribe = subscribeToSyncState((state) => {
      setSyncState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      if (config?.hasServiceAccount) {
        await syncViaBackendService(true);
      } else {
        await googleSignInForWorkspace();
      }
    } catch (e) {
      console.warn('Google Sheets connection error:', e);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleManualTrigger = async () => {
    if (config?.hasServiceAccount) {
      try {
        await syncViaBackendService(true);
      } catch (e) {
        console.warn('Google Sheets sync trigger error:', e);
      }
    } else {
      const token = getCachedToken();
      if (token) {
        try {
          await syncAllToGoogleSheets(token);
        } catch (e) {
          console.warn('Google Sheets manual sync error:', e);
        }
      } else {
        triggerAutoSync();
      }
    }
  };

  return (
    <div id="sheets-sync-status-client" className="bg-slate-50 border-b border-slate-200 py-3.5 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4 text-sm">
        <div className="flex items-start md:items-center gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${
            syncState.status === 'success' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' :
            syncState.status === 'syncing' ? 'bg-blue-100 text-blue-600 animate-pulse' :
            syncState.status === 'error' ? 'bg-rose-100 text-rose-600 border border-rose-200' :
            'bg-slate-200 text-slate-500'
          }`}>
            <FileSpreadsheet size={20} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-800">Sincronización (Google Sheets):</span>
              <span className="flex items-center gap-1.5 font-medium">
                {syncState.status === 'success' && (
                  <span className="text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-emerald-100 font-bold">
                    ● Conectado {config?.hasServiceAccount && '(Cuenta de Servicio)'}
                  </span>
                )}
                {syncState.status === 'syncing' && (
                  <span className="text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-blue-100">
                    <RefreshCw className="animate-spin" size={10} />
                    Sincronizando...
                  </span>
                )}
                {syncState.status === 'error' && (
                  <span className="text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-rose-100">
                    <AlertTriangle size={10} />
                    Error de Sincronización
                  </span>
                )}
                {syncState.status === 'disconnected' && (
                  <span className="text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-amber-200 font-bold">
                    {config?.hasServiceAccount ? 'Listo para Sincronizar' : 'Sincronización Desconectada'}
                  </span>
                )}
                {syncState.status === 'idle' && (
                  <span className="text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full text-xs flex items-center gap-1 border border-blue-100 font-bold">
                    Listo para sincronizar
                  </span>
                )}
              </span>
            </div>
            {syncState.lastSyncTime ? (
              <p className="text-xs text-slate-500 mt-1">
                Última sincronización realizada con éxito a las{' '}
                <span className="font-semibold text-slate-700">{syncState.lastSyncTime}</span>.
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">
                Permite exportar todos los hallazgos y acciones del SGC en tiempo real a una planilla de Google Sheets.
              </p>
            )}
            
            {/* Informative helper / configuration tip */}
            {config && (
              <div className="mt-2 flex items-start gap-1.5 text-xs">
                {config.hasServiceAccount ? (
                  <p className="text-slate-500 flex items-center gap-1">
                    <span className="text-emerald-500">✔</span> Sincronización permanente activa de por vida en segundo plano. Email de la Cuenta de Servicio: <code className="bg-slate-100 px-1.5 py-0.5 rounded border text-slate-700 font-mono text-[11px]">{config.serviceAccountEmail}</code>
                  </p>
                ) : (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-amber-800 max-w-xl leading-relaxed flex gap-2">
                    <HelpCircle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <span className="font-bold">💡 Sincronización Permanente en Vercel:</span> Para evitar reconectar tu cuenta cada 1 hora (debido a las restricciones de expiración de tokens de Google), simplemente configura las variables de entorno <code className="bg-amber-100/60 px-1 py-0.5 rounded font-mono text-[11px]">GOOGLE_SERVICE_ACCOUNT_EMAIL</code> y <code className="bg-amber-100/60 px-1 py-0.5 rounded font-mono text-[11px]">GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code> en tu panel de Vercel. ¡La sincronización será automática y permanente!
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {syncState.error && (
              <p className="text-xs text-rose-600 mt-1.5 bg-rose-50 border border-rose-100 rounded-lg p-2 max-w-xl font-medium font-sans">
                {syncState.error}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {syncState.status === 'disconnected' ? (
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow-sm transition-all duration-200 cursor-pointer disabled:opacity-50"
            >
              {isConnecting ? (
                <RefreshCw className="animate-spin" size={14} />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
              {isConnecting ? 'Sincronizando...' : config?.hasServiceAccount ? 'Sincronizar con Cuenta de Servicio' : 'Vincular Google Sheets'}
            </button>
          ) : (
            <>
              {syncState.spreadsheetUrl && (
                <a
                  href={syncState.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow-sm shadow-emerald-100 transition-all duration-200"
                >
                  <ExternalLink size={14} />
                  Abrir Planilla Google Sheets
                </a>
              )}
              <button
                onClick={handleManualTrigger}
                disabled={syncState.status === 'syncing'}
                className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold py-2 px-4 rounded-xl text-xs shadow-sm transition-all duration-200 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`shrink-0 ${syncState.status === 'syncing' ? 'animate-spin' : ''}`} size={14} />
                Sincronizar Ahora
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

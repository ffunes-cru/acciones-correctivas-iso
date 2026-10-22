import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, getDocsFromServer } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile, UserRole } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firestoreUtils';
import { motion } from 'motion/react';
import { Upload, UserPlus, Trash2, Shield, User, Mail, Save, AlertCircle, FileSpreadsheet, FileText, Search } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  const showFeedback = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setFeedback({ msg, type });
    if (type !== 'info') {
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const fetchUsers = async (forceServer = false) => {
    setLoading(true);
    try {
      console.log("Fetching users, forceServer:", forceServer);
      const snap = forceServer 
        ? await getDocsFromServer(collection(db, 'users'))
        : await getDocs(collection(db, 'users'));
      const fetchedUsers = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
      console.log("Fetched users count:", fetchedUsers.length);
      setUsers(fetchedUsers);
    } catch (e) {
      console.error("Error fetching users:", e);
      handleFirestoreError(e, OperationType.LIST, 'users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const processImportData = async (data: any[]) => {
    setIsImporting(true);
    let count = 0;
    try {
      for (const item of data) {
        // Handle both array and object formats
        const email = item.Email || item[0];
        const name = item.Nombre || item[1];
        const roleStr = String(item.Rol || item[2] || 'user').toLowerCase();
        
        if (email && name) {
          const userId = email.trim().toLowerCase();
          await setDoc(doc(db, 'users', userId), {
            email,
            displayName: name,
            role: roleStr.includes('admin') ? UserRole.ADMIN : UserRole.USER,
            createdAt: new Date(),
            isPlaceholder: true
          }, { merge: true });
          count++;
        }
      }
      await fetchUsers();
      showFeedback(`${count} usuarios procesados exitosamente.`);
    } catch (e) {
      console.error(e);
      showFeedback('Error procesando los datos. Verifique el formato.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        // Remove header row if it looks like one
        const rows = data.slice(1);
        processImportData(rows);
      } catch (err) {
        alert('Error leyendo el archivo Excel');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleBatchImport = async () => {
    const lines = importText.split('\n').filter(l => l.trim().length > 0);
    const data = lines.map(line => line.split(',').map(s => s.trim()));
    processImportData(data);
    setImportText('');
  };

  const deleteUser = async (id: string) => {
    // This is now called after custom confirmation
    console.log(`[DEBUG] deleteUser confirmed for ID: ${id}`);
    showFeedback('Eliminando usuario...', 'info');
    
    // Check if user is trying to delete themselves
    if (id === auth.currentUser?.uid) {
      console.warn("[DEBUG] User tried to delete themselves.");
      showFeedback('No puede eliminarse a sí mismo.', 'error');
      setUserToDelete(null);
      return;
    }

    // Optimistic update for UI feel
    const previousUsers = [...users];
    setUsers(users.filter(u => u.id !== id));
    
    try {
      const userRef = doc(db, 'users', id);
      console.log(`[DEBUG] Attempting deleteDoc on: users/${id}`);
      await deleteDoc(userRef);
      console.log(`[DEBUG] Usuario ${id} eliminado exitosamente`);
      showFeedback('Usuario eliminado correctamente.');
      setUserToDelete(null);
      
      // Wait a bit before refreshing
      setTimeout(async () => {
        await fetchUsers(true);
      }, 1500);
    } catch (e: any) {
      console.error("[DEBUG] Error en deleteDoc:", e);
      setUsers(previousUsers);
      setUserToDelete(null);
      
      const errorCode = e.code || 'unknown';
      if (errorCode === 'permission-denied') {
        showFeedback('Error: No tiene permisos de administrador para borrar.', 'error');
      } else {
        showFeedback(`Error al eliminar: ${errorCode}`, 'error');
      }
      
      handleFirestoreError(e, OperationType.DELETE, `users/${id}`);
    }
  };

  const deleteSelectedUsers = async () => {
    const idsToDelete = selectedUsers.filter(id => id !== auth.currentUser?.uid);
    const hasSelf = selectedUsers.includes(auth.currentUser?.uid || '');

    if (idsToDelete.length === 0) {
      showFeedback(hasSelf ? 'No puede eliminarse a sí mismo.' : 'No hay usuarios seleccionados para eliminar.', 'error');
      setShowBulkDeleteModal(false);
      return;
    }

    setShowBulkDeleteModal(false);
    showFeedback(`Eliminando ${idsToDelete.length} usuario(s)...`, 'info');

    const previousUsers = [...users];
    setUsers(users.filter(u => !idsToDelete.includes(u.id)));
    const deletedCount = idsToDelete.length;

    try {
      for (const id of idsToDelete) {
        const userRef = doc(db, 'users', id);
        await deleteDoc(userRef);
      }
      showFeedback(`${deletedCount} usuario(s) eliminado(s) correctamente.`);
      setSelectedUsers([]);
      
      setTimeout(async () => {
        await fetchUsers(true);
      }, 1500);
    } catch (e: any) {
      console.error("[DEBUG] Error en deleteDoc masivo:", e);
      setUsers(previousUsers);
      
      const errorCode = e.code || 'unknown';
      if (errorCode === 'permission-denied') {
        showFeedback('Error: No tiene permisos de administrador para borrar.', 'error');
      } else {
        showFeedback(`Error al eliminar: ${errorCode}`, 'error');
      }
      
      handleFirestoreError(e, OperationType.DELETE, `users_bulk`);
    }
  };

  const handleSelectAll = (filteredList: UserProfile[]) => {
    const displayedIds = filteredList.map(u => u.id);
    const allSelectedInDisplayed = displayedIds.every(id => selectedUsers.includes(id)) && displayedIds.length > 0;
    
    if (allSelectedInDisplayed) {
      setSelectedUsers(selectedUsers.filter(id => !displayedIds.includes(id)));
    } else {
      setSelectedUsers(Array.from(new Set([...selectedUsers, ...displayedIds])));
    }
  };

  const handleSelectUser = (id: string) => {
    if (selectedUsers.includes(id)) {
      setSelectedUsers(selectedUsers.filter(x => x !== id));
    } else {
      setSelectedUsers([...selectedUsers, id]);
    }
  };

  // Normalize all users (fix swapped name/email fields, trim, handle nulls)
  const normalizedUsers = React.useMemo(() => {
    return users.map(u => {
      let email = (u.email || '').trim();
      let displayName = (u.displayName || '').trim();
      
      // Check if fields are swapped (displayName is an email, email is a name)
      const looksLikeEmail = (str: string) => str.includes('@');
      
      if (looksLikeEmail(displayName) && !looksLikeEmail(email) && email.length > 0) {
        // Swap them back
        const temp = displayName;
        displayName = email;
        email = temp;
      }
      
      return {
        ...u,
        email,
        displayName: displayName || email || 'Usuario Sin Nombre'
      };
    });
  }, [users]);

  // Deduplicate users by email (case-insensitive) or by id to ensure we never show duplicate entries
  // If there are duplicates, prefer the one that is NOT a placeholder, or has a longer name
  const deduplicatedUsers = React.useMemo(() => {
    const groups = new Map<string, UserProfile[]>();
    
    normalizedUsers.forEach(u => {
      const emailKey = u.email.toLowerCase().trim();
      if (!emailKey) return;
      if (!groups.has(emailKey)) {
        groups.set(emailKey, []);
      }
      groups.get(emailKey)!.push(u);
    });
    
    const result: UserProfile[] = [];
    
    groups.forEach((groupUsers) => {
      // Find the best user profile in the group
      let best = groupUsers[0];
      for (const u of groupUsers) {
        const bestIsEmail = best.displayName.includes('@');
        const uIsEmail = u.displayName.includes('@');
        
        // If current best is a placeholder and u is not, u is better
        const bestIsPlaceholder = (best as any).isPlaceholder === true;
        const uIsPlaceholder = (u as any).isPlaceholder === true;
        
        if (bestIsPlaceholder && !uIsPlaceholder) {
          best = u;
          continue;
        }
        if (!bestIsPlaceholder && uIsPlaceholder) {
          continue;
        }
        
        // Prefer displayName that doesn't look like an email
        if (bestIsEmail && !uIsEmail) {
          best = u;
          continue;
        }
        if (!bestIsEmail && uIsEmail) {
          continue;
        }
        
        // Otherwise prefer longer display name
        if (u.displayName.length > best.displayName.length) {
          best = u;
        }
      }
      result.push(best);
    });
    
    // Add users that didn't have an email (if any)
    normalizedUsers.forEach(u => {
      if (!u.email.trim()) {
        result.push(u);
      }
    });
    
    // Sort users alphabetically by displayName for a highly professional feel
    return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [normalizedUsers]);

  const filteredUsers = deduplicatedUsers.filter(u => {
    const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const search = normalize(searchTerm || '').trim();
    if (!search) return true;

    const displayName = normalize(u.displayName || '');
    const email = normalize(u.email || '');
    const id = normalize(u.id || '');

    const terms = search.split(/\s+/);
    return terms.every(term => displayName.includes(term) || email.includes(term) || id.includes(term));
  }).slice(0, 100); // Limit to 100 for performance
  const toggleRole = async (user: UserProfile) => {
    const newRole = user.role === UserRole.ADMIN ? UserRole.USER : UserRole.ADMIN;
    try {
      await setDoc(doc(db, 'users', user.id), { role: newRole }, { merge: true });
      showFeedback(`Rol cambiado a ${newRole} exitosamente.`);
      await fetchUsers(true);
    } catch (e) {
      showFeedback('Error al cambiar el rol.', 'error');
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.id}`);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Email', 'Nombre', 'Rol'],
      ['ejemplo@empresa.com', 'Juan Perez', 'user'],
      ['admin@empresa.com', 'Maria Gomez', 'admin']
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Usuarios");
    XLSX.writeFile(wb, "Plantilla_Usuarios_SGC.xlsx");
  };

  if (loading) return <div className="p-8">Cargando usuarios...</div>;

  return (
    <div className="space-y-8 relative">
      {/* Feedback Toast */}
      {feedback && (
        <motion.div 
          initial={{ opacity: 0, y: -20, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -20, x: '-50%' }}
          className={`fixed top-4 left-1/2 z-50 px-6 py-3 rounded-full shadow-lg border text-sm font-bold flex items-center gap-2 ${
            feedback.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
              : feedback.type === 'info'
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.type === 'success' ? <Save size={16} /> : feedback.type === 'info' ? <div className="animate-spin"><AlertCircle size={16} /></div> : <AlertCircle size={16} />}
          {feedback.msg}
        </motion.div>
      )}

      {/* Custom Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100"
          >
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-600 mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar usuario?</h3>
            <p className="text-sm text-slate-500 mb-6">
              Estás por eliminar a <span className="font-bold text-slate-700">{userToDelete.displayName}</span> ({userToDelete.email}). Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setUserToDelete(null)}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={() => deleteUser(userToDelete.id)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-red-200"
              >
                Eliminar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Custom Bulk Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-100"
          >
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-600 mb-4">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar usuarios seleccionados?</h3>
            <p className="text-sm text-slate-500 mb-6 font-medium">
              Estás por eliminar <span className="font-bold text-red-600">{selectedUsers.filter(id => id !== auth.currentUser?.uid).length}</span> usuario(s). Esta acción no se puede deshacer y retirará el acceso a esta plataforma.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowBulkDeleteModal(false)}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={deleteSelectedUsers}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors shadow-lg shadow-red-200"
              >
                Eliminar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Configuración de Usuarios</h1>
          <p className="text-slate-500">Gestione quién puede acceder y ser asignado a tareas.</p>
        </div>
        <button 
          onClick={downloadTemplate}
          className="flex items-center gap-2 bg-emerald-50 text-emerald-700 font-bold px-4 py-2 rounded-xl border border-emerald-200 hover:bg-emerald-100 transition-all text-sm"
        >
          <FileSpreadsheet size={18} />
          Descargar Plantilla Excel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Import section */}
        <div className="space-y-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-blue-600">
                <FileSpreadsheet size={20} />
                <h3 className="font-bold">Carga por Excel / CSV</h3>
              </div>
            </div>
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-blue-200 rounded-2xl p-10 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer group bg-slate-50/50"
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".xlsx,.xls,.csv"
              />
              <div className="flex flex-col items-center gap-4">
                <div className="p-5 bg-white border border-slate-100 shadow-sm rounded-full text-blue-500 group-hover:scale-110 transition-transform">
                  <Upload size={40} />
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-800">Carga Masiva desde Excel</p>
                  <p className="text-sm text-slate-500 mt-1">Haga clic aquí para seleccionar su archivo .xlsx o .csv</p>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-xl text-slate-500 text-xs flex gap-3">
              <AlertCircle size={18} className="shrink-0" />
              <p>
                El archivo debe tener 3 columnas en orden: <br/>
                <span className="font-bold">1. Email, 2. Nombre, 3. Rol (admin/user)</span>
              </p>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4"
          >
            <div className="flex items-center gap-2 text-slate-600 mb-2">
              <FileText size={20} />
              <h3 className="font-bold">Carga Manual (Texto)</h3>
            </div>
            <textarea
              className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="email@example.com, Nombre Apellido, user"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button
              onClick={handleBatchImport}
              disabled={isImporting || !importText.trim()}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white font-bold py-3 rounded-xl transition-all"
            >
              {isImporting ? 'Procesando...' : 'Importar Texto'}
            </button>
          </motion.div>
        </div>

        {/* User list */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full"
        >
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <h3 className="font-bold flex items-center gap-2">
              <UserPlus size={18} className="text-slate-400" />
              Directorio de Usuarios
            </h3>
            <div className="flex items-center gap-4 flex-grow max-w-md">
              <div className="relative flex-grow">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Buscar usuario por nombre o email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <button 
                  onClick={() => fetchUsers(true)}
                  className="text-xs text-blue-600 hover:underline font-bold"
                >
                  Actualizar
                </button>
                <span className="text-xs font-bold text-slate-400">{users.length} Registrados</span>
              </div>
            </div>
          </div>

          {selectedUsers.length > 0 && (
            <div className="bg-blue-50 px-6 py-3 border-b border-blue-100 flex items-center justify-between text-blue-800 text-sm font-medium">
              <div className="flex items-center gap-3">
                <input 
                  type="checkbox"
                  checked={filteredUsers.every(u => selectedUsers.includes(u.id)) && filteredUsers.length > 0}
                  ref={(el) => {
                    if (el) {
                      const allSelected = filteredUsers.every(u => selectedUsers.includes(u.id)) && filteredUsers.length > 0;
                      const someSelected = filteredUsers.some(u => selectedUsers.includes(u.id)) && !allSelected;
                      el.indeterminate = someSelected;
                    }
                  }}
                  onChange={() => handleSelectAll(filteredUsers)}
                  className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
                />
                <span>{selectedUsers.length} usuario{selectedUsers.length > 1 ? 's' : ''} seleccionado{selectedUsers.length > 1 ? 's' : ''}</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setSelectedUsers([])}
                  className="px-3 py-1 text-xs font-semibold text-slate-600 hover:text-slate-800"
                >
                  Desmarcar todos
                </button>
                <button 
                  onClick={() => setShowBulkDeleteModal(true)}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-1 shadow-sm transition-colors"
                >
                  <Trash2 size={13} />
                  Eliminar Seleccionados
                </button>
              </div>
            </div>
          )}

          <div className="flex-grow overflow-y-auto max-h-[600px]">
            {filteredUsers.length > 0 && (
              <div className="px-6 py-2 bg-slate-50/50 border-b border-slate-100 flex items-center text-xs text-slate-500 font-semibold gap-3">
                <input 
                  type="checkbox"
                  checked={filteredUsers.every(u => selectedUsers.includes(u.id))}
                  onChange={() => handleSelectAll(filteredUsers)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-3.5 w-3.5"
                />
                <span>Seleccionar todos los creados ({filteredUsers.length})</span>
              </div>
            )}

            {filteredUsers.length === 0 ? (
              <div className="p-12 text-center text-slate-400 italic">
                {searchTerm ? 'No se encontraron usuarios coincidentes' : 'No hay usuarios registrados'}
              </div>
            ) : (
              filteredUsers.map(u => (
                <div key={u.id} className="p-4 px-6 border-b border-slate-100 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox"
                      checked={selectedUsers.includes(u.id)}
                      onChange={() => handleSelectUser(u.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4 shrink-0 mr-1"
                    />
                    <div className={`p-2 rounded-full ${u.role === UserRole.ADMIN ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-400'}`}>
                      {u.role === UserRole.ADMIN ? <Shield size={16} /> : <User size={16} />}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-800">{u.displayName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-mono">ID: {u.id}</span>
                        <span className="text-xs text-slate-400 flex items-center gap-1"><Mail size={10} /> {u.email}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => toggleRole(u)}
                      className={`p-2 rounded-lg transition-all ${
                        u.role === UserRole.ADMIN 
                          ? 'text-purple-600 bg-purple-50 hover:bg-purple-100' 
                          : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title={u.role === UserRole.ADMIN ? "Quitar Administrador" : "Hacer Administrador"}
                    >
                      <Shield size={16} />
                    </button>
                    <button 
                      onClick={() => setUserToDelete(u)}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      title="Eliminar Usuario"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

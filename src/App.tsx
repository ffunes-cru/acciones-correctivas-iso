import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useParams, useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './lib/firebase';
import { UserProfile, UserRole } from './types';
import { handleFirestoreError, OperationType } from './lib/firestoreUtils';
import { LogIn, LogOut, PlusCircle, LayoutDashboard, Settings, FileText, Menu, X, Bell, AlertCircle, ArrowLeftRight, ArrowRight, ShieldAlert, Sparkles, Clock, CalendarDays, ShieldCheck, RefreshCw, TrendingUp, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { setCachedToken, triggerAutoSync, restoreCachedTokenFromFirestore } from './lib/googleWorkspace';
import GoogleSheetsSyncStatus from './components/GoogleSheetsSyncStatus';
import { runClientDeadlineCheck } from './services/clientCronService';
import UserManual from './components/UserManual';

// Helper function to safely migrate finding and action assignments from placeholder ID to real UID
async function migrateUserAssignments(placeholderId: string, realUid: string) {
  try {
    console.log(`[Migration] Checking if there are any assignments to migrate from ${placeholderId} to ${realUid}`);
    const findingsQuery = query(
      collection(db, 'findings'),
      where('involvedUserIds', 'array-contains', placeholderId)
    );
    const findingsSnap = await getDocs(findingsQuery);
    
    if (findingsSnap.empty) {
      console.log(`[Migration] No pending assignments found for placeholder ${placeholderId}`);
      return;
    }

    console.log(`[Migration] Found ${findingsSnap.size} findings for placeholder ${placeholderId}. Migrating to UID ${realUid}...`);
    
    for (const docSnap of findingsSnap.docs) {
      const findingId = docSnap.id;
      const data = docSnap.data();
      const updates: any = {};
      
      // Update Owner if it matches placeholder ID
      if (data.ownerId === placeholderId) {
        updates.ownerId = realUid;
      }
      
      // Update Analysis Responsible if it matches placeholder ID
      if (data.analysisResponsibleId === placeholderId) {
        updates.analysisResponsibleId = realUid;
      }
      
      // Update Involved User IDs array
      if (data.involvedUserIds && Array.isArray(data.involvedUserIds)) {
        updates.involvedUserIds = data.involvedUserIds.map((id: string) => id === placeholderId ? realUid : id);
      }
      
      // Update Pending Action User IDs array
      if (data.pendingActionUserIds && Array.isArray(data.pendingActionUserIds)) {
        updates.pendingActionUserIds = data.pendingActionUserIds.map((id: string) => id === placeholderId ? realUid : id);
      }
      
      // Perform the finding document update
      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, 'findings', findingId), updates);
        console.log(`[Migration] Updated finding #${data.findingNumber || findingId} assignments.`);
      }
      
      // Update subcollection 'correctiveActions' under the finding if assigned to the placeholder
      try {
        const actionsSnap = await getDocs(collection(db, 'findings', findingId, 'correctiveActions'));
        for (const actionSnap of actionsSnap.docs) {
          const actionData = actionSnap.data();
          if (actionData.responsibleId === placeholderId) {
            await updateDoc(doc(db, 'findings', findingId, 'correctiveActions', actionSnap.id), {
              responsibleId: realUid
            });
            console.log(`[Migration] Updated corrective action ${actionSnap.id} under finding #${data.findingNumber || findingId}`);
          }
        }
      } catch (childErr) {
        console.error(`[Migration] Error updating corrective actions list for finding ${findingId}:`, childErr);
      }
    }
    console.log(`[Migration] Assignment migration complete for ${placeholderId} -> ${realUid}`);
  } catch (error) {
    console.error('[Migration] Critical error in migrateUserAssignments:', error);
  }
}

// Pages
import Dashboard from './components/Dashboard';
import NewFinding from './components/NewFinding';
import FindingDetails from './components/FindingDetails';
import UserManagement from './components/UserManagement';
import NotificationLog from './components/NotificationLog';
import Reports from './components/Reports';
import ISODashboard from './components/ISODashboard';
import NewISOCalendar from './components/NewISOCalendar';
import ISOCalendarDetails from './components/ISOCalendarDetails';
import SpecialReleaseDashboard from './components/SpecialReleaseDashboard';
import NewSpecialRelease from './components/NewSpecialRelease';
import SpecialReleaseDetails from './components/SpecialReleaseDetails';
import ChangeManagementDashboard from './components/ChangeManagementDashboard';
import NewChangeRequest from './components/NewChangeRequest';
import ChangeRequestDetails from './components/ChangeRequestDetails';
import { SgcDashboard } from './components/SgcDashboard';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'corrective' | 'improvement' | 'iso' | 'special_release' | 'change_management' | 'dashboard' | 'manual' | null>(() => {
    return localStorage.getItem('sgc_selected_category') as 'corrective' | 'improvement' | 'iso' | 'special_release' | 'change_management' | 'dashboard' | 'manual' | null;
  });

  const handleSelectCategory = (category: 'corrective' | 'improvement' | 'iso' | 'special_release' | 'change_management' | 'dashboard' | 'manual' | null) => {
    setSelectedCategory(category);
    if (category) {
      localStorage.setItem('sgc_selected_category', category);
    } else {
      localStorage.removeItem('sgc_selected_category');
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // 1. Gather all potential placeholder IDs for this user
          const candidatePlaceholderIds = new Set<string>();
          if (firebaseUser.email) {
            candidatePlaceholderIds.add(firebaseUser.email.trim().toLowerCase());
            candidatePlaceholderIds.add(firebaseUser.email.replace(/[^a-zA-Z0-9]/g, '_'));
          }
          if (firebaseUser.displayName) {
            const cleanName = firebaseUser.displayName.replace(/[^a-zA-Z0-9\s]/g, '');
            const parts = cleanName.trim().split(/\s+/);
            if (parts.length > 0) {
              candidatePlaceholderIds.add(parts.join('_'));
              if (parts.length === 2) {
                candidatePlaceholderIds.add(`${parts[1]}_${parts[0]}`);
              }
              if (parts.length > 2) {
                candidatePlaceholderIds.add(`${parts[parts.length - 1]}_${parts[0]}`);
              }
            }
          }

          // 2. Query Firestore 'users' collection to find any placeholder document matching this email
          if (firebaseUser.email) {
            try {
              const qPlaceholder = query(
                collection(db, 'users'), 
                where('email', '==', firebaseUser.email)
              );
              const placeholderSnap = await getDocs(qPlaceholder);
              placeholderSnap.docs.forEach(docSnap => {
                if (docSnap.id !== firebaseUser.uid) {
                  candidatePlaceholderIds.add(docSnap.id);
                }
              });
            } catch (queryErr) {
              console.error('[Migration] Error querying placeholder users:', queryErr);
            }
          }

          console.log('[Migration] Identified candidate placeholder IDs for user:', Array.from(candidatePlaceholderIds));

          // 3. Try checking by UID first
          let userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          
          if (!userDoc.exists() && firebaseUser.email) {
            // Check if any of the candidate placeholder documents exist in the DB to migrate user profile
            let foundPlaceholderData: any = null;
            let foundPlaceholderId: string | null = null;
            
            for (const placeholderId of candidatePlaceholderIds) {
              const pDoc = await getDoc(doc(db, 'users', placeholderId));
              if (pDoc.exists()) {
                foundPlaceholderData = pDoc.data();
                foundPlaceholderId = placeholderId;
                break;
              }
            }
            
            if (foundPlaceholderData) {
              console.log(`[Migration] Found placeholder profile with ID ${foundPlaceholderId}. Creating real UID document...`);
              await setDoc(doc(db, 'users', firebaseUser.uid), {
                ...foundPlaceholderData,
                id: firebaseUser.uid,
                isPlaceholder: false,
                updatedAt: serverTimestamp()
              });
              
              // Clean up the found placeholder document
              if (foundPlaceholderId) {
                await deleteDoc(doc(db, 'users', foundPlaceholderId));
              }
              userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
            }
          }

          // Also clean up any other placeholder documents we found to prevent duplicates
          for (const placeholderId of candidatePlaceholderIds) {
            try {
              const pDoc = await getDoc(doc(db, 'users', placeholderId));
              if (pDoc.exists()) {
                console.log(`[Migration] Cleaning up duplicate placeholder user document: ${placeholderId}`);
                await deleteDoc(doc(db, 'users', placeholderId));
              }
            } catch (e) {
              console.error(`[Migration] Error cleaning up placeholder document ${placeholderId}:`, e);
            }
          }

          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;

            // Restore Google Sheets token from Firestore if still valid (< 55 mins)
            if (userData.googleSheetsToken && userData.googleSheetsTokenTime) {
              const now = Date.now();
              const elapsed = now - userData.googleSheetsTokenTime;
              if (elapsed < 55 * 60 * 1000) {
                restoreCachedTokenFromFirestore(userData.googleSheetsToken, userData.googleSheetsTokenTime);
              }
            }

            // Force admin for the specified email
            if (firebaseUser.email === 'psantilli@crucianelli.com' && userData.role !== UserRole.ADMIN) {
              await setDoc(doc(db, 'users', firebaseUser.uid), { role: UserRole.ADMIN }, { merge: true });
              setUser({ ...userData, role: UserRole.ADMIN });
            } else {
              setUser({ id: firebaseUser.uid, ...userData } as UserProfile);
            }

            // Run assignment migration for all identified placeholder IDs
            for (const placeholderId of candidatePlaceholderIds) {
              migrateUserAssignments(placeholderId, firebaseUser.uid).catch(e => 
                console.error(`[Migration] Error in background migration for ${placeholderId}:`, e)
              );
            }
          } else {
            // If user does not exist in collection, check if they are the bootstrap admin
            if (firebaseUser.email === 'psantilli@crucianelli.com') {
              const newUser: UserProfile = {
                id: firebaseUser.uid,
                email: firebaseUser.email || '',
                displayName: firebaseUser.displayName || 'Usuario',
                role: UserRole.ADMIN,
                createdAt: serverTimestamp(),
              } as any;
              await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
              setUser(newUser);

              // Run assignment migration for all identified placeholder IDs
              for (const placeholderId of candidatePlaceholderIds) {
                migrateUserAssignments(placeholderId, firebaseUser.uid).catch(e => 
                  console.error(`[Migration] Error in background migration for bootstrap admin (${placeholderId}):`, e)
                );
              }
            } else {
              // Deny entry completely! Sign out and show error.
              setAuthError('Acceso denegado: Su dirección de correo electrónico no se encuentra registrada en el Directorio de Usuarios. Por favor, solicite acceso al administrador del sistema.');
              setUser(null);
              await signOut(auth);
            }
          }
          // Enable live sheets sync on load
          triggerAutoSync();
          // Run client-side background deadline/notification checks
          runClientDeadlineCheck().catch(err => console.error("Client deadline check failed:", err));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setCachedToken(credential.accessToken);
        setTimeout(() => triggerAutoSync(), 1000);
      }
    } catch (e) {
      console.error("Login failure:", e);
      setAuthError('No se pudo completar el inicio de sesión. Por favor, intente nuevamente.');
    }
  };

  const logout = async () => {
    await signOut(auth);
    setCachedToken(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100"
        >
          <div className="flex justify-center mb-6">
            <div className="p-3 bg-blue-100 rounded-xl text-blue-600">
              <FileText size={48} />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Gestión de Acciones Correctivas</h1>
          <p className="text-slate-500 mb-6">Sistema de Gestión de Hallazgos y Correctivas</p>

          {authError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-start gap-2 text-left"
            >
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <span>{authError}</span>
            </motion.div>
          )}

          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-200"
          >
            <LogIn size={20} />
            Ingresar con Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <Router>
      {!selectedCategory ? (
        <div className="min-h-screen flex flex-col justify-between bg-slate-50 text-slate-900 font-sans">
          {/* Simple Header */}
          <header className="bg-white border-b border-slate-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-xl text-blue-600">
                <FileText size={24} />
                <span className="text-slate-800">SGC Crucianelli</span>
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => handleSelectCategory('manual')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl transition-all border border-amber-200 cursor-pointer"
                  title="Ver Manual de Usuario"
                >
                  <BookOpen size={16} />
                  <span>Manual de Usuario</span>
                </button>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-medium text-slate-700">{user.displayName}</span>
                  <span className="text-xs text-slate-400 capitalize">{user.role}</span>
                </div>
                <button
                  onClick={logout}
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                  title="Cerrar Sesión"
                >
                  <LogOut size={20} />
                </button>
              </div>
            </div>
          </header>

          {/* Portal Cards */}
          <main className="flex-grow flex items-center justify-center p-6 my-12">
            <Routes>
              {/* Dynamic check for direct link under findings */}
              <Route path="/findings/:id" element={<DirectFindingLoader user={user} onSelectCategory={handleSelectCategory} />} />
              <Route path="/special-release/:id" element={<DirectSpecialReleaseLoader user={user} onSelectCategory={handleSelectCategory} />} />
              <Route path="/iso-calendar/:id" element={<DirectISOCalendarLoader user={user} onSelectCategory={handleSelectCategory} />} />
              <Route path="/change-request/:id" element={<DirectChangeRequestLoader user={user} onSelectCategory={handleSelectCategory} />} />
              
              {/* Fallback to portal launcher selection */}
              <Route path="*" element={
                <div className="max-w-4xl w-full space-y-8 text-center font-sans animate-fade-in">
                  <div className="space-y-3">
                    <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Portal de Gestión de Calidad</h1>

                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pt-4">
                    {/* SGC Salud & Velocímetro */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => handleSelectCategory('dashboard')}
                      className="bg-white rounded-3xl border border-slate-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-500/5 p-7 text-left cursor-pointer transition-all shadow-md flex flex-col justify-between min-h-[320px]"
                    >
                      <div className="space-y-4">
                        <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-2xl w-fit">
                          <TrendingUp size={28} />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800 tracking-tight">SGC Salud & Velocímetro</h2>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed font-normal">
                            Indicadores de salud unificados de todos los módulos, velocímetro de cumplimiento mensual por empresa y reportes descargables de calidad para Dirección.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-indigo-600 font-semibold text-xs bg-indigo-50/70 hover:bg-indigo-50 w-fit px-3 py-1.5 rounded-lg mt-5 transition-colors">
                        <span>Ver Indicadores</span>
                        <ArrowRight size={14} />
                      </div>
                    </motion.div>

                    {/* Acciones Correctivas */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => handleSelectCategory('corrective')}
                      className="bg-white rounded-3xl border border-slate-100 hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/5 p-7 text-left cursor-pointer transition-all shadow-md flex flex-col justify-between min-h-[320px]"
                    >
                      <div className="space-y-4">
                        <div className="p-3.5 bg-blue-50 text-blue-600 rounded-2xl w-fit">
                          <ShieldAlert size={28} />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Acciones Correctivas</h2>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed font-normal">
                            Gestión de desvíos, no conformidades y auditorías de causa raíz. Permite definir investigaciones de tipo 5 Porqués y planes de acción preventivos permanentes.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-blue-600 font-semibold text-xs bg-blue-50/70 hover:bg-blue-50 w-fit px-3 py-1.5 rounded-lg mt-5 transition-colors">
                        <span>Acceder al Módulo</span>
                        <ArrowRight size={14} />
                      </div>
                    </motion.div>

                    {/* Acciones de Mejora */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => handleSelectCategory('improvement')}
                      className="bg-white rounded-3xl border border-slate-100 hover:border-emerald-500 hover:shadow-xl hover:shadow-emerald-500/5 p-7 text-left cursor-pointer transition-all shadow-md flex flex-col justify-between min-h-[320px]"
                    >
                      <div className="space-y-4">
                        <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-2xl w-fit">
                          <Sparkles size={28} />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Acciones de Mejora</h2>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed font-normal">
                            Carga y seguimiento rápido de sugerencias y planes de mejora continua. Flujo de trabajo directo sin necesidad de informes de causa raíz complejos.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-emerald-600 font-semibold text-xs bg-emerald-50/70 hover:bg-emerald-50 w-fit px-3 py-1.5 rounded-lg mt-5 transition-colors">
                        <span>Acceder al Módulo</span>
                        <ArrowRight size={14} />
                      </div>
                    </motion.div>

                    {/* Planificación ISO */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => handleSelectCategory('iso')}
                      className="bg-white rounded-3xl border border-slate-100 hover:border-purple-500 hover:shadow-xl hover:shadow-purple-500/5 p-7 text-left cursor-pointer transition-all shadow-md flex flex-col justify-between min-h-[320px]"
                    >
                      <div className="space-y-4">
                        <div className="p-3.5 bg-purple-50 text-purple-600 rounded-2xl w-fit">
                          <CalendarDays size={28} />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Planificación ISO</h2>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed font-normal">
                            Calendario unificado de control de tareas mandatorias y auditorías de baja frecuencia. Permite asignar responsables, gestionar vencimientos y registrar avances de la norma.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-purple-600 font-semibold text-xs bg-purple-50/70 hover:bg-purple-50 w-fit px-3 py-1.5 rounded-lg mt-5 transition-colors">
                        <span>Acceder al Módulo</span>
                        <ArrowRight size={14} />
                      </div>
                    </motion.div>

                    {/* Liberación Especial */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => handleSelectCategory('special_release')}
                      className="bg-white rounded-3xl border border-slate-100 hover:border-blue-600 hover:shadow-xl hover:shadow-blue-600/5 p-7 text-left cursor-pointer transition-all shadow-md flex flex-col justify-between min-h-[320px]"
                    >
                      <div className="space-y-4">
                        <div className="p-3.5 bg-blue-50 text-blue-700 rounded-2xl w-fit">
                          <ShieldCheck size={28} />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Liberación Especial</h2>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed font-normal">
                            Evaluación y control de liberación de materias primas o productos terminados con desviaciones. Con circuito de firmas y notificaciones integradas.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-blue-700 font-semibold text-xs bg-blue-50/70 hover:bg-blue-50 w-fit px-3 py-1.5 rounded-lg mt-5 transition-colors">
                        <span>Acceder al Módulo</span>
                        <ArrowRight size={14} />
                      </div>
                    </motion.div>

                    {/* Gestión de Cambios */}
                    <motion.div
                      whileHover={{ y: -6, scale: 1.01 }}
                      onClick={() => handleSelectCategory('change_management')}
                      className="bg-white rounded-3xl border border-slate-100 hover:border-emerald-600 hover:shadow-xl hover:shadow-emerald-600/5 p-7 text-left cursor-pointer transition-all shadow-md flex flex-col justify-between min-h-[320px]"
                    >
                      <div className="space-y-4">
                        <div className="p-3.5 bg-emerald-50 text-emerald-700 rounded-2xl w-fit">
                          <RefreshCw size={28} />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-800 tracking-tight">Gestión de Cambios</h2>
                          <p className="text-slate-500 text-xs mt-2 leading-relaxed font-normal">
                            Circuito de firmas, evaluación técnica multidireccional, asignación de planes de acción y comunicación automática de propuestas de modificación.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-xs bg-emerald-50/70 hover:bg-emerald-50 w-fit px-3 py-1.5 rounded-lg mt-5 transition-colors">
                        <span>Acceder al Módulo</span>
                        <ArrowRight size={14} />
                      </div>
                    </motion.div>

                  </div>
                </div>
              } />
            </Routes>
          </main>

          {/* Humble footer */}
          <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400">
            <span>SGC Portal unificado v2.4 • Crucianelli Calidad</span>
          </footer>
        </div>
      ) : (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
          {/* Navigation */}
          <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center gap-4 sm:gap-8">
                  <div className="flex items-center gap-3">
                    <Link to="/" className="flex items-center gap-2 font-bold text-base sm:text-lg">
                      {selectedCategory === 'manual' ? (
                        <>
                          <BookOpen size={22} className="text-amber-600" />
                          <span className="text-amber-600">Manual de Usuario</span>
                        </>
                      ) : selectedCategory === 'dashboard' ? (
                        <>
                          <TrendingUp size={22} className="text-indigo-600" />
                          <span className="text-indigo-600">SGC Salud & Velocímetro</span>
                        </>
                      ) : selectedCategory === 'iso' ? (
                        <>
                          <CalendarDays size={22} className="text-purple-600" />
                          <span className="text-purple-600">Planificación ISO</span>
                        </>
                      ) : selectedCategory === 'special_release' ? (
                        <>
                          <ShieldCheck size={22} className="text-blue-600" />
                          <span className="text-blue-600">Liberación Especial</span>
                        </>
                      ) : selectedCategory === 'change_management' ? (
                        <>
                          <RefreshCw size={22} className="text-emerald-600" />
                          <span className="text-emerald-600">Gestión de Cambios</span>
                        </>
                      ) : (
                        <>
                          <FileText size={22} className={selectedCategory === 'corrective' ? 'text-blue-600' : 'text-emerald-600'} />
                          <span className={selectedCategory === 'corrective' ? 'text-blue-600' : 'text-emerald-600'}>
                            {selectedCategory === 'corrective' ? 'Gestión de Correctivas' : 'Gestión de Mejoras'}
                          </span>
                        </>
                      )}
                    </Link>

                    <Link
                      to="/"
                      onClick={() => handleSelectCategory(null)}
                      className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-all border border-slate-200 cursor-pointer"
                      title="Volver al Portal de Lanzamiento"
                    >
                      <ArrowLeftRight size={12} />
                      <span className="hidden sm:inline">Módulos</span>
                    </Link>
                  </div>

                  <div className="hidden md:flex items-center gap-6">
                    <NavLink to="/" icon={<LayoutDashboard size={18} />} label="Dashboard" />
                    {selectedCategory === 'iso' ? (
                      user.role === UserRole.ADMIN && (
                        <NavLink to="/new" icon={<PlusCircle size={18} />} label="Nueva Planificación" />
                      )
                    ) : selectedCategory === 'special_release' ? (
                      <NavLink to="/new" icon={<PlusCircle size={18} />} label="Nueva Solicitud" />
                    ) : selectedCategory === 'change_management' ? (
                      <NavLink to="/new" icon={<PlusCircle size={18} />} label="Solicitar Cambio" />
                    ) : selectedCategory === 'dashboard' ? null : (
                      <NavLink to="/new" icon={<PlusCircle size={18} />} label="Nuevo Hallazgo" />
                    )}
                    {user.role === UserRole.ADMIN && (
                      <>
                        <NavLink to="/users" icon={<Settings size={18} />} label="Configuración Usuarios" />
                        {selectedCategory !== 'iso' && selectedCategory !== 'special_release' && selectedCategory !== 'dashboard' && (
                          <NavLink to="/reports" icon={<FileText size={18} />} label={selectedCategory === 'corrective' ? "Reporte de Vencidos" : "Reporte de Mejoras"} />
                        )}
                        <NavLink to="/notifications" icon={<Bell size={18} />} label="Log de Mails" />
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="hidden sm:flex flex-col items-end mr-2">
                    <span className="text-sm font-medium text-slate-700">{user.displayName}</span>
                    <span className="text-xs text-slate-400 capitalize">{user.role}</span>
                  </div>
                  <button
                    onClick={logout}
                    className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    title="Cerrar Sesión"
                  >
                    <LogOut size={20} />
                  </button>
                  <button 
                    className="md:hidden p-2"
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                  >
                    {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile Menu */}
            <AnimatePresence>
              {isMenuOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="md:hidden border-t border-slate-100 bg-white overflow-hidden"
                >
                  <div className="px-4 py-3 space-y-1">
                    <MobileNavLink to="/" label="Dashboard" onClick={() => setIsMenuOpen(false)} />
                    {selectedCategory === 'iso' ? (
                      user.role === UserRole.ADMIN && (
                        <MobileNavLink to="/new" label="Nueva Planificación" onClick={() => setIsMenuOpen(false)} />
                      )
                    ) : selectedCategory === 'special_release' ? (
                      <MobileNavLink to="/new" label="Nueva Solicitud" onClick={() => setIsMenuOpen(false)} />
                    ) : selectedCategory === 'change_management' ? (
                      <MobileNavLink to="/new" label="Solicitar Cambio" onClick={() => setIsMenuOpen(false)} />
                    ) : selectedCategory === 'dashboard' ? null : (
                      <MobileNavLink to="/new" label="Nuevo Hallazgo" onClick={() => setIsMenuOpen(false)} />
                    )}
                    {user.role === UserRole.ADMIN && (
                      <>
                        <MobileNavLink to="/users" label="Configuración Usuarios" onClick={() => setIsMenuOpen(false)} />
                        {selectedCategory !== 'iso' && selectedCategory !== 'special_release' && selectedCategory !== 'dashboard' && (
                          <MobileNavLink to="/reports" label={selectedCategory === 'corrective' ? "Reporte de Vencidos" : "Reporte de Mejoras"} onClick={() => setIsMenuOpen(false)} />
                        )}
                        <MobileNavLink to="/notifications" label="Log de Mails" onClick={() => setIsMenuOpen(false)} />
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </nav>

          {user.role === UserRole.ADMIN && <GoogleSheetsSyncStatus />}

          {/* Main Content */}
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Routes>
              {selectedCategory === 'manual' ? (
                <>
                  <Route path="*" element={<UserManual user={user} onBack={() => handleSelectCategory(null)} />} />
                </>
              ) : selectedCategory === 'dashboard' ? (
                <>
                  <Route path="/" element={<SgcDashboard user={user} />} />
                  {user.role === UserRole.ADMIN && (
                    <>
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/notifications" element={<NotificationLog />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" />} />
                </>
              ) : selectedCategory === 'iso' ? (
                <>
                  <Route path="/" element={<ISODashboard user={user} />} />
                  <Route path="/new" element={user.role === UserRole.ADMIN ? <NewISOCalendar user={user} /> : <Navigate to="/" />} />
                  <Route path="/iso-calendar/:id" element={<ISOCalendarDetails user={user} />} />
                  <Route path="/findings/:id" element={<DirectFindingLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/special-release/:id" element={<DirectSpecialReleaseLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/change-request/:id" element={<DirectChangeRequestLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  {user.role === UserRole.ADMIN && (
                    <>
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/notifications" element={<NotificationLog />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" />} />
                </>
              ) : selectedCategory === 'special_release' ? (
                <>
                  <Route path="/" element={<SpecialReleaseDashboard user={user} />} />
                  <Route path="/new" element={<NewSpecialRelease user={user} />} />
                  <Route path="/special-release/:id" element={<SpecialReleaseDetails user={user} />} />
                  <Route path="/findings/:id" element={<DirectFindingLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/iso-calendar/:id" element={<DirectISOCalendarLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/change-request/:id" element={<DirectChangeRequestLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  {user.role === UserRole.ADMIN && (
                    <>
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/notifications" element={<NotificationLog />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" />} />
                </>
              ) : selectedCategory === 'change_management' ? (
                <>
                  <Route path="/" element={<ChangeManagementDashboard user={user} />} />
                  <Route path="/new" element={<NewChangeRequest user={user} />} />
                  <Route path="/change-request/:id" element={<ChangeRequestDetails user={user} />} />
                  <Route path="/findings/:id" element={<DirectFindingLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/special-release/:id" element={<DirectSpecialReleaseLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/iso-calendar/:id" element={<DirectISOCalendarLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  {user.role === UserRole.ADMIN && (
                    <>
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/notifications" element={<NotificationLog />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" />} />
                </>
              ) : (
                <>
                  <Route path="/" element={<Dashboard user={user} category={selectedCategory as 'corrective' | 'improvement'} />} />
                  <Route path="/new" element={<NewFinding user={user} category={selectedCategory as 'corrective' | 'improvement'} />} />
                  <Route path="/findings/:id" element={<FindingDetails user={user} category={selectedCategory as 'corrective' | 'improvement'} />} />
                  <Route path="/special-release/:id" element={<DirectSpecialReleaseLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/iso-calendar/:id" element={<DirectISOCalendarLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  <Route path="/change-request/:id" element={<DirectChangeRequestLoader user={user} onSelectCategory={handleSelectCategory} />} />
                  {user.role === UserRole.ADMIN && (
                    <>
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/reports" element={<Reports user={user} category={selectedCategory as 'corrective' | 'improvement'} />} />
                      <Route path="/notifications" element={<NotificationLog />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" />} />
                </>
              )}
            </Routes>
          </main>
        </div>
      )}
    </Router>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link 
      to={to} 
      className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all text-sm font-medium"
    >
      {icon}
      {label}
    </Link>
  );
}

function MobileNavLink({ to, label, onClick }: { to: string; label: string; onClick: () => void }) {
  return (
    <Link 
      to={to} 
      onClick={onClick}
      className="block px-3 py-3 text-base font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
    >
      {label}
    </Link>
  );
}

function DirectFindingLoader({ 
  user, 
  onSelectCategory 
}: { 
  user: UserProfile; 
  onSelectCategory: (cat: 'corrective' | 'improvement' | null) => void; 
}) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDirect() {
      if (!id) return;
      try {
        const docRef = doc(db, 'findings', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          const category = data.findingCategory || 'corrective';
          onSelectCategory(category as 'corrective' | 'improvement');
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('Error fetching direct finding:', err);
        setLoading(false);
      }
    }
    loadDirect();
  }, [id, onSelectCategory]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <Clock className="animate-spin mb-4 text-slate-300" size={32} />
        <p>Cargando información del destino...</p>
      </div>
    );
  }

  return <Navigate to="/" />;
}

function DirectSpecialReleaseLoader({ 
  user, 
  onSelectCategory 
}: { 
  user: UserProfile; 
  onSelectCategory: (cat: 'corrective' | 'improvement' | 'iso' | 'special_release' | null) => void; 
}) {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onSelectCategory('special_release');
    setLoading(false);
  }, [id, onSelectCategory]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <Clock className="animate-spin mb-4 text-slate-300" size={32} />
        <p>Cargando información del destino...</p>
      </div>
    );
  }

  return <Navigate to={`/special-release/${id}`} />;
}

function DirectISOCalendarLoader({ 
  user, 
  onSelectCategory 
}: { 
  user: UserProfile; 
  onSelectCategory: (cat: 'corrective' | 'improvement' | 'iso' | 'special_release' | null) => void; 
}) {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onSelectCategory('iso');
    setLoading(false);
  }, [id, onSelectCategory]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <Clock className="animate-spin mb-4 text-slate-300" size={32} />
        <p>Cargando planificación ISO...</p>
      </div>
    );
  }

  return <Navigate to={`/iso-calendar/${id}${window.location.search}`} />;
}

function DirectChangeRequestLoader({ 
  user, 
  onSelectCategory 
}: { 
  user: UserProfile; 
  onSelectCategory: (cat: any) => void; 
}) {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onSelectCategory('change_management');
    setLoading(false);
  }, [id, onSelectCategory]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400">
        <Clock className="animate-spin mb-4 text-slate-300" size={32} />
        <p>Cargando gestión de cambios...</p>
      </div>
    );
  }

  return <Navigate to={`/change-request/${id}`} />;
}

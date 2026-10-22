import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { UserProfile } from '../types';

interface UserSelectProps {
  users: UserProfile[];
  value: string;
  onChange: (userId: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  dropdownPosition?: 'top' | 'bottom';
}

export const UserSelect: React.FC<UserSelectProps> = ({
  users,
  value,
  onChange,
  placeholder = 'Seleccione un usuario',
  className = '',
  required = false,
  dropdownPosition = 'bottom'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  const uniqueUsers = React.useMemo(() => {
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

  // Find currently selected user
  const selectedUser = uniqueUsers.find(u => u.id === value);

  // Filter users based on search (accent-insensitive, multi-word friendly)
  const filteredUsers = uniqueUsers.filter(u => {
    const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const searchStr = normalize(search).trim();
    if (!searchStr) return true;

    const name = normalize(u.displayName || '');
    const email = normalize(u.email || '');
    const role = normalize(u.role || '');

    // Split search into individual terms so "ivan sola" matches "Ivan Ariel Sola"
    const terms = searchStr.split(/\s+/);
    return terms.every(term => name.includes(term) || email.includes(term) || role.includes(term));
  });

  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearch('');
    }
  }, [isOpen]);

  const handleSelect = (userId: string) => {
    onChange(userId);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  return (
    <div ref={containerRef} className={`relative w-full ${isOpen ? 'z-50' : 'z-auto'} ${className}`} id="user-select-container">
      {/* Hidden input to support native form HTML5 validation if 'required' is set */}
      <input
        type="text"
        className="opacity-0 absolute pointer-events-none w-px h-px bottom-0 left-0"
        required={required}
        value={value}
        onChange={() => {}}
        onInvalid={(e) => {
          e.preventDefault();
          setIsOpen(true);
        }}
      />

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-left text-sm font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all shadow-sm hover:bg-slate-100"
      >
        <span className={`block truncate ${!selectedUser ? 'text-slate-400' : 'text-slate-800 font-medium'}`}>
          {selectedUser 
            ? `${selectedUser.displayName} (${selectedUser.email})` 
            : placeholder}
        </span>
        <span className="ml-2 flex items-center space-x-1 text-slate-400">
          {selectedUser && !required && (
            <X 
              size={16} 
              onClick={handleClear} 
              className="hover:text-slate-600 cursor-pointer"
            />
          )}
          <ChevronDown size={18} className={`transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
        </span>
      </button>

      {/* Dropdown Overlay */}
      {isOpen && (
        <div className={`absolute z-50 w-full min-w-[260px] left-0 rounded-xl bg-white border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in duration-100 ${
          dropdownPosition === 'top' 
            ? 'bottom-full mb-1.5 slide-in-from-bottom-2' 
            : 'top-full mt-1.5 slide-in-from-top-2'
        }`}>
          {/* Search Box */}
          <div className="p-2 border-b border-slate-100 flex items-center bg-slate-50">
            <Search size={16} className="text-slate-400 mr-2 ml-1 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              className="w-full bg-transparent border-0 outline-none text-sm text-slate-700 placeholder-slate-400 p-1 focus:ring-0"
              placeholder="Escriba nombre, apellido o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <X 
                size={16} 
                onClick={() => setSearch('')} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0 ml-1"
              />
            )}
          </div>

          {/* Options List */}
          <ul className="max-h-60 overflow-y-auto py-1 text-sm text-slate-700 divide-y divide-slate-50">
            {filteredUsers.length === 0 ? (
              <li className="px-4 py-3 text-center text-slate-400 text-xs">
                No se encontraron personas con ese nombre o email
              </li>
            ) : (
              filteredUsers.map((u) => {
                const isSelected = u.id === value;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(u.id)}
                      className={`w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors ${
                        isSelected 
                          ? 'bg-emerald-50 text-emerald-800 font-medium' 
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex flex-col truncate pr-2">
                        <span className="font-medium text-slate-800 truncate">{u.displayName}</span>
                        <span className="text-xs text-slate-400 truncate">{u.email}</span>
                      </div>
                      {isSelected && <Check size={16} className="text-emerald-600 flex-shrink-0" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Settings from './pages/Settings';
import Portfolio from './pages/Portfolio';
import LiveData from './pages/LiveData';
import Investments from './pages/Investments';
import Analysis from './pages/Analysis';
import { PERSISTENT_STATUS_EVENT, isPersistentHelperOnline } from './utils/persistentStorage.js';

const Sidebar = () => {
  const [persistentStatus, setPersistentStatus] = useState(() => ({
    online: isPersistentHelperOnline(),
    error: '',
  }));
  const linkStyle = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 mt-1.5 text-sm font-medium rounded-xl transition-all duration-200 ${
      isActive
        ? 'bg-blue-600/10 text-blue-400 border-l-4 border-blue-500 pl-3 font-semibold'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-l-4 border-transparent'
    }`;

  useEffect(() => {
    const handleStatus = (event) => {
      setPersistentStatus({
        online: Boolean(event.detail?.online),
        error: event.detail?.error || '',
      });
    };

    window.addEventListener(PERSISTENT_STATUS_EVENT, handleStatus);
    return () => window.removeEventListener(PERSISTENT_STATUS_EVENT, handleStatus);
  }, []);

  return (
    <div className="w-64 min-h-screen bg-slate-900 border-r border-slate-800/80 px-4 py-8 flex flex-col justify-between shrink-0">
      <div>
        <div className="px-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl shadow-lg shadow-blue-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                Stock Analyzer
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Terminal Inwestora</p>
            </div>
          </div>
        </div>

        <nav className="space-y-1">
          <p className="px-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Menu glowne</p>
          <NavLink to="/" className={linkStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.003 9.003 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
            Portfel
          </NavLink>
          <NavLink to="/investments" className={linkStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Inwestycje
          </NavLink>
          <NavLink to="/analysis" className={linkStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3a6.75 6.75 0 100 13.5 6.75 6.75 0 000-13.5zM15 15l6 6M9.75 6v3.75l2.25 1.5" />
            </svg>
            Analiza
          </NavLink>
          <NavLink to="/live" className={linkStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Dane Live
          </NavLink>
          <NavLink to="/settings" className={linkStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Ustawienia
          </NavLink>
        </nav>
      </div>

      <div className="bg-slate-800/40 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${persistentStatus.online ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></div>
          <p className="text-xs font-semibold text-slate-300">
            {persistentStatus.online ? 'Dane zapisane w /data' : 'Tryb cache przegladarki'}
          </p>
        </div>
        <p className="text-[10px] text-slate-500 mt-1">
          {persistentStatus.online
            ? 'Lokalna baza danych aktywna'
            : 'Uruchom helper, aby nowe zmiany byly trwale'}
        </p>
      </div>
    </div>
  );
};

function App() {
  return (
    <Router>
      <div className="flex min-h-screen font-sans bg-slate-950 text-slate-100 antialiased selection:bg-blue-600/30 selection:text-blue-200">
        <Sidebar />
        <main className="flex-1 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Portfolio />} />
            <Route path="/investments" element={<Investments />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/analysis/:assetId" element={<Analysis />} />
            <Route path="/live" element={<LiveData />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/data" element={<Navigate to="/settings" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;

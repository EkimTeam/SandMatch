import React from 'react';
import { Link, useLocation } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/tournaments' || path === '/') {
      return location.pathname === '/tournaments' || location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="container">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <img src="/static/img/logo.png" alt="SandMatch" className="h-7 w-auto rounded-md" />
              <div className="font-bold text-lg">SandMatch</div>
            </div>
            
            <nav className="flex items-center gap-3 flex-wrap">
              <Link 
                to="/tournaments" 
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/tournaments') 
                    ? 'bg-primary-100 text-primary-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Турниры
              </Link>
              <Link 
                to="/players" 
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/players') 
                    ? 'bg-primary-100 text-primary-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Игроки
              </Link>
              <Link 
                to="/stats" 
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive('/stats') 
                    ? 'bg-primary-100 text-primary-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Статистика
              </Link>
            </nav>
          </div>
        </div>
      </header>
      
      <main className="py-6">
        <div className="container">
          {children}
        </div>
      </main>
    </div>
  );
};

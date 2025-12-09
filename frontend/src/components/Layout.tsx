import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <div className="flex items-center justify-between py-3 md:py-4 gap-3 md:gap-6">
            <div className="flex items-center gap-3 flex-shrink-0">
              <img src="/static/img/logo.png" alt="BeachPlay" className="h-7 w-auto rounded-md" />
              <div className="font-bold text-lg whitespace-nowrap">BeachPlay</div>
            </div>

            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Переключить меню"
              onClick={() => setMobileOpen((prev) => !prev)}
            >
              Меню
            </button>

            <nav className="hidden md:flex items-center gap-3 flex-wrap">
              {/* Для рефери в меню только раздел Судейство */}
              {user?.role === 'REFEREE' ? (
                <Link
                  to="/referee"
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive('/referee')
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Судейство
                </Link>
              ) : (
                <>
                  {/* Турниры, рейтинг и статистика доступны гостям и авторизованным (кроме рефери) */}
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
                  {user && (
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
                  )}
                  <Link
                    to="/rating"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/rating')
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Рейтинг
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
                </>
              )}

              {/* Auth controls */}
              {user ? (
                <>
                  <Link
                    to="/profile"
                    className="text-sm text-gray-700 hover:text-primary-600 transition-colors"
                  >
                    {user.username}
                    {user.role && user.role !== 'REGISTERED' && (
                      <span className="ml-1 text-gray-400">[{user.role}]</span>
                    )}
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                    }}
                    className="px-3 py-2 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-800"
                  >
                    Выйти
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/login') ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Войти
                  </Link>
                  <Link
                    to="/register"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/register') ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Регистрация
                  </Link>
                </>
              )}
            </nav>
          </div>

          {mobileOpen && (
            <nav className="md:hidden border-t border-gray-100 pt-2 pb-3 mt-1 flex flex-col gap-1">
              {/* Для рефери в меню только раздел Судейство */}
              {user?.role === 'REFEREE' ? (
                <Link
                  to="/referee"
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive('/referee')
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  Судейство
                </Link>
              ) : (
                <>
                  {/* Турниры, рейтинг и статистика доступны гостям и авторизованным (кроме рефери) */}
                  <Link
                    to="/tournaments"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/tournaments')
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    Турниры
                  </Link>
                  {user && (
                    <Link
                      to="/players"
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive('/players')
                          ? 'bg-primary-100 text-primary-700'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                      onClick={() => setMobileOpen(false)}
                    >
                      Игроки
                    </Link>
                  )}
                  <Link
                    to="/rating"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/rating')
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    Рейтинг
                  </Link>
                  <Link
                    to="/stats"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/stats')
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    Статистика
                  </Link>
                </>
              )}

              {/* Auth controls */}
              {user ? (
                <>
                  <Link
                    to="/profile"
                    className="px-3 py-2 text-sm text-gray-700 hover:text-primary-600 transition-colors"
                    onClick={() => setMobileOpen(false)}
                  >
                    {user.username}
                    {user.role && user.role !== 'REGISTERED' && (
                      <span className="ml-1 text-gray-400">[{user.role}]</span>
                    )}
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      navigate('/login');
                      setMobileOpen(false);
                    }}
                    className="mt-1 mx-3 px-3 py-2 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 text-left"
                  >
                    Выйти
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/login') ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    Войти
                  </Link>
                  <Link
                    to="/register"
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive('/register') ? 'bg-primary-100 text-primary-700' : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    Регистрация
                  </Link>
                </>
              )}
            </nav>
          )}
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

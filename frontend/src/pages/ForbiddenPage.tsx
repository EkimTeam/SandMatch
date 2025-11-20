import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const ForbiddenPage: React.FC = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const next = params.get('next') || '/';
  const { user } = useAuth();
  const isAuthenticated = !!user;

  return (
    <div className="form-signin-container">
      <div className="text-center">
        <h2 className="h3 mb-3 fw-normal">Нет доступа</h2>
        <p className="mb-3 text-muted">
          {isAuthenticated
            ? 'У вас нет прав для просмотра этой страницы. Обратитесь к администратору.'
            : 'У вас нет прав для просмотра этой страницы. Пожалуйста, войдите в систему.'}
        </p>

        {!isAuthenticated && (
          <div className="mt-4">
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="btn btn-primary px-5">
              Войти
            </Link>
          </div>
        )}

        <p className="mt-4 mb-3 text-muted" style={{ fontSize: '0.9em' }}>
          Запрошенный URL: <code className="text-break">{next}</code>
        </p>
      </div>
    </div>
  );
};

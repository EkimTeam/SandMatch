import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const STORAGE_KEY = 'cookie_notice_accepted_v1';

export const CookieNotice: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'true') return;
      setVisible(true);
    } catch {
      //Если localStorage недоступен, просто показываем баннер один раз
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, 'true');
      }
    } catch {
      // игнорируем ошибки работы с localStorage
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20">
      <div className="container pb-4 px-4">
        <div className="bg-gray-900 text-gray-100 text-sm rounded-lg shadow-lg px-4 py-3 md:px-6 md:py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <p className="leading-snug">
            Мы используем cookies и аналогичные технологии для аутентификации пользователей и улучшения работы сайта.
            Продолжая использовать BeachPlay, вы соглашаетесь с использованием cookies. Подробнее см. в{' '}
            <Link to="/privacy" className="underline text-gray-200 hover:text-white" target="_blank" rel="noopener noreferrer">
              Политике обработки персональных данных
            </Link>
            .
          </p>
          <button
            type="button"
            onClick={handleAccept}
            className="self-start md:self-auto inline-flex items-center px-4 py-2 rounded-md bg-gray-100 text-gray-900 text-sm font-medium hover:bg-white transition-colors"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieNotice;

import React from 'react';
import { Link } from 'react-router-dom';

export const HomePage: React.FC = () => {
  return (
    <div className="text-center py-12">
      <h1 className="text-4xl font-bold mb-4 mt-0">BeachPlay запущен</h1>
      <p className="text-lg text-gray-600 mb-8">
        Локальная среда работает. Перейдите в админку для первичного наполнения данных.
      </p>
      <Link to="/sm-admin/" className="btn text-lg px-6 py-3">
        Открыть админку
      </Link>
    </div>
  );
};

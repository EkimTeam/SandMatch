import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatDateTime } from '../services/date';
import { tournamentRegistrationApi, WebRegistrationStateResponse, WebTournamentRegistration } from '../services/api';

const TournamentRegistrationPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const idNum = id ? Number(id) : NaN;

  const [state, setState] = useState<WebRegistrationStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadState = async () => {
    if (!idNum || Number.isNaN(idNum)) return;
    try {
      setLoading(true);
      setError(null);

      // Анонимный пользователь: используем публичный эндпоинт, который не требует авторизации
      if (!user) {
        const data = await tournamentRegistrationApi.getPublicState(idNum);
        setState(data);
        return;
      }

      const data = await tournamentRegistrationApi.getState(idNum);
      setState(data);
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.response?.data?.error || 'Не удалось загрузить состояние регистрации';
      setError(String(detail));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNum]);

  const handleAfterAction = async (msg?: string) => {
    if (msg) setSuccess(msg);
    await loadState();
  };

  const handleRegisterSingle = async () => {
    if (!idNum) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await tournamentRegistrationApi.registerSingle(idNum);
      await handleAfterAction('Регистрация выполнена');
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Ошибка регистрации';
      setError(String(detail));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelRegistration = async () => {
    if (!idNum) return;
    if (!window.confirm('Отменить регистрацию на турнир?')) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const resp = await tournamentRegistrationApi.cancelRegistration(idNum);
      await handleAfterAction(resp.detail || 'Регистрация отменена');
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Ошибка отмены регистрации';
      setError(String(detail));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-gray-700">Загрузка состояния регистрации...</div>
      </div>
    );
  }

  const { tournament, participants } = state;
  const myReg: WebTournamentRegistration | null = state.my_registration;

  const isAnon = !user;
  const isRegisteredUser = !!user && user.role === 'REGISTERED';
  const hasLinkedPlayer = !!user?.player_id;

  const renderStatusLabel = (status: string) => {
    if (status === 'created') return 'Идет регистрация';
    if (status === 'active') return 'Турнир идет';
    if (status === 'completed') return 'Турнир завершен';
    return status;
  };

  const registeredCount = tournament.registered_count ?? participants.main_list.length + participants.reserve_list.length;

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Регистрация на турнир</h1>
        <p className="text-gray-900 font-semibold mb-1">{tournament.name}</p>
        <div className="text-sm text-gray-700 space-y-1">
          <p>
            {tournament.date && (
              <>
                <span className="font-medium">Дата:</span> {formatDate(tournament.date)}
                {' · '}
              </>
            )}
            <span className="font-medium">Система:</span> {tournament.get_system_display || tournament.system}
            {' · '}
            <span className="font-medium">Формат:</span> {tournament.get_participant_mode_display || tournament.participant_mode}
          </p>
          {tournament.organizer_name && (
            <p>
              <span className="font-medium">Организатор:</span> {tournament.organizer_name}
            </p>
          )}
          <p>
            <span className="font-medium">Участники:</span>{' '}
            {registeredCount}
            {typeof tournament.planned_participants === 'number' && tournament.planned_participants > 0 && (
              <> / {tournament.planned_participants}</>
            )}
          </p>
          {tournament.status && (
            <p className="text-gray-600 text-xs">
              (статус: {renderStatusLabel(tournament.status)})
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          {success}
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <h2 className="text-xl font-semibold mb-3">Мой статус</h2>

        {myReg ? (
          <div className="mb-3">
            <p className="text-gray-800 mb-1">
              <span className="font-semibold">Статус:</span> {myReg.status_display}
            </p>
            {myReg.partner_name && (
              <p className="text-gray-800 mb-1">
                <span className="font-semibold">Напарник:</span> {myReg.partner_name}
              </p>
            )}
            <p className="text-gray-600 text-sm">
              Зарегистрирован: {formatDateTime(myReg.registered_at)}
            </p>
          </div>
        ) : (
          <p className="mb-3 text-gray-700">Вы еще не зарегистрированы на этот турнир.</p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {/* Анонимный пользователь */}
          {isAnon && (
            <>
              <p className="text-gray-700 text-sm">
                Для регистрации на турнир надо зарегистрироваться на BeachPlay.ru и связать свой аккаунт с игроком из базы данных BeachPlay.ru.
              </p>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm self-start"
              >
                Перейти к регистрации в BeachPlay.ru
              </button>
            </>
          )}

          {/* REGISTERED без привязанного BP-игрока и без регистрации на этот турнир
              (временно отключено, т.к. признак hasLinkedPlayer на фронте может быть неточным) */}

          {/* REGISTERED c привязанным BP-игроком — кнопка регистрации */}
          {isRegisteredUser && hasLinkedPlayer && !myReg && tournament.participant_mode === 'singles' && (
            <button
              onClick={handleRegisterSingle}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 text-sm self-start"
            >
              Зарегистрироваться
            </button>
          )}

          {/* Отмена регистрации доступна для вошедшего пользователя с myReg */}
          {myReg && !!user && (
            <button
              onClick={handleCancelRegistration}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400 text-sm self-start"
            >
              Отменить регистрацию
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">Основной список</h2>
          {participants.main_list.length === 0 ? (
            <p className="text-gray-500 text-sm">Пока никого нет.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {participants.main_list.map((reg, idx) => (
                <li key={reg.id} className="py-2 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-900">
                      {idx + 1}. {reg.player_name}
                      {reg.partner_name && ` / ${reg.partner_name}`}
                    </p>
                    <p className="text-xs text-gray-500">{reg.status_display}</p>
                  </div>
                  {myReg && myReg.id === reg.id && (
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">Это вы</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white shadow rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-3">Резерв</h2>
          {participants.reserve_list.length === 0 ? (
            <p className="text-gray-500 text-sm">Резерв пока пуст.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {participants.reserve_list.map((reg, idx) => (
                <li key={reg.id} className="py-2 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-gray-900">
                      {idx + 1}. {reg.player_name}
                      {reg.partner_name && ` / ${reg.partner_name}`}
                    </p>
                    <p className="text-xs text-gray-500">{reg.status_display}</p>
                  </div>
                  {myReg && myReg.id === reg.id && (
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">Это вы</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default TournamentRegistrationPage;

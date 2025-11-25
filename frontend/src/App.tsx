import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { TournamentListPage } from './pages/TournamentListPage';
import { TournamentDetailPage } from './pages/TournamentDetailPage';
import { PlayersPage } from './pages/PlayersPage';
import { KnockoutPage } from './pages/KnockoutPage';
import { KingPage } from './pages/KingPage';
import { StatsPage } from './pages/StatsPage';
import { PlayerCardPage } from './pages/PlayerCardPage';
import { BTRPlayerCardPage } from './pages/BTRPlayerCardPage';
import { PlayersH2HPage } from './pages/PlayersH2HPage';
import { RatingPage } from './pages/RatingPage';
import { RefereePage } from './pages/RefereePage';
import { PasswordResetRequestPage } from './pages/PasswordResetRequestPage';
import { PasswordResetConfirmPage } from './pages/PasswordResetConfirmPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { UserRolesPage } from './pages/UserRolesPage';
import { getAccessToken } from './services/auth';
import { AuthProvider } from './context/AuthContext';

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = getAccessToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Layout>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/reset-password" element={<PasswordResetRequestPage />} />
            <Route path="/reset-password/confirm" element={<PasswordResetConfirmPage />} />
            {/* Публичные страницы: турнирный обзор, рейтинг и сводная статистика */}
            <Route path="/" element={<TournamentListPage />} />
            <Route path="/tournaments" element={<TournamentListPage />} />
            <Route path="/rating" element={<RatingPage />} />
            <Route path="/stats" element={<StatsPage />} />

            {/* Детали турниров доступны анонимам в режиме read-only, UI-гейтинг по ролям внутри страниц */}
            <Route path="/tournaments/:id/round_robin" element={<TournamentDetailPage />} />
            <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
            <Route path="/tournaments/:id/knockout" element={<KnockoutPage />} />
            <Route path="/tournaments/:id/king" element={<KingPage />} />

            {/* BTR Player Card - публичная страница */}
            <Route path="/btr/players/:id" element={<BTRPlayerCardPage />} />

            {/* Остальное требует авторизации */}
            <Route path="/referee" element={<RequireAuth><RefereePage /></RequireAuth>} />
            <Route path="/players" element={<RequireAuth><PlayersPage /></RequireAuth>} />
            <Route path="/players/:id" element={<RequireAuth><PlayerCardPage /></RequireAuth>} />
            <Route path="/players/h2h/:id1/:id2" element={<RequireAuth><PlayersH2HPage /></RequireAuth>} />
            <Route path="/admin/roles" element={<RequireAuth><UserRolesPage /></RequireAuth>} />
            <Route path="/forbidden" element={<ForbiddenPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AuthProvider>
    </Router>
  );
}

export default App;

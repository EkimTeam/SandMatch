import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { TournamentListPage } from './pages/TournamentListPage';
import { TournamentDetailPage } from './pages/TournamentDetailPage';
import TournamentRegistrationPage from './pages/TournamentRegistrationPage';
import { PlayersPage } from './pages/PlayersPage';
import { KnockoutPage } from './pages/KnockoutPage';
import { KingPage } from './pages/KingPage';
import { KingPage as KingPageOld } from './pages/KingPage_old';
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
import { AdminUserLinksPage } from './pages/AdminUserLinksPage';
import ProfilePage from './pages/ProfilePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import { getAccessToken } from './services/auth';
import { AuthProvider, useAuth } from './context/AuthContext';

// Telegram Mini App pages
import MiniAppLayout from './pages/MiniApp/MiniAppLayout';
import MiniAppHome from './pages/MiniApp/MiniAppHome';
import MiniAppTournaments from './pages/MiniApp/MiniAppTournaments';
import MiniAppTournamentDetail from './pages/MiniApp/MiniAppTournamentDetail';
import MiniAppProfile from './pages/MiniApp/MiniAppProfile';
import MiniAppMyTournaments from './pages/MiniApp/MiniAppMyTournaments';
import MiniAppInvitations from './pages/MiniApp/MiniAppInvitations';

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = getAccessToken();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const token = getAccessToken();
  const { user } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user?.role !== 'ADMIN') {
    return <Navigate to="/forbidden" replace />;
  }
  return children;
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Telegram Mini App routes - БЕЗ основного Layout */}
          <Route path="/mini-app" element={<MiniAppLayout />}>
            <Route index element={<MiniAppHome />} />
            <Route path="tournaments" element={<MiniAppTournaments />} />
            <Route path="tournaments/:id" element={<MiniAppTournamentDetail />} />
            <Route path="profile" element={<MiniAppProfile />} />
            <Route path="my-tournaments" element={<MiniAppMyTournaments />} />
            <Route path="invitations" element={<MiniAppInvitations />} />
          </Route>

          {/* Все остальные routes с основным Layout */}
          <Route path="/*" element={
            <Layout>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/reset-password" element={<PasswordResetRequestPage />} />
                <Route path="/reset-password/confirm" element={<PasswordResetConfirmPage />} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                {/* Публичные страницы: турнирный обзор, рейтинг и сводная статистика */}
                <Route path="/" element={<TournamentListPage />} />
                <Route path="/tournaments" element={<TournamentListPage />} />
                <Route path="/rating" element={<RatingPage />} />
                <Route path="/stats" element={<StatsPage />} />

                {/* Детали турниров доступны анонимам в режиме read-only, UI-гейтинг по ролям внутри страниц.
                    Страница регистрации турнира доступна всем, включая анонимов. */}
                <Route path="/tournaments/:id/round_robin" element={<TournamentDetailPage />} />
                <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
                <Route path="/tournaments/:id/registration" element={<TournamentRegistrationPage />} />
                <Route path="/tournaments/:id/knockout" element={<KnockoutPage />} />
                <Route path="/tournaments/:id/king" element={<KingPage />} />
                <Route path="/tournaments/:id/king-old" element={<RequireAdmin><KingPageOld /></RequireAdmin>} />

                {/* BTR Player Card - публичная страница */}
                <Route path="/btr/players/:id" element={<BTRPlayerCardPage />} />

                {/* Остальное требует авторизации */}
                <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
                <Route path="/referee" element={<RequireAuth><RefereePage /></RequireAuth>} />
                <Route path="/players" element={<RequireAuth><PlayersPage /></RequireAuth>} />
                <Route path="/players/:id" element={<RequireAuth><PlayerCardPage /></RequireAuth>} />
                <Route path="/players/h2h/:id1/:id2" element={<RequireAuth><PlayersH2HPage /></RequireAuth>} />
                <Route path="/admin/roles" element={<RequireAuth><UserRolesPage /></RequireAuth>} />
                <Route path="/admin/user-links" element={<RequireAdmin><AdminUserLinksPage /></RequireAdmin>} />
                <Route path="/forbidden" element={<ForbiddenPage />} />
                
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          } />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;

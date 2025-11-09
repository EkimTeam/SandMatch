import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { TournamentListPage } from './pages/TournamentListPage';
import { TournamentDetailPage } from './pages/TournamentDetailPage';
import { PlayersPage } from './pages/PlayersPage';
import { KnockoutPage } from './pages/KnockoutPage';
import { KingPage } from './pages/KingPage';
import { StatsPage } from './pages/StatsPage';
import { getAccessToken } from './services/auth';

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
      <Layout>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/tournaments" element={<RequireAuth><TournamentListPage /></RequireAuth>} />
          <Route path="/tournaments/:id/round_robin" element={<RequireAuth><TournamentDetailPage /></RequireAuth>} />
          <Route path="/tournaments/:id" element={<RequireAuth><TournamentDetailPage /></RequireAuth>} />
          <Route path="/tournaments/:id/knockout" element={<RequireAuth><KnockoutPage /></RequireAuth>} />
          <Route path="/tournaments/:id/king" element={<RequireAuth><KingPage /></RequireAuth>} />
          <Route path="/players" element={<RequireAuth><PlayersPage /></RequireAuth>} />
          <Route path="/stats" element={<RequireAuth><StatsPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;

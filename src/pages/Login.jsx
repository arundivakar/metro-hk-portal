import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginForm from '../components/auth/LoginForm';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { ROLES } from '../lib/constants';

export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, role } = useAuthStore();
  const { selectedStation } = useStationStore();

  // Already logged in — redirect appropriately
  useEffect(() => {
    if (!isAuthenticated) return;
    if (role === ROLES.ALS || role === ROLES.HKTL) {
      navigate('/dashboard', { replace: true });
    } else if (selectedStation) {
      navigate('/dashboard', { replace: true });
    } else {
      navigate('/select-station', { replace: true });
    }
  }, [isAuthenticated, role, selectedStation, navigate]);

  const handleLoginSuccess = () => {
    const { role: r } = useAuthStore.getState();
    if (r === ROLES.ALS || r === ROLES.HKTL) {
      navigate('/dashboard', { replace: true });
    } else {
      navigate('/select-station', { replace: true });
    }
  };

  return <LoginForm onSuccess={handleLoginSuccess} />;
}

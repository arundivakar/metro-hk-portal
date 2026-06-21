import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useStationStore } from '../../store/stationStore';
import { PageLoader } from '../ui/Spinner';
import { ROLES } from '../../lib/constants';

/**
 * ProtectedRoute — guards pages that require authentication.
 * Also redirects HKS/SC to station selection if no station is selected.
 *
 * @param {string[]} allowedRoles - If provided, restricts access to these roles.
 */
export default function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, isLoading, role } = useAuthStore();
  const { selectedStation } = useStationStore();
  const location = useLocation();

  // Auth still loading — show spinner
  if (isLoading) return <PageLoader />;

  // Not logged in — redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Role check
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  // HKS/SC must select a station before accessing any page
  const needsStation = role === ROLES.HKS || role === ROLES.SC;
  const isOnStationSelect = location.pathname === '/select-station';

  if (needsStation && !selectedStation && !isOnStationSelect) {
    return <Navigate to="/select-station" replace />;
  }

  return children;
}

import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';

// Auth
import ProtectedRoute from './components/auth/ProtectedRoute';
import StationSelectorModal from './components/station/StationSelectorModal';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import StockReceived from './pages/StockReceived';
import StockMovement from './pages/StockMovement';
import Requests from './pages/Requests';
import Approvals from './pages/Approvals';
import AssetLifecycle from './pages/AssetLifecycle';
import Reports from './pages/Reports';
import MonthlyBill from './pages/MonthlyBill';
import NotFound from './pages/NotFound';
import PrintChecklist from './pages/PrintChecklist';
import DataInitialization from './pages/DataInitialization';

// Styles
import './styles/index.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';

import { ROLES } from './lib/constants';

export default function App() {
  useAuth(); // Initialize auth listener

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Station Selection — HKS & SC only */}
        <Route
          path="/select-station"
          element={
            <ProtectedRoute allowedRoles={[ROLES.HKS, ROLES.SC]}>
              <StationSelectorModal />
            </ProtectedRoute>
          }
        />

        {/* Protected App Routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/inventory"
          element={
            <ProtectedRoute>
              <Inventory />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock-received"
          element={
            <ProtectedRoute allowedRoles={[ROLES.SC, ROLES.ALS]}>
              <StockReceived />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock-movement"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ALS, ROLES.SC]}>
              <StockMovement />
            </ProtectedRoute>
          }
        />

        <Route
          path="/requests"
          element={
            <ProtectedRoute>
              <Requests />
            </ProtectedRoute>
          }
        />

        <Route
          path="/approvals"
          element={
            <ProtectedRoute allowedRoles={[ROLES.SC, ROLES.ALS, ROLES.HKTL]}>
              <Approvals />
            </ProtectedRoute>
          }
        />

        <Route
          path="/assets"
          element={
            <ProtectedRoute>
              <AssetLifecycle />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute allowedRoles={[ROLES.SC, ROLES.ALS, ROLES.HKTL]}>
              <Reports />
            </ProtectedRoute>
          }
        />

        <Route
          path="/stock-verification"
          element={
            <ProtectedRoute allowedRoles={[ROLES.SC, ROLES.ALS, ROLES.HKTL]}>
              <PrintChecklist />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ALS]}>
              <DataInitialization />
            </ProtectedRoute>
          }
        />

        <Route
          path="/monthly-bill"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ALS]}>
              <MonthlyBill />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>

      {/* Global Toast Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          },
          success: {
            iconTheme: { primary: '#2d6a4f', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#d62828', secondary: '#fff' },
          },
        }}
      />
    </BrowserRouter>
  );
}

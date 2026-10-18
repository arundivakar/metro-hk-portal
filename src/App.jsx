import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './hooks/useAuth';
import { useVersionCheck } from './hooks/useVersionCheck';

// Auth
import ProtectedRoute from './components/auth/ProtectedRoute';
import StationSelectorModal from './components/station/StationSelectorModal';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import StockReceived from './pages/StockReceived';
import DepotTransfer from './pages/DepotTransfer';
import StockMovement from './pages/StockMovement';
import Requests from './pages/Requests';
import Approvals from './pages/Approvals';
import AssetLifecycle from './pages/AssetLifecycle';
import Reports from './pages/Reports';
import MonthlyBill from './pages/MonthlyBill';
import NotFound from './pages/NotFound';
import PrintChecklist from './pages/PrintChecklist';
import DataInitialization from './pages/DataInitialization';
import BusinessContinuity from './pages/BusinessContinuity';
import ISTAudit from './pages/ISTAudit';

// Styles
import './styles/index.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';

import { ROLES } from './lib/constants';

export default function App() {
  useAuth(); // Initialize auth listener
  const { updateAvailable, reload, dismiss } = useVersionCheck();

  return (
    <>
    {updateAvailable && (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'var(--color-primary-800, #1e3a5f)',
        color: '#fff', padding: '10px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        fontSize: '14px', fontFamily: 'Inter, sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
      }}>
        <span>🔄 A new version is available. Refresh to update the portal.</span>
        <button onClick={reload} style={{ background: '#fff', color: 'var(--color-primary-800, #1e3a5f)', border: 'none', borderRadius: 6, padding: '4px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Refresh Now</button>
        <button onClick={dismiss} style={{ background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Dismiss</button>
      </div>
    )}
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
          path="/depot-transfer"
          element={
            <ProtectedRoute allowedRoles={[ROLES.SC]}>
              <DepotTransfer />
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

        <Route
          path="/business-continuity"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ALS]}>
              <BusinessContinuity />
            </ProtectedRoute>
          }
        />

        <Route
          path="/ist-audit"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ALS]}>
              <ISTAudit />
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
    </>
  );
}

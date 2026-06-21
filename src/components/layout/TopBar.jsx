import React from 'react';
import { Bell, MapPin, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useStationStore } from '../../store/stationStore';
import { ROLES } from '../../lib/constants';

/**
 * TopBar — page title area + station chip + notification placeholder
 * @param {string} title - Page title
 * @param {string} subtitle - Optional subtitle
 * @param {node} actions - Optional right-side action buttons
 * @param {function} onChangeStation - Called when user clicks "Change" station
 */
export default function TopBar({ title, subtitle, actions, onChangeStation }) {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();

  const showStation = role !== ROLES.ALS && selectedStation;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div>
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
      </div>

      <div className="topbar-right">
        {/* Station chip for HKS/SC */}
        {showStation && (
          <div className="topbar-station-chip">
            <MapPin size={12} />
            <span>{selectedStation.code}</span>
            <span style={{ color: 'var(--color-gray-400)', fontWeight: 400 }}>
              {selectedStation.name}
            </span>
            {onChangeStation && (
              <button
                className="topbar-change-btn"
                onClick={onChangeStation}
                title="Change working station"
              >
                <RefreshCw size={11} style={{ display: 'inline', marginRight: 3 }} />
                Change
              </button>
            )}
          </div>
        )}

        {/* ALS chip */}
        {role === ROLES.ALS && (
          <div className="topbar-station-chip" style={{ color: 'var(--color-success-600)', borderColor: 'var(--color-success-200)', background: 'var(--color-success-50)' }}>
            <span>All Stations</span>
          </div>
        )}

        {/* Notification bell placeholder */}
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px', borderRadius: '50%' }}
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>

        {/* Page-level actions */}
        {actions && <div style={{ display: 'flex', gap: 'var(--space-2)' }}>{actions}</div>}
      </div>
    </header>
  );
}

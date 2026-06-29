import React from 'react';
import { Bell, MapPin, RefreshCw, Menu } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useStationStore } from '../../store/stationStore';
import { ROLES, ALS_GROUPS } from '../../lib/constants';

/**
 * TopBar — UI polished. Zero logic/prop/API changes.
 */
export default function TopBar({ title, subtitle, actions, onChangeStation, onMenuClick }) {
  const { role } = useAuthStore();
  const { selectedStation, alsGroupFilter, setAlsGroupFilter } = useStationStore();

  const showStation = role !== ROLES.ALS && selectedStation;

  return (
    <header className="topbar">
      <div className="topbar-left">
        {onMenuClick && (
          <button
            className="btn btn-ghost topbar-menu-btn"
            onClick={onMenuClick}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
        )}
        <div>
          <div className="topbar-title">{title}</div>
          {subtitle && <div className="topbar-subtitle">{subtitle}</div>}
        </div>
      </div>

      <div className="topbar-right">
        {/* Station chip — HKS/SC */}
        {showStation && (
          <div className="topbar-station-chip">
            <MapPin size={11} />
            <span style={{ fontWeight: 700 }}>{selectedStation.code}</span>
            <span style={{ color: 'var(--color-primary-500)', fontWeight: 400 }}>
              {selectedStation.name}
            </span>
            {onChangeStation && (
              <button
                className="topbar-change-btn"
                onClick={onChangeStation}
                title="Change working station"
              >
                <RefreshCw size={10} style={{ display: 'inline', marginRight: 2 }} />
                Change
              </button>
            )}
          </div>
        )}

        {/* ALS Group Dropdown */}
        {role === ROLES.ALS && (
          <div
            className="topbar-station-chip"
            style={{
              color: 'var(--color-primary-700)',
              borderColor: 'var(--color-primary-200)',
              background: 'var(--color-primary-50)',
            }}
          >
            <MapPin size={11} />
            <select
              value={alsGroupFilter}
              onChange={(e) => setAlsGroupFilter(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                fontWeight: 600,
                fontSize: 'var(--font-size-xs)',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '110px',
                fontFamily: 'var(--font-family)',
              }}
              aria-label="Select ALS group"
            >
              {Object.keys(ALS_GROUPS).map((group) => (
                <option key={group} value={group} style={{ color: '#000' }}>
                  {group}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Notification bell */}
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px', borderRadius: '50%' }}
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell size={15} />
        </button>

        {/* Page-level actions */}
        {actions && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

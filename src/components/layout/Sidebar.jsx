import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, PackagePlus, TrendingDown,
  ClipboardList, CheckSquare, Boxes, BarChart2,
  ChevronLeft, ChevronRight, LogOut, Train, Database,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useStationStore } from '../../store/stationStore';
import { NAV_ITEMS, ROLES } from '../../lib/constants';

const ICON_MAP = {
  LayoutDashboard, Package, PackagePlus, TrendingDown,
  ClipboardList, CheckSquare, Boxes, BarChart2, Database,
};

function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function Sidebar({ mobileOpen, setMobileOpen }) {
  const [collapsed, setCollapsed] = useState(false);
  const { profile, role, logout } = useAuthStore();
  const { selectedStation, clearStation } = useStationStore();
  const navigate = useNavigate();

  const navItems = NAV_ITEMS[role] ?? [];

  const handleLogout = async () => {
    clearStation();
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      {mobileOpen && (
        <div className="mobile-overlay active" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
        aria-label="Main sidebar"
      >
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon" style={{ background: 'transparent', padding: 0 }}>
            <img
              src="/kmrl_logo.png"
              alt="KMRL Logo"
              style={{ width: '26px', height: '26px', objectFit: 'contain' }}
            />
          </div>
          {!collapsed && (
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-title">Metro HK Portal</div>
              <div className="sidebar-brand-sub">Housekeeping &amp; Inventory</div>
            </div>
          )}
        </div>

        {/* Station Badge — HKS / SC only */}
        {role !== ROLES.ALS && selectedStation && !collapsed && (
          <div className="sidebar-station-badge">
            <div className="sidebar-station-code">{selectedStation.code}</div>
            <div className="sidebar-station-name">{selectedStation.name}</div>
          </div>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const IconComponent = ICON_MAP[item.icon];
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `sidebar-nav-item${isActive ? ' active' : ''}`
                }
                title={collapsed ? item.label : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <span className="sidebar-nav-icon">
                  {IconComponent && <IconComponent size={17} />}
                </span>
                {!collapsed && (
                  <span className="sidebar-nav-text">{item.label}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {getInitials(profile?.full_name ?? profile?.employee_id ?? '?')}
            </div>
            {!collapsed && (
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">
                  {profile?.full_name ?? profile?.employee_id ?? 'User'}
                </div>
                <div className="sidebar-user-role">{role}</div>
              </div>
            )}
            <button
              className="sidebar-logout-btn"
              onClick={handleLogout}
              title="Logout"
              aria-label="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* Collapse Toggle */}
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </aside>
    </>
  );
}

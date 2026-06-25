import React from 'react';

export function Card({ children, className = '', ...props }) {
  return (
    <div className={`card ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }) {
  return (
    <div className="card-header">
      <div className="card-title">
        {icon && <span style={{ color: 'var(--color-accent-500)' }}>{icon}</span>}
        <div>
          <div>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-400)', fontWeight: 400, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function CardBody({ children, className = '' }) {
  return <div className={`card-body ${className}`}>{children}</div>;
}

export function CardFooter({ children }) {
  return <div className="card-footer">{children}</div>;
}

/**
 * KPI summary card
 */
export function KpiCard({ label, value, icon, colorClass = 'kpi-icon-primary', change }) {
  return (
    <div className="kpi-card animate-fade-in">
      <div className="kpi-card-header">
        <div className="kpi-label">{label}</div>
        <div className={`kpi-icon ${colorClass}`}>{icon}</div>
      </div>
      <div className="kpi-value">{value ?? '—'}</div>
      {change && <div className="kpi-change">{change}</div>}
    </div>
  );
}

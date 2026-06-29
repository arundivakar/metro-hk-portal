import React from 'react';

/**
 * Card, CardHeader, CardBody, CardFooter, KpiCard
 * UI polished — zero logic/prop changes.
 */
export function Card({ children, className = '', style, ...props }) {
  return (
    <div className={`card ${className}`} style={style} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, icon, actions, children, className = '' }) {
  return (
    <div className={`card-header ${className}`}>
      <div className="card-title">
        {icon && (
          <span style={{
            display: 'flex',
            alignItems: 'center',
            color: 'var(--color-primary-500)',
            flexShrink: 0,
          }}>
            {icon}
          </span>
        )}
        {title}
      </div>
      {(actions || children) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {actions}
          {children}
        </div>
      )}
    </div>
  );
}

export function CardBody({ children, className = '', style }) {
  return (
    <div className={`card-body ${className}`} style={style}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '', style }) {
  return (
    <div className={`card-footer ${className}`} style={style}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, icon, colorClass = 'kpi-icon-primary', change, className = '' }) {
  return (
    <div className={`kpi-card ${className}`}>
      <div className="kpi-card-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kpi-label">{label}</div>
        </div>
        {icon && (
          <div className={`kpi-icon ${colorClass}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="kpi-value">{value}</div>
      {change && <div className="kpi-change">{change}</div>}
    </div>
  );
}

export default Card;

import React from 'react';
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';

const icons = {
  warning: <AlertTriangle size={16} />,
  info:    <Info size={16} />,
  success: <CheckCircle size={16} />,
  danger:  <XCircle size={16} />,
};

/**
 * Inline alert banner
 * @param {string} variant - success | warning | danger | info
 */
export default function Alert({ variant = 'info', children, className = '' }) {
  return (
    <div className={`alert alert-${variant} ${className}`} role="alert">
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icons[variant]}</span>
      <div>{children}</div>
    </div>
  );
}

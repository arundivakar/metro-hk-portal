import React from 'react';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_COLORS,
} from '../../lib/constants';

/**
 * Generic Badge
 * @param {string} variant - success | warning | danger | info | neutral | primary | accent
 */
export function Badge({ children, variant = 'neutral', dot = false }) {
  return (
    <span className={`badge badge-${variant}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

/** Auto-colored badge for request status */
export function RequestStatusBadge({ status }) {
  const color = REQUEST_STATUS_COLORS[status] ?? 'neutral';
  const label = REQUEST_STATUS_LABELS[status] ?? status;
  return (
    <span className={`badge badge-${color}`}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}

/** Auto-colored badge for asset lifecycle status */
export function AssetStatusBadge({ status }) {
  const color = ASSET_STATUS_COLORS[status] ?? 'neutral';
  const label = ASSET_STATUS_LABELS[status] ?? status;
  return (
    <span className={`badge badge-${color}`}>
      {label}
    </span>
  );
}

/** Role badge */
export function RoleBadge({ role }) {
  const map = {
    HKS: 'primary',
    SC: 'accent',
    ALS: 'success',
  };
  return <span className={`badge badge-${map[role] ?? 'neutral'}`}>{role}</span>;
}

/** Priority badge */
export function PriorityBadge({ priority }) {
  return (
    <span className={`badge badge-${priority === 'urgent' ? 'danger' : 'neutral'}`}>
      {priority === 'urgent' ? '🔴 Urgent' : 'Normal'}
    </span>
  );
}

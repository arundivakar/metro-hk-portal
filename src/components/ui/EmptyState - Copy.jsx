import React from 'react';
import { Inbox } from 'lucide-react';

export default function EmptyState({
  title = 'No data found',
  description = 'Nothing to display here yet.',
  icon,
  action,
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {icon ?? <Inbox size={28} />}
      </div>
      <div>
        <p className="empty-state-title">{title}</p>
        {description && <p className="empty-state-desc">{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

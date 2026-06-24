import React from 'react';
import { BarChart2, Construction } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardBody } from '../components/ui/Card';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { ROLES } from '../lib/constants';

export default function Reports() {
  const { role } = useAuthStore();
  const { selectedStation } = useStationStore();

  return (
    <Layout
      title="Reports"
      subtitle={(role === ROLES.ALS || role === ROLES.HKTL) ? 'System-wide analytics' : selectedStation?.name}
    >
      <Card>
        <CardBody>
          <div className="reports-coming-soon">
            <div className="reports-coming-soon-icon">
              <BarChart2 size={40} />
            </div>
            <div>
              <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-gray-800)' }}>
                Analytics Coming Soon
              </h2>
              <p style={{ color: 'var(--color-gray-500)', marginTop: 'var(--space-2)', maxWidth: 400 }}>
                The reports module will include consumption trends, stock movement charts,
                monthly summaries, and station-wise comparisons in the next phase.
              </p>
            </div>
            <div style={{
              display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center',
              marginTop: 'var(--space-2)',
            }}>
              {[
                'Monthly Consumption Report',
                'Stock Movement Summary',
                'Request Approval Analytics',
                'Low Stock History',
                'Asset Lifecycle Report',
                'Station-wise Comparison',
              ].map((name) => (
                <span key={name} style={{
                  padding: '6px 14px',
                  background: 'var(--color-gray-100)',
                  color: 'var(--color-gray-500)',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 500,
                }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </Layout>
  );
}

import React, { useEffect, useState } from 'react';
import { BarChart2, Construction, AlertTriangle } from 'lucide-react';
import Layout from '../components/layout/Layout';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import DataTable from '../components/ui/DataTable';
import { useAuthStore } from '../store/authStore';
import { useStationStore } from '../store/stationStore';
import { ROLES, ALS_GROUPS } from '../lib/constants';
import { supabase } from '../lib/supabase';
import { toDisplayValue, getDisplayUnit } from '../utils/units';

export default function Reports() {
  const { role } = useAuthStore();
  const { selectedStation, alsGroupFilter } = useStationStore();
  
  const [damagedItems, setDamagedItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadReportsData();
  }, [alsGroupFilter, selectedStation?.id, role]);

  const loadReportsData = async () => {
    setIsLoading(true);
    try {
      let damageQuery = supabase.from('consumable_assets')
        .select('item_id, quantity, inventory_items(name, unit)')
        .eq('status', 'disposed');

      if (role === ROLES.ALS || role === ROLES.HKTL) {
        const allowedStations = ALS_GROUPS[alsGroupFilter];
        if (allowedStations) {
          // Fetch station IDs for the group
          const { data: stationsData } = await supabase
            .from('stations')
            .select('id, code')
            .in('code', allowedStations)
            .eq('is_active', true);
            
          const stationIds = (stationsData || []).map(s => s.id);
          if (stationIds.length > 0) {
            damageQuery = damageQuery.in('station_id', stationIds);
          } else {
            // Force 0 results if filter applied but no stations found
            damageQuery = damageQuery.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        }
      } else if (selectedStation?.id) {
        damageQuery = damageQuery.eq('station_id', selectedStation.id);
      } else {
         setIsLoading(false);
         return;
      }

      const { data: damageData, error } = await damageQuery;
      if (error) throw error;

      const damageMap = {};
      (damageData || []).forEach(d => {
        if (!damageMap[d.item_id]) {
          damageMap[d.item_id] = { name: d.inventory_items?.name, unit: getDisplayUnit(d.inventory_items?.unit), total: 0 };
        }
        damageMap[d.item_id].total += toDisplayValue(d.quantity, d.inventory_items?.unit);
      });
      
      const topDamaged = Object.values(damageMap).sort((a, b) => b.total - a.total).slice(0, 10);
      setDamagedItems(topDamaged);
    } catch (err) {
      console.error('Error loading reports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Layout
      title="Reports"
      subtitle={(role === ROLES.ALS || role === ROLES.HKTL) ? 'System-wide analytics' : selectedStation?.name}
    >
      <div className="two-col-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <Card>
          <CardHeader 
            title="High Replacement Risk (Frequently Damaged)" 
            icon={<AlertTriangle size={16} style={{ color: 'var(--color-danger-500)' }} />} 
          />
          <CardBody style={{ padding: 0 }}>
            <DataTable
              columns={[
                { key: 'name', label: 'Item Name' },
                { key: 'total', label: 'Total Units Damaged/Disposed', render: (v, r) => <span style={{ color: 'var(--color-danger-600)', fontWeight: 600 }}>{v} {r.unit}</span> },
              ]}
              data={damagedItems.map((d, i) => ({ ...d, id: i }))}
              isLoading={isLoading}
              emptyTitle="No damaged items recorded"
              emptyDesc="No items have been marked as disposed/damaged."
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="reports-coming-soon" style={{ padding: 'var(--space-8) 0' }}>
              <div className="reports-coming-soon-icon">
                <BarChart2 size={40} />
              </div>
              <div>
                <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-gray-800)' }}>
                  More Analytics Coming Soon
                </h2>
                <p style={{ color: 'var(--color-gray-500)', marginTop: 'var(--space-2)', maxWidth: 400 }}>
                  The reports module will include consumption trends, stock movement charts,
                  monthly summaries, and station-wise comparisons in the next phase.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}

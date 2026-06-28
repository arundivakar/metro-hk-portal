import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export function useInventory(stationId) {
  const [inventory, setInventory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch station inventory with item details
  const fetchInventory = useCallback(async (sid = stationId) => {
    if (!sid) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('v_station_inventory_summary')
        .select('*')
        .eq('station_id', sid)
        .order('item_name', { ascending: true });

      if (err) throw err;
      setInventory(data ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [stationId]);

  // Add stock received
  const addStockReceived = useCallback(async (payload) => {
    const { data, error: err } = await supabase
      .from('stock_received')
      .insert(payload)
      .select()
      .single();
    if (err) throw err;
    return data;
  }, []);

  // Bulk add stock received
  const bulkAddStockReceived = useCallback(async (payloadArray) => {
    if (!payloadArray || payloadArray.length === 0) return [];
    const { data, error: err } = await supabase
      .from('stock_received')
      .insert(payloadArray)
      .select();
    if (err) throw err;
    return data;
  }, []);

  // Log daily consumption
  const logConsumption = useCallback(async (payload) => {
    const { data, error: err } = await supabase
      .from('consumption_logs')
      .insert(payload)
      .select()
      .single();
    if (err) throw err;
    return data;
  }, []);

  // Fetch stock received log
  const fetchStockReceived = useCallback(async (sid = stationId, filters = {}) => {
    let query = supabase
      .from('stock_received')
      .select(`
        *,
        inventory_items ( name, unit ),
        users_profile ( full_name )
      `)
      .eq('station_id', sid)
      .neq('supplier', 'Opening Stock Initialization')
      .order('received_date', { ascending: false });

    if (filters.from) query = query.gte('received_date', filters.from);
    if (filters.to) query = query.lte('received_date', filters.to);

    const { data, error: err } = await query;
    if (err) throw err;
    return data ?? [];
  }, [stationId]);

  // Fetch consumption log
  const fetchConsumptionLogs = useCallback(async (sid = stationId, filters = {}) => {
    let query = supabase
      .from('consumption_logs')
      .select(`
        *,
        inventory_items ( name, unit ),
        users_profile ( full_name )
      `)
      .eq('station_id', sid)
      .order('consumption_date', { ascending: false });

    if (filters.from) query = query.gte('consumption_date', filters.from);
    if (filters.to) query = query.lte('consumption_date', filters.to);

    const { data, error: err } = await query;
    if (err) throw err;
    return data ?? [];
  }, [stationId]);

  // Fetch all inventory items from catalogue
  const fetchInventoryItems = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('inventory_items')
      .select('*, rate_master ( unit_rate, tender_year, brand, supplier, nos_per_kg )')
      .eq('is_active', true)
      .limit(1000)   // explicit safeguard — Supabase default can be lower
      .order('name');
    if (err) throw err;
    return data ?? [];
  }, []);


  // Add a new item to rate_master (triggers auto-creation of inventory_items)
  const addNewCatalogueItem = useCallback(async (payload) => {
    const { data, error: err } = await supabase
      .from('rate_master')
      .insert({
        item_name: payload.item_name,
        category: payload.category,
        unit: payload.unit,
        unit_rate: payload.unit_rate,
        tender_year: payload.tender_year,
        brand: payload.brand || null,
        remarks: payload.remarks || null
      })
      .select()
      .single();
    if (err) throw err;
    return data;
  }, []);

  const getLowStockItems = useCallback((inv = inventory) => {
    return inv.filter((row) => row.is_low_stock);
  }, [inventory]);

  return {
    inventory,
    isLoading,
    error,
    fetchInventory,
    addStockReceived,
    bulkAddStockReceived,
    logConsumption,
    fetchStockReceived,
    fetchConsumptionLogs,
    fetchInventoryItems,
    addNewCatalogueItem,
    getLowStockItems,
  };
}

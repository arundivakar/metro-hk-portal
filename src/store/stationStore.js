import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const SESSION_KEY = 'metro_selected_station';

// Load persisted station from sessionStorage
const loadPersistedStation = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const useStationStore = create((set, get) => ({
  selectedStation: loadPersistedStation(),
  assignedStations: [],
  isLoadingStations: false,
  alsGroupFilter: 'ALL STATIONS',

  setAlsGroupFilter: (groupName) => {
    set({ alsGroupFilter: groupName });
  },

  // Set selected station and persist to sessionStorage
  setStation: (station) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(station));
    set({ selectedStation: station });
  },

  // Clear selected station (on logout)
  clearStation: () => {
    sessionStorage.removeItem(SESSION_KEY);
    set({ selectedStation: null, assignedStations: [] });
  },

  // Fetch stations assigned to this user (for HKS/SC station picker)
  fetchAssignedStations: async (userId) => {
    set({ isLoadingStations: true });
    try {
      const { data, error } = await supabase
        .from('user_stations')
        .select(`
          station_id,
          is_primary,
          stations (
            id,
            code,
            name,
            is_active
          )
        `)
        .eq('user_id', userId);

      if (error) throw error;

      const stations = data
        .map((us) => us.stations)
        .filter((s) => s?.is_active);

      set({ assignedStations: stations });
      return stations;
    } catch (err) {
      console.error('Fetch stations error:', err);
      return [];
    } finally {
      set({ isLoadingStations: false });
    }
  },

  // Fetch ALL stations (for ALS)
  fetchAllStations: async () => {
    set({ isLoadingStations: true });
    try {
      const { data, error } = await supabase
        .from('stations')
        .select('*')
        .eq('is_active', true)
        .order('code');

      if (error) throw error;
      set({ assignedStations: data });
      return data;
    } catch (err) {
      console.error('Fetch all stations error:', err);
      return [];
    } finally {
      set({ isLoadingStations: false });
    }
  },
}));

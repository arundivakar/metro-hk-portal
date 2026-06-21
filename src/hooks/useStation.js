import { useStationStore } from '../store/stationStore';
import { useAuthStore } from '../store/authStore';

export function useStation() {
  const { selectedStation, assignedStations, isLoadingStations, setStation, clearStation, fetchAssignedStations, fetchAllStations } =
    useStationStore();
  const { user } = useAuthStore();

  return {
    selectedStation,
    assignedStations,
    isLoadingStations,
    setStation,
    clearStation,
    fetchAssignedStations: () => fetchAssignedStations(user?.id),
    fetchAllStations,
    stationId: selectedStation?.id ?? null,
    stationCode: selectedStation?.code ?? null,
    stationName: selectedStation?.name ?? null,
  };
}

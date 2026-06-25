import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Train } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useStationStore } from '../../store/stationStore';
import Spinner from '../ui/Spinner';
import Button from '../ui/Button';

export default function StationSelectorModal() {
  const navigate = useNavigate();
  const { profile } = useAuthStore();
  const {
    assignedStations,
    isLoadingStations,
    selectedStation,
    setStation,
    fetchAssignedStations,
  } = useStationStore();

  useEffect(() => {
    if (profile?.id) {
      fetchAssignedStations(profile.id);
    }
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (station) => {
    setStation(station);
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="login-page" style={{ flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ textAlign: 'center', color: 'white' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 60, height: 60, borderRadius: 16,
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(8px)',
          marginBottom: 'var(--space-4)',
        }}>
          <Train size={28} color="white" />
        </div>
        <h1 style={{ color: 'white', fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>
          Select Your Working Station
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-2)' }}>
          Welcome, {profile?.full_name ?? 'User'}. Choose your station for this session.
        </p>
      </div>

      <div style={{
        background: 'white',
        borderRadius: 20,
        padding: 'var(--space-6)',
        width: '100%',
        maxWidth: 700,
        boxShadow: '0 32px 80px rgba(0,0,0,0.3)',
        animation: 'fadeIn 0.3s ease',
        position: 'relative',
        zIndex: 1,
      }}>
        {isLoadingStations ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
            <Spinner size="lg" variant="primary" />
            <p style={{ color: 'var(--color-gray-400)', marginTop: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
              Loading your assigned stations…
            </p>
          </div>
        ) : assignedStations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-gray-500)' }}>
            <MapPin size={40} style={{ marginBottom: 'var(--space-4)', color: 'var(--color-gray-300)' }} />
            <p style={{ fontWeight: 600, fontSize: 'var(--font-size-base)' }}>No stations assigned</p>
            <p style={{ fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-2)' }}>
              Please contact your administrator to be assigned to a station.
            </p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)', fontWeight: 500 }}>
                <MapPin size={13} style={{ display: 'inline', marginRight: 4 }} />
                {assignedStations.length} station{assignedStations.length > 1 ? 's' : ''} available
              </p>
            </div>
            <div className="station-grid">
              {assignedStations.map((station) => (
                <div
                  key={station.id}
                  className={`station-card ${selectedStation?.id === station.id ? 'selected' : ''}`}
                  onClick={() => handleSelect(station)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelect(station)}
                  aria-label={`Select station ${station.code}`}
                >
                  <div className="station-card-code">{station.code}</div>
                  <div className="station-card-name">{station.name}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

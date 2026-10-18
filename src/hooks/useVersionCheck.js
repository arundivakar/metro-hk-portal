import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Injected at build time via Vite define
const CLIENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState(null);
  const dismissedVersionRef = useRef(null);
  const isCheckingRef = useRef(false);

  // Subscribe to auth state so we check immediately when a user logs in
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Clean up any legacy or stale service workers registered in past sessions
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
  }, []);

  const fetchVersion = useCallback(async () => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    try {
      // Use cache-busting timestamp and explicit cache: 'no-store'
      const res = await fetch(`/version.json?_=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });

      if (!res.ok) return;
      const data = await res.json();
      const serverVersion = data?.version;

      if (!serverVersion) return;

      // If client is running a known build and the server version is different:
      if (CLIENT_VERSION !== 'dev' && serverVersion !== CLIENT_VERSION) {
        setLatestVersion(serverVersion);
        // Only show notification if user hasn't dismissed this specific version
        if (dismissedVersionRef.current !== serverVersion) {
          setUpdateAvailable(true);
        }
      } else {
        setUpdateAvailable(false);
      }
    } catch {
      // Silently ignore network failures (e.g. temporary offline)
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  // 1. Initial check on mount
  useEffect(() => {
    fetchVersion();
  }, [fetchVersion]);

  // 2. Trigger check after login completes
  useEffect(() => {
    if (isAuthenticated) {
      fetchVersion();
    }
  }, [isAuthenticated, fetchVersion]);

  // 3. Trigger check when tab becomes active / visible or window gains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchVersion();
      }
    };

    const handleFocus = () => {
      fetchVersion();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchVersion]);

  // 4. Periodic checking every 5 minutes
  useEffect(() => {
    const timer = setInterval(() => {
      fetchVersion();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [fetchVersion]);

  // Dismiss notification: hides banner for this version, but continues periodic checks
  const dismiss = useCallback(() => {
    if (latestVersion) {
      dismissedVersionRef.current = latestVersion;
    }
    setUpdateAvailable(false);
  }, [latestVersion]);

  // Safe reload: guard against losing unsaved form data or interrupting an active transaction
  const reload = useCallback(() => {
    // Check if any modal dialog is currently open in DOM
    const isModalOpen = typeof document !== 'undefined' && !!document.querySelector('.modal-backdrop, .modal, [role="dialog"]');

    // Check if any form submission is currently active
    const isSubmitting = typeof document !== 'undefined' && !!document.querySelector('button[disabled].is-loading, button.loading, .spinner');

    if (isSubmitting) {
      alert('A transaction is currently being processed. Please wait until it completes before refreshing.');
      return;
    }

    if (isModalOpen) {
      const confirmed = window.confirm(
        'A form or dialog is currently open. Any unsaved changes will be lost. Are you sure you want to refresh to the latest version?'
      );
      if (!confirmed) return;
    }

    // Cache-busting reload (preserves Supabase session in localStorage)
    window.location.reload();
  }, []);

  return { updateAvailable, reload, dismiss, latestVersion, currentVersion: CLIENT_VERSION };
}

import { useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useVersionCheck(isFormActive = false) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const knownVersion = useRef(null);

  const fetchVersion = async () => {
    try {
      const res = await fetch('/version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.version) return;
      if (knownVersion.current === null) {
        knownVersion.current = data.version;
      } else if (data.version !== knownVersion.current) {
        setUpdateAvailable(true);
      }
    } catch {
      // Network errors are silently ignored
    }
  };

  useEffect(() => {
    fetchVersion();
    const timer = setInterval(fetchVersion, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line

  const dismiss = () => setUpdateAvailable(false);

  const reload = (isFormActive) => {
    if (isFormActive) {
      if (window.confirm('A form is currently open. Are you sure you want to reload?')) {
        window.location.reload();
      }
    } else {
      window.location.reload();
    }
  };

  return { updateAvailable, reload, dismiss };
}

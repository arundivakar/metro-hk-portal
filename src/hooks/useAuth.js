import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const { user, profile, role, isLoading, isAuthenticated, initialize, login, logout } =
    useAuthStore();

  useEffect(() => {
    // Initialize on mount
    initialize();

    // Listen for auth state changes (session refresh, tab focus, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await useAuthStore.getState().fetchProfile(session.user);
        } else if (event === 'SIGNED_OUT') {
          useAuthStore.setState({
            user: null,
            profile: null,
            role: null,
            isAuthenticated: false,
          });
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { user, profile, role, isLoading, isAuthenticated, login, logout };
}

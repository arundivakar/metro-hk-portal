import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export const useAuthStore = create((set, get) => ({
  user: null,
  profile: null,
  role: null,
  isLoading: true,
  isAuthenticated: false,

  // Initialize auth state from Supabase session
  initialize: async () => {
    set({ isLoading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await get().fetchProfile(session.user);
      } else {
        set({ user: null, profile: null, role: null, isAuthenticated: false });
      }
    } catch (err) {
      console.error('Auth init error:', err);
      set({ user: null, profile: null, role: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  // Fetch user profile from users_profile table
  fetchProfile: async (user) => {
    try {
      const { data: profile, error } = await supabase
        .from('users_profile')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      set({
        user,
        profile,
        role: profile.role,
        isAuthenticated: true,
      });
    } catch (err) {
      console.error('Profile fetch error:', err);
      set({ user, profile: null, role: null, isAuthenticated: false });
    }
  },

  // Login with email + password
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await get().fetchProfile(data.user);
    return data;
  },

  // Logout
  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null, role: null, isAuthenticated: false });
    // Clear station from session storage
    sessionStorage.removeItem('metro_selected_station');
  },
}));

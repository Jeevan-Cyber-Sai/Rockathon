import { createContext, useContext, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase";

const AuthContext = createContext({
  user: null,
  session: null,
  loading: true,
  isConfigured: false,
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Check for demo/local storage session fallback
      try {
        const localUser = JSON.parse(localStorage.getItem("shopyx_demo_user") || "null");
        if (localUser) setUser(localUser);
      } catch {}
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh, OAuth callback)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithEmail(email, password) {
    if (!isSupabaseConfigured) {
      // Fallback for local demo if keys not yet set in .env
      const demoUser = {
        id: "demo-" + Math.random().toString(36).substring(2, 9),
        email,
        user_metadata: { full_name: email.split("@")[0] },
      };
      localStorage.setItem("shopyx_demo_user", JSON.stringify(demoUser));
      setUser(demoUser);
      return { data: { user: demoUser }, error: null };
    }

    return await supabase.auth.signInWithPassword({
      email,
      password,
    });
  }

  async function signUpWithEmail(email, password, fullName) {
    if (!isSupabaseConfigured) {
      const demoUser = {
        id: "demo-" + Math.random().toString(36).substring(2, 9),
        email,
        user_metadata: { full_name: fullName || email.split("@")[0] },
      };
      localStorage.setItem("shopyx_demo_user", JSON.stringify(demoUser));
      setUser(demoUser);
      return { data: { user: demoUser }, error: null };
    }

    return await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured) {
      const demoUser = {
        id: "google-demo-user",
        email: "demo.user@gmail.com",
        user_metadata: { full_name: "Demo Google User" },
      };
      localStorage.setItem("shopyx_demo_user", JSON.stringify(demoUser));
      setUser(demoUser);
      return { data: { user: demoUser }, error: null };
    }

    return await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/search`,
      },
    });
  }

  async function signOut() {
    if (!isSupabaseConfigured) {
      localStorage.removeItem("shopyx_demo_user");
      setUser(null);
      return { error: null };
    }
    const res = await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    return res;
  }

  const value = {
    user,
    session,
    loading,
    isConfigured: isSupabaseConfigured,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

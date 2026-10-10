"use client";

import React, { createContext, useCallback, useContext, useSyncExternalStore, ReactNode } from "react";

interface AuthContextType {
  token: string | null;
  setToken: (token: string | null) => void;
  logout: () => void;
  isAuthenticated: boolean;
  hydrated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "token";
const TOKEN_EVENT = "cellularmaze-auth-token";

// The token lives in localStorage; subscribe to same-tab changes (custom
// event) and other tabs (storage event) so every consumer stays in sync.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(TOKEN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TOKEN_EVENT, onChange);
  };
}

const readToken = () => localStorage.getItem(TOKEN_KEY);
const noSubscribe = () => () => {};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Server render has no localStorage: token is null and hydrated is false
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);

  const setToken = useCallback((newToken: string | null) => {
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    window.dispatchEvent(new Event(TOKEN_EVENT));
  }, []);

  const logout = useCallback(() => setToken(null), [setToken]);

  return (
    <AuthContext.Provider
      value={{
        token,
        setToken,
        logout,
        isAuthenticated: !!token,
        hydrated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
};

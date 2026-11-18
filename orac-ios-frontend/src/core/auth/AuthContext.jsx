import React, { createContext, useContext, useState, useEffect } from "react";
import { auth, onSessionExpired } from "../../api/client.js";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(auth.getCachedUser());
  const [checking, setChecking] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    auth.restoreSession().then((restored) => {
      setUser(restored);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    return onSessionExpired(() => {
      setUser(null);
      setChecking(false);
      setSessionExpired(true);
    });
  }, []);

  const logout = () => {
    auth.logout();
    setUser(null);
  };

  const value = {
    user,
    setUser,
    checking,
    sessionExpired,
    setSessionExpired,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

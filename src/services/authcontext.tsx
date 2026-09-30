import React, { useState, useEffect, type ReactNode, useCallback } from 'react';
import {
  loginUser,
  logoutUser,
  finalizeRegistration,
  getProfile,
} from './user';
import type {
  UserProfile,
  LoginPayload,
  RegisterPayload,
} from './user'
import { ApiError } from './apiClient';
import { AuthContext, type AuthStatus } from './useAuth';



export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const forceLogout = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Restore the session on app load from the server-side cookie session.
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const profile = await getProfile();
        if (active) {
          setUser(profile);
          setStatus('authenticated');
        }
      } catch (error) {
        if (!active) return;

        // A 401 here is the normal "no session cookie yet" state for a visitor
        // who is not signed in, so it is not surfaced as an application error.
        // Anything else (network failure, 5xx) is logged because it usually
        // means the API is unreachable rather than unauthenticated.
        if (!(error instanceof ApiError && error.status === 401)) {
          console.warn('Could not restore the session from the API:', error);
        }

        setUser(null);
        setStatus('unauthenticated');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // NOTE: deliberately does *not* set `status: 'loading'` here.
  //
  // `status` answers exactly one question — "do we know yet whether there is a
  // session?" — and route guards render a full-screen loader while it is
  // `loading`. Flipping it during a login attempt therefore unmounts the very
  // form that is submitting: the request fails, `forceLogout()` restores
  // `unauthenticated`, and a freshly mounted (empty) login form is rendered,
  // so the error written to the old form instance is silently lost. The submit
  // button's own `loading` flag covers the in-flight spinner instead.
  const login = async (credentials: LoginPayload) => {
    try {
      const response = await loginUser(credentials);
      if (response && response.user) {
        setUser(response.user);
        setStatus('authenticated');
      } else {
      forceLogout();
        throw new Error(response?.error || 'Login failed');
      }
    } catch (error) {
     forceLogout();
      throw error;
    }
  };
  const logout = async () => {
    try {
      await logoutUser();
    } catch (error) {
      console.error('Logout error on server:', error);
    } finally {
      forceLogout();
    }
  };

  const register = async (userData: RegisterPayload) => {
    await finalizeRegistration(userData);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        login,
        logout,
        register,
        forceLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

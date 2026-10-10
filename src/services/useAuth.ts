import { createContext, useContext } from 'react';
import type { UserProfile, LoginPayload, RegisterPayload } from './user';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextType {
  user: UserProfile | null;
  status: AuthStatus;
  login: (credentials: LoginPayload) => Promise<void>;
  /** Signs in with the Google ID token returned by Google Identity Services. */
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (userData: RegisterPayload) => Promise<void>;
  forceLogout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
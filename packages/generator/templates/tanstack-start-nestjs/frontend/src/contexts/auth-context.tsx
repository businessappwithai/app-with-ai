import React, {
  createContext,
  type ReactNode,
  startTransition,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isEmbedded, setUnauthorizedCallback } from "@/lib/api-client";
import {
  signIn as authSignIn,
  signOut as authSignOut,
  signUp as authSignUp,
  getSession,
} from "@/lib/auth";
import { getClientLogger } from "@/lib/logger";

const log = getClientLogger("auth");

interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: () => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  /**
   * Read the session and put its user in place.
   *
   * `urgent` (the default) applies the user at once. The sign-in page awaits this
   * and then navigates, so the user has to be in place by then: applied as a
   * transition, the new route's guard ran first, saw nobody signed in, and sent a
   * person who had just signed in back to the sign-in page. Only the first read,
   * made while the page is still hydrating, is non-urgent (see the mount effect).
   */
  const refreshSession = async (urgent = true) => {
    try {
      // A read that failed (rate limited, backend restarting) says nothing about whether the
      // person is signed in. Only an answer of "no session" may end the one they have — and
      // with no session known yet, a failed read is tried again before anyone is sent to
      // the sign-in page.
      let { data, error } = await getSession();
      for (let attempt = 1; error && data == null && !userRef.current && attempt <= 3; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        ({ data, error } = await getSession());
      }
      if (error && data == null && userRef.current) return;
      // Typed as User rather than unknown: `unknown ?? null` widens to
      // `{} | null`, which does not assign to `User | null`.
      const next = (data as { user?: User } | null)?.user ?? null;
      userRef.current = next;
      if (urgent) setUser(next);
      else startTransition(() => setUser(next));
    } catch (error) {
      log.error("Failed to refresh session", error);
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      // Non-urgent: the first read resolves while the page is still hydrating.
      await refreshSession(false);
      // Non-urgent: this provider wraps every route, and the session fetch can
      // resolve while the page is still hydrating. An urgent update there makes
      // React discard the server HTML for the boundary and re-render on the
      // client.
      startTransition(() => setIsLoading(false));
    };

    checkSession();

    // Register 401 unauthorized callback for API client
    setUnauthorizedCallback(async () => {
      setUser(null);
      // Inside the chat assistant's frame the sign-in belongs to the assistant:
      // tell it, and do not draw a sign-in page inside the frame or end the
      // session the assistant itself is using.
      if (isEmbedded()) {
        window.parent.postMessage({ type: "app:signed-out" }, window.location.origin);
        return;
      }
      await authSignOut();
      window.location.href = "/auth/login";
    });
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await authSignIn(email, password);
      if (error) throw new Error(error);
      // Typed as User rather than unknown: `unknown ?? null` widens to
      // `{} | null`, which does not assign to `User | null`.
      setUser((data as { user?: User } | null)?.user ?? null);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authSignOut();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email: string, password: string, name: string) => {
    setIsLoading(true);
    try {
      const { data: _data, error } = await authSignUp(email, password, name);
      if (error) {
        throw new Error(error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isAdmin = () => user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAdmin,
        login,
        logout,
        signup,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

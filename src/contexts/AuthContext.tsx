import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  Courier,
  DashboardSection,
  Merchant,
  UserRole,
} from '../types/database';
import {
  getMillisecondsUntilMidnight,
  syncSingleCourierCashLimit,
  type CourierCashStatus,
} from '../utils/cashLimits';
import {
  normalizePermissionsObject,
  resolveEffectivePermissions,
  type UserPermissionsMap,
} from '../utils/permissions';

interface AuthState {
  session: Session | null;
  user: User | null;
  fullName: string;
  role: UserRole;
  permissions: UserPermissionsMap | null;
  merchantRecord: Merchant | null;
  courierRecord: Courier | null;
  courierCashStatus: CourierCashStatus | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  canAccess: (section: DashboardSection) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    user: null,
    fullName: '',
    role: 'admin',
    permissions: null,
    merchantRecord: null,
    courierRecord: null,
    courierCashStatus: null,
    loading: true,
  });

  const hydrateUserProfile = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setState({
        session: null,
        user: null,
        fullName: '',
        role: 'admin',
        permissions: null,
        merchantRecord: null,
        courierRecord: null,
        courierCashStatus: null,
        loading: false,
      });
      return null;
    }

    const user = session.user;
    let resolvedFullName =
      (user.user_metadata?.full_name as string | undefined) ||
      user.email?.split('@')[0] ||
      'جرجس نبيل';
    let resolvedRole: UserRole = 'admin';
    let resolvedPermissions: UserPermissionsMap | null = null;
    let merchantRecord: Merchant | null = null;
    let courierRecord: Courier | null = null;
    let courierCashStatus: CourierCashStatus | null = null;

    try {
      let profileData: {
        full_name: string | null;
        role: string | null;
        status: string | null;
        is_active: boolean | null;
        permissions?: unknown;
      } | null = null;

      const { data: profileWithPerms, error: permsErr } = await supabase
        .from('profiles')
        .select('full_name, role, status, is_active, permissions')
        .eq('id', user.id)
        .maybeSingle();

      if (!permsErr) {
        profileData = profileWithPerms;
      } else {
        const { data: fallbackProfile, error: fbErr } = await supabase
          .from('profiles')
          .select('full_name, role, status, is_active')
          .eq('id', user.id)
          .maybeSingle();
        if (!fbErr) {
          profileData = fallbackProfile;
        }
      }

      if (profileData) {
        if (profileData.is_active === false || profileData.status === 'suspended') {
          await supabase.auth.signOut();
          setState({
            session: null,
            user: null,
            fullName: '',
            role: 'admin',
            permissions: null,
            merchantRecord: null,
            courierRecord: null,
            courierCashStatus: null,
            loading: false,
          });
          return 'تم حظر أو إيقاف هذا الحساب من قبل الإدارة. يرجى التواصل مع مدير النظام.';
        }
        if (profileData.full_name) {
          resolvedFullName = profileData.full_name;
        }
        if (profileData.role) {
          resolvedRole = profileData.role as UserRole;
        }
        resolvedPermissions = normalizePermissionsObject(
          profileData.permissions
        );
      } else {
        const metaRole = user.user_metadata?.role as UserRole | undefined;
        resolvedRole = metaRole || 'admin';
      }
    } catch {
      const metaRole = user.user_metadata?.role as UserRole | undefined;
      resolvedRole = metaRole || 'admin';
    }

    if (resolvedRole === 'merchant') {
      try {
        const { data: merchant, error: merchErr } = await supabase
          .from('merchants')
          .select('*, profiles(full_name, phone, email)')
          .eq('profile_id', user.id)
          .limit(1)
          .maybeSingle();

        if (!merchErr && merchant) {
          merchantRecord = merchant as Merchant;
        } else if (merchErr) {
          const { data: fallbackMerch } = await supabase
            .from('merchants')
            .select('*')
            .eq('profile_id', user.id)
            .limit(1)
            .maybeSingle();
          if (fallbackMerch) {
            merchantRecord = fallbackMerch as Merchant;
          }
        }

        if (merchantRecord?.subscription_end_date) {
          const endMs = new Date(merchantRecord.subscription_end_date).getTime();
          if (!Number.isNaN(endMs) && endMs < Date.now()) {
            if (merchantRecord.is_active !== false) {
              await supabase
                .from('merchants')
                .update({ is_active: false })
                .eq('id', merchantRecord.id);
            }
            merchantRecord = { ...merchantRecord, is_active: false };
          }
        }
      } catch {
        merchantRecord = null;
      }
    }

    if (resolvedRole === 'courier') {
      try {
        const { data: courier, error: courierErr } = await supabase
          .from('couriers')
          .select('*, profiles(full_name, phone, email)')
          .eq('profile_id', user.id)
          .limit(1)
          .maybeSingle();

        let baseCourier: Courier | null = null;
        if (!courierErr && courier) {
          baseCourier = courier as Courier;
        } else if (courierErr) {
          const { data: fallbackCourier } = await supabase
            .from('couriers')
            .select('*')
            .eq('profile_id', user.id)
            .limit(1)
            .maybeSingle();
          if (fallbackCourier) {
            baseCourier = fallbackCourier as Courier;
          }
        }

        if (baseCourier?.id) {
          const synced = await syncSingleCourierCashLimit(baseCourier.id);
          courierRecord = synced.courier || baseCourier;
          courierCashStatus = synced.status;
        }
      } catch {
        courierRecord = null;
        courierCashStatus = null;
      }
    }

    setState({
      session,
      user,
      fullName: resolvedFullName,
      role: resolvedRole,
      permissions: resolvedPermissions,
      merchantRecord,
      courierRecord,
      courierCashStatus,
      loading: false,
    });
    return null;
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        hydrateUserProfile(data.session);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        hydrateUserProfile(session);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [hydrateUserProfile]);

  // Automatic 12:00 AM check for logged-in couriers
  useEffect(() => {
    if (state.role !== 'courier' || !state.courierRecord?.id || !state.session) {
      return;
    }
    const timer = window.setTimeout(() => {
      hydrateUserProfile(state.session);
    }, getMillisecondsUntilMidnight());
    return () => window.clearTimeout(timer);
  }, [state.role, state.courierRecord?.id, state.session, hydrateUserProfile]);

  const signIn = async (
    email: string,
    password: string
  ): Promise<{ error: string | null }> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      return { error: error.message };
    }

    const blockedMsg = await hydrateUserProfile(data.session);
    if (blockedMsg) {
      return { error: blockedMsg };
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState({
      session: null,
      user: null,
      fullName: '',
      role: 'admin',
      permissions: null,
      merchantRecord: null,
      courierRecord: null,
      courierCashStatus: null,
      loading: false,
    });
  };

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    await hydrateUserProfile(data.session);
  };

  const canAccess = useCallback(
    (section: DashboardSection): boolean => {
      const effective = resolveEffectivePermissions(
        state.role,
        state.permissions
      );
      return Boolean(effective[section]);
    },
    [state.role, state.permissions]
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signIn,
        signOut,
        refreshProfile,
        canAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { isMerchantSubscriptionExpired } from '../utils/subscriptions';
import { LoginPage } from './LoginPage';
import { MerchantLocationOnboarding } from './MerchantLocationOnboarding';
import { CourierDepositLockPage } from './CourierDepositLockPage';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const {
    session,
    loading,
    role,
    merchantRecord,
    courierRecord,
    courierCashStatus,
  } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-[#0A192F] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
        </div>
        <p className="text-sm font-semibold text-slate-600">
          جاري تحميل جلسة العمل والصلاحيات...
        </p>
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  if (role === 'merchant') {
    const missingCoords =
      !merchantRecord ||
      merchantRecord.latitude == null ||
      merchantRecord.longitude == null;
    const subscriptionBlocked =
      merchantRecord?.is_active === false ||
      isMerchantSubscriptionExpired(merchantRecord);

    if (
      missingCoords ||
      merchantRecord.account_status !== 'active' ||
      subscriptionBlocked
    ) {
      return <MerchantLocationOnboarding />;
    }
  }

  if (role === 'courier') {
    if (
      !courierRecord ||
      courierCashStatus?.maxLimitBlocked ||
      (courierRecord.account_status === 'suspended' &&
        (courierCashStatus?.cashBalance ?? 0) >=
          (courierCashStatus?.dailyLimit ?? 500))
    ) {
      return <CourierDepositLockPage />;
    }
  }

  return <>{children}</>;
}

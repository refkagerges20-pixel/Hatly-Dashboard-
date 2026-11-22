import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogOut,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { HatlyLogo } from './HatlyLogo';
import { LeafletLocationPicker } from './LeafletLocationPicker';
import { MINYA_CENTERS } from '../utils/haversine';
import {
  formatSubscriptionDate,
  getPlanLabel,
  isMerchantSubscriptionExpired,
} from '../utils/subscriptions';

export function MerchantLocationOnboarding() {
  const { merchantRecord, fullName, signOut, refreshProfile } = useAuth();
  const [lat, setLat] = useState<number>(
    merchantRecord?.latitude ?? MINYA_CENTERS[0].lat
  );
  const [lng, setLng] = useState<number>(
    merchantRecord?.longitude ?? MINYA_CENTERS[0].lng
  );
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshProfile();
    setRefreshing(false);
  };

  const handleSaveLocation = async () => {
    if (!merchantRecord?.id) {
      setError('لم يتم العثور على سجل المتجر المرتبط بهذا الحساب');
      return;
    }

    setSaving(true);
    setError(null);

    const { error: updateErr } = await supabase
      .from('merchants')
      .update({
        latitude: lat,
        longitude: lng,
        account_status: 'pending_approval',
      })
      .eq('id', merchantRecord.id);

    setSaving(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setSubmitted(true);
    await refreshProfile();
  };

  if (!merchantRecord) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-[#0A192F]">
            حساب المتجر غير مكتمل الربط
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            لم يتم العثور على بيانات المتجر لهذا الحساب بعد. يرجى تحديث الحالة أو التواصل مع الإدارة.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A192F] text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>تحديث الحالة</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (merchantRecord.account_status === 'suspended') {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-[#0A192F]">حساب المتجر موقوف</h1>
          <p className="text-sm text-slate-600">
            تم إيقاف حساب متجر{' '}
            <strong>{merchantRecord.store_name || fullName}</strong> مؤقتاً. يرجى التواصل مع إدارة هاتلي.
          </p>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    );
  }

  if (
    merchantRecord.account_status === 'active' &&
    (merchantRecord.is_active === false ||
      isMerchantSubscriptionExpired(merchantRecord))
  ) {
    return (
      <div
        dir="rtl"
        className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full bg-white border border-red-200 rounded-2xl p-8 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <span className="inline-block px-3 py-1 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
              منتهي
            </span>
            <h1 className="text-xl font-bold text-[#0A192F]">
              انتهى اشتراك المتجر — تم الإيقاف التلقائي
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              اشتراك متجر{' '}
              <strong>{merchantRecord.store_name || fullName}</strong>{' '}
              ({getPlanLabel(merchantRecord.subscription_plan)}) انتهى بتاريخ{' '}
              <span className="font-mono tabular-nums font-bold text-red-700">
                {formatSubscriptionDate(merchantRecord.subscription_end_date)}
              </span>
              . لا يمكن استقبال طلبات جديدة حتى يتم تجديد الباقة من الإدارة.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>تحديث حالة الاشتراك</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasLocation =
    merchantRecord.latitude != null && merchantRecord.longitude != null;

  if (
    submitted ||
    (merchantRecord.account_status === 'pending_approval' && hasLocation)
  ) {
    const displayLat = merchantRecord.latitude ?? lat;
    const displayLng = merchantRecord.longitude ?? lng;

    return (
      <div
        dir="rtl"
        className="min-h-screen bg-slate-50 flex items-center justify-center p-6"
      >
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-[#0A192F]">
              تم إرسال موقعك بنجاح. حسابك قيد المراجعة من الإدارة.
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              متجر{' '}
              <strong>
                {merchantRecord.store_name || merchantRecord.name || fullName}
              </strong>{' '}
              — سيتم فتح لوحة التحكم الخاصة بك فور موافقة وتفعيل الإدارة.
            </p>
          </div>
          <div
            className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 font-mono tabular-nums inline-flex items-center gap-2"
            dir="ltr"
          >
            <MapPin className="w-3.5 h-3.5 text-[#FF7B00]" />
            <span>
              {Number(displayLat).toFixed(6)}, {Number(displayLng).toFixed(6)}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              />
              <span>تحديث حالة الحساب</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6"
    >
      <div className="max-w-3xl w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <HatlyLogo size="sm" showText={false} darkBg={false} />
            <div>
              <h1 className="text-xl font-bold text-[#0B1A33]">
                تحديد موقع المتجر
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                مرحباً {merchantRecord.store_name || merchantRecord.name || fullName} — يرجى تحريك العلامة على الخريطة لتحديد موقع متجرك بدقة قبل بدء العمل
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>خروج</span>
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <LeafletLocationPicker
          latitude={lat}
          longitude={lng}
          onChange={(newLat, newLng) => {
            setLat(newLat);
            setLng(newLng);
          }}
          heightClassName="h-80 sm:h-96"
        />

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleSaveLocation}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white font-bold text-sm transition-colors cursor-pointer"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري حفظ الموقع...</span>
              </>
            ) : (
              <>
                <MapPin className="w-4 h-4" />
                <span>تأكيد الموقع</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

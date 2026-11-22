import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  DollarSign,
  Eye,
  FileUp,
  Film,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Advertisement, Merchant } from '../types/database';
import {
  addDaysToDateKey,
  formatSubscriptionDate,
  getAdPlanRules,
  getAdStatusMeta,
  getPlanLabel,
  toDateInputKey,
  validateAdDatesForPlan,
} from '../utils/subscriptions';
import { CustomerAdsPreview } from './CustomerAdsPreview';

export function AdsManagementView() {
  const { role, merchantRecord } = useAuth();
  const isMerchant = role === 'merchant';

  const [ads, setAds] = useState<Advertisement[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [approvalsMap, setApprovalsMap] = useState<
    Map<string, 'pending' | 'approved' | 'rejected'>
  >(new Map());
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'manage' | 'preview'>('manage');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'scheduled' | 'expired'
  >('all');
  const [merchantFilter, setMerchantFilter] = useState<string>('all');
  const [previewAd, setPreviewAd] = useState<Advertisement | null>(null);
  const [reviewAd, setReviewAd] = useState<Advertisement | null>(null);
  const [reviewPrice, setReviewPrice] = useState<string>('0');
  const [reviewIsPaid, setReviewIsPaid] = useState<boolean>(false);
  const [reviewDecision, setReviewDecision] = useState<
    'pending' | 'approved' | 'rejected'
  >('approved');
  const [savingReview, setSavingReview] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Add Ad Modal State (Merchant)
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [title, setTitle] = useState<string>('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [localMediaPreviewUrl, setLocalMediaPreviewUrl] = useState<string | null>(
    null
  );
  const [localMediaType, setLocalMediaType] = useState<'image' | 'video'>(
    'image'
  );
  const [startDate, setStartDate] = useState<string>(() =>
    toDateInputKey(new Date().toISOString())
  );
  const [endDate, setEndDate] = useState<string>(() =>
    addDaysToDateKey(toDateInputKey(new Date().toISOString()), 7)
  );
  const [adPrice, setAdPrice] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const planRules = useMemo(
    () => getAdPlanRules(merchantRecord),
    [merchantRecord]
  );

  useEffect(() => {
    return () => {
      if (localMediaPreviewUrl) {
        URL.revokeObjectURL(localMediaPreviewUrl);
      }
    };
  }, [localMediaPreviewUrl]);

  const loadAds = useCallback(async () => {
    setLoading(true);

    let adsQuery = supabase
      .from('advertisements')
      .select('*')
      .order('created_at', { ascending: false });

    if (isMerchant && merchantRecord?.id) {
      adsQuery = adsQuery.eq('merchant_id', merchantRecord.id);
    }

    const [adsRes, merchantsRes, approvalsRes] = await Promise.all([
      adsQuery,
      supabase
        .from('merchants')
        .select('*, profiles(full_name, phone, email)')
        .order('created_at', { ascending: false }),
      supabase
        .from('system_settings')
        .select('*')
        .like('setting_key', 'ad_approval_%'),
    ]);

    if (adsRes.error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحميل الإعلانات: ${adsRes.error.message}`,
      });
      setAds([]);
    } else {
      setAds((adsRes.data as Advertisement[]) || []);
    }

    if (!merchantsRes.error && merchantsRes.data) {
      setMerchants((merchantsRes.data as Merchant[]) || []);
    } else {
      const fallbackMerch = await supabase.from('merchants').select('*');
      setMerchants((fallbackMerch.data as Merchant[]) || []);
    }

    const nextApprovals = new Map<string, 'pending' | 'approved' | 'rejected'>();
    if (!approvalsRes.error && approvalsRes.data) {
      for (const row of approvalsRes.data as Array<{
        setting_key: string;
        setting_value: string;
      }>) {
        const adId = row.setting_key.replace('ad_approval_', '');
        if (
          adId &&
          (row.setting_value === 'approved' ||
            row.setting_value === 'rejected' ||
            row.setting_value === 'pending')
        ) {
          nextApprovals.set(adId, row.setting_value);
        }
      }
    }
    setApprovalsMap(nextApprovals);

    setLoading(false);
  }, [isMerchant, merchantRecord?.id]);

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  const merchantNameMap = useMemo(() => {
    const map = new Map<string, string>();
    merchants.forEach((m) =>
      map.set(m.id, m.store_name || m.profiles?.full_name || m.name || 'متجر')
    );
    if (merchantRecord) {
      map.set(
        merchantRecord.id,
        merchantRecord.store_name ||
          merchantRecord.profiles?.full_name ||
          merchantRecord.name ||
          'متجري'
      );
    }
    return map;
  }, [merchants, merchantRecord]);

  const resetModalDefaults = () => {
    const today = toDateInputKey(new Date().toISOString());
    let defaultEnd = addDaysToDateKey(today, 7);
    if (planRules.planKey === 'plus') {
      defaultEnd = addDaysToDateKey(today, 30);
    } else if (planRules.planKey === 'pro' && planRules.subscriptionEndDateKey) {
      defaultEnd = planRules.subscriptionEndDateKey;
    }
    setTitle('');
    setMediaFile(null);
    if (localMediaPreviewUrl) {
      URL.revokeObjectURL(localMediaPreviewUrl);
    }
    setLocalMediaPreviewUrl(null);
    setLocalMediaType('image');
    setStartDate(today);
    setEndDate(defaultEnd);
    setAdPrice('');
    setFormError(null);
  };

  const handleOpenAddModal = () => {
    resetModalDefaults();
    setAddModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (localMediaPreviewUrl) {
      URL.revokeObjectURL(localMediaPreviewUrl);
    }
    if (!file) {
      setMediaFile(null);
      setLocalMediaPreviewUrl(null);
      return;
    }

    const isVideo = file.type.startsWith('video/');
    setLocalMediaType(isVideo ? 'video' : 'image');
    setMediaFile(file);
    setLocalMediaPreviewUrl(URL.createObjectURL(file));
  };

  const handleApplyMaxDuration = () => {
    if (!startDate) return;
    if (planRules.planKey === 'standard') {
      setEndDate(addDaysToDateKey(startDate, 7));
    } else if (planRules.planKey === 'plus') {
      setEndDate(addDaysToDateKey(startDate, 90));
    } else if (planRules.planKey === 'pro' && planRules.subscriptionEndDateKey) {
      setEndDate(planRules.subscriptionEndDateKey);
    }
  };

  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!merchantRecord?.id) {
      setFormError('لم يتم العثور على بيانات المتجر المرتبطة بالحساب');
      return;
    }

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError('يرجى إدخال عنوان الإعلان');
      return;
    }

    if (!mediaFile) {
      setFormError('يرجى رفع صورة أو فيديو للإعلان');
      return;
    }

    const dateValidationError = validateAdDatesForPlan(
      merchantRecord,
      startDate,
      endDate
    );
    if (dateValidationError) {
      setFormError(dateValidationError);
      return;
    }

    let finalAmountPaid = 0;
    let finalIsPaid = false;

    if (planRules.requiresPayment) {
      const parsed = Number(adPrice);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setFormError(
          'في باقة عادي يلزم إدخال سعر الإعلان (مبلغ أكبر من صفر) لتأكيد الدفع'
        );
        return;
      }
      finalAmountPaid = Number(parsed.toFixed(2));
      finalIsPaid = true;
    }

    setSubmitting(true);

    try {
      const ext = mediaFile.name.split('.').pop() || (localMediaType === 'video' ? 'mp4' : 'jpg');
      const filePath = `${merchantRecord.id}/ad_${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('ad_media')
        .upload(filePath, mediaFile, { upsert: true });

      if (uploadErr) {
        throw new Error(`فشل رفع ملف الإعلان: ${uploadErr.message}`);
      }

      const { data: urlData } = supabase.storage
        .from('ad_media')
        .getPublicUrl(filePath);

      const mediaUrl = urlData.publicUrl;

      const { error: insertErr } = await supabase.from('advertisements').insert({
        merchant_id: merchantRecord.id,
        title: cleanTitle,
        media_url: mediaUrl,
        media_type: localMediaType,
        start_date: startDate,
        end_date: endDate,
        is_paid: finalIsPaid,
        amount_paid: finalAmountPaid,
      });

      if (insertErr) {
        throw new Error(`تعذر حفظ الإعلان: ${insertErr.message}`);
      }

      setFeedback({
        type: 'success',
        text: finalIsPaid
          ? `تم نشر الإعلان "${cleanTitle}" وتسجيل الدفع (${finalAmountPaid.toFixed(2)} ج.م) بنجاح`
          : `تم نشر الإعلان "${cleanTitle}" مجاناً ضمن باقة ${planRules.planLabel}`,
      });
      setAddModalOpen(false);
      resetModalDefaults();
      await loadAds();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الإعلان'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filteredAds = useMemo(() => {
    return ads.filter((ad) => {
      if (!isMerchant && merchantFilter !== 'all' && ad.merchant_id !== merchantFilter) {
        return false;
      }
      if (statusFilter !== 'all') {
        const meta = getAdStatusMeta(ad.start_date, ad.end_date);
        if (meta.key !== statusFilter) return false;
      }
      return true;
    });
  }, [ads, isMerchant, merchantFilter, statusFilter]);

  const openReviewModal = (ad: Advertisement) => {
    setReviewAd(ad);
    setReviewPrice(String(Number(ad.amount_paid || 0)));
    setReviewIsPaid(Boolean(ad.is_paid));
    setReviewDecision(approvalsMap.get(ad.id) || 'approved');
  };

  const handleSaveAdminReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewAd) return;

    const parsedPrice = Number(reviewPrice);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFeedback({
        type: 'error',
        text: 'يرجى إدخال سعر إعلان صحيح (0 أو أكثر)',
      });
      return;
    }

    setSavingReview(true);
    const shouldMarkPaid = reviewIsPaid || parsedPrice > 0;

    const [adUpdateRes, approvalUpsertRes] = await Promise.all([
      supabase
        .from('advertisements')
        .update({
          amount_paid: Number(parsedPrice.toFixed(2)),
          is_paid: shouldMarkPaid,
        })
        .eq('id', reviewAd.id),
      supabase.from('system_settings').upsert(
        {
          setting_key: `ad_approval_${reviewAd.id}`,
          setting_value: reviewDecision,
        },
        { onConflict: 'setting_key' }
      ),
    ]);

    setSavingReview(false);

    if (adUpdateRes.error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحديث سعر الإعلان: ${adUpdateRes.error.message}`,
      });
      return;
    }

    if (approvalUpsertRes.error) {
      setFeedback({
        type: 'error',
        text: `تم تحديث السعر ولكن تعذر حفظ حالة الموافقة: ${approvalUpsertRes.error.message}`,
      });
    } else {
      setFeedback({
        type: 'success',
        text: `تم تحديث تسعير الإعلان "${reviewAd.title}" (${parsedPrice.toFixed(2)} ج.م) وحالته إلى "${
          reviewDecision === 'approved'
            ? 'معتمد'
            : reviewDecision === 'rejected'
            ? 'مرفوض'
            : 'قيد المراجعة'
        }"`,
      });
    }

    setReviewAd(null);
    await loadAds();
  };

  const totalPaidAdRevenue = useMemo(
    () =>
      ads
        .filter((a) => a.is_paid)
        .reduce((sum, a) => sum + Number(a.amount_paid || 0), 0),
    [ads]
  );

  const approvedAdsForPreview = useMemo(
    () => ads.filter((ad) => approvalsMap.get(ad.id) !== 'rejected'),
    [ads, approvalsMap]
  );

  return (
    <div dir="rtl" className="space-y-5">
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-sm font-semibold ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      {/* Tabs: Manage Ads vs Customer App Carousel Preview */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('manage')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
              activeTab === 'manage'
                ? 'bg-[#0A192F] text-white'
                : 'text-slate-600 hover:text-[#0A192F]'
            }`}
          >
            {isMerchant ? 'إعلاناتي' : 'جدول الإعلانات'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
              activeTab === 'preview'
                ? 'bg-[#FF7B00] text-white'
                : 'text-slate-600 hover:text-[#0A192F]'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>معاينة تطبيق العميل</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAds}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
          {isMerchant && (
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة إعلان جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Merchant Plan Rules Banner */}
      {isMerchant && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0A192F] text-[#FF7B00] flex items-center justify-center shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#0A192F]">
                باقتك الحالية:{' '}
                <span className="text-[#FF7B00]">
                  {getPlanLabel(merchantRecord?.subscription_plan)}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {planRules.summaryText}
              </p>
            </div>
          </div>
          {merchantRecord?.subscription_end_date && (
            <div className="text-xs text-slate-500 font-mono tabular-nums">
              انتهاء الاشتراك: {formatSubscriptionDate(merchantRecord.subscription_end_date)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'preview' ? (
        <CustomerAdsPreview
          ads={approvedAdsForPreview}
          merchantNameMap={merchantNameMap}
        />
      ) : (
        <>
          {/* Admin Summary & Filters Bar */}
          {!isMerchant && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[#0A192F]">
                  إعلانات المتاجر والبراندات
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  إجمالي الإعلانات: <strong className="font-mono tabular-nums text-[#0A192F]">{ads.length}</strong> · إيرادات الإعلانات المدفوعة:{' '}
                  <strong className="font-mono tabular-nums text-emerald-700">
                    {totalPaidAdRevenue.toFixed(2)} ج.م
                  </strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={merchantFilter}
                  onChange={(e) => setMerchantFilter(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0A192F]"
                >
                  <option value="all">جميع المتاجر</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.store_name || m.profiles?.full_name || m.name || m.id}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(
                      e.target.value as 'all' | 'active' | 'scheduled' | 'expired'
                    )
                  }
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0A192F]"
                >
                  <option value="all">كل الحالات</option>
                  <option value="active">نشط</option>
                  <option value="scheduled">مجدول</option>
                  <option value="expired">منتهي</option>
                </select>
              </div>
            </div>
          )}

          {/* Ads Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
                <span className="text-sm">جاري تحميل الإعلانات...</span>
              </div>
            ) : filteredAds.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="text-sm font-bold text-[#0A192F]">
                  لا توجد إعلانات مسجلة بعد
                </div>
                {isMerchant && (
                  <button
                    type="button"
                    onClick={handleOpenAddModal}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] text-white text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة أول إعلان</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                      {!isMerchant && (
                        <th className="py-3 px-4 whitespace-nowrap">المتجر</th>
                      )}
                      <th className="py-3 px-4 whitespace-nowrap">عنوان الإعلان</th>
                      <th className="py-3 px-4 whitespace-nowrap">معاينة الوسائط</th>
                      <th className="py-3 px-4 whitespace-nowrap">تاريخ البداية ← الانتهاء</th>
                      <th className="py-3 px-4 whitespace-nowrap">التكلفة / الدفع</th>
                      <th className="py-3 px-4 whitespace-nowrap">الحالة الزمنية</th>
                      <th className="py-3 px-4 whitespace-nowrap">الاعتماد الإداري</th>
                      {!isMerchant && (
                        <th className="py-3 px-4 whitespace-nowrap">الإجراءات</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredAds.map((ad) => {
                      const statusMeta = getAdStatusMeta(ad.start_date, ad.end_date);
                      const approvalState = approvalsMap.get(ad.id) || 'approved';
                      const merchantObj = merchants.find((m) => m.id === ad.merchant_id);
                      return (
                        <tr key={ad.id} className="hover:bg-slate-50/70">
                          {!isMerchant && (
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="font-bold text-[#0B1A33]">
                                {merchantNameMap.get(ad.merchant_id) || ad.merchant_id}
                              </div>
                              {merchantObj && (
                                <div className="text-[11px] text-slate-500">
                                  باقة: {getPlanLabel(merchantObj.subscription_plan)}
                                </div>
                              )}
                            </td>
                          )}
                          <td className="py-3 px-4 font-bold text-[#0B1A33]">
                            {ad.title}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => setPreviewAd(ad)}
                                className="w-16 h-11 rounded-lg border border-slate-200 bg-slate-900 overflow-hidden flex items-center justify-center relative group cursor-pointer shrink-0"
                                title="تكبير المعاينة"
                              >
                                {ad.media_type === 'video' ? (
                                  <Film className="w-5 h-5 text-[#FF7F00]" />
                                ) : (
                                  <img
                                    src={ad.media_url}
                                    alt={ad.title}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreviewAd(ad)}
                                className="inline-flex items-center gap-1 text-xs font-bold text-[#0B1A33] hover:text-[#FF7F00] cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>
                                  {ad.media_type === 'video' ? 'تشغيل الفيديو' : 'عرض الصورة'}
                                </span>
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                            {formatSubscriptionDate(ad.start_date)} ←{' '}
                            {formatSubscriptionDate(ad.end_date)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs">
                            {ad.is_paid ? (
                              <span className="font-mono tabular-nums font-bold text-emerald-700">
                                مدفوع: {Number(ad.amount_paid || 0).toFixed(2)} ج.م
                              </span>
                            ) : Number(ad.amount_paid || 0) > 0 ? (
                              <span className="font-mono tabular-nums font-bold text-amber-700">
                                بانتظار السداد ({Number(ad.amount_paid).toFixed(2)} ج.م)
                              </span>
                            ) : (
                              <span className="text-slate-600 font-semibold">
                                مجاني ضمن الباقة
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-3 px-4 text-xs font-bold whitespace-nowrap ${statusMeta.cls}`}
                          >
                            {statusMeta.label}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs">
                            <span
                              className={`inline-flex px-2.5 py-1 rounded-full font-bold ${
                                approvalState === 'approved'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : approvalState === 'rejected'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {approvalState === 'approved'
                                ? 'معتمد'
                                : approvalState === 'rejected'
                                ? 'مرفوض'
                                : 'قيد المراجعة'}
                            </span>
                          </td>
                          {!isMerchant && (
                            <td className="py-3 px-4 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openReviewModal(ad)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0B1A33] hover:bg-[#13294B] text-white text-xs font-bold cursor-pointer"
                              >
                                <DollarSign className="w-3.5 h-3.5 text-[#FF7F00]" />
                                <span>تسعير وموافقة</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Add Ad Modal (Merchant) */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
                  <Megaphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0A192F]">
                    إضافة إعلان جديد
                  </h3>
                  <p className="text-xs text-slate-500">
                    باقة {planRules.planLabel}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
              {planRules.summaryText}
            </div>

            {formError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAd} className="space-y-4">
              <div>
                <label
                  htmlFor="ad-title"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  عنوان الإعلان <span className="text-red-600">*</span>
                </label>
                <input
                  id="ad-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: خصم 20% على جميع الوجبات حتى نهاية الأسبوع"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  وسائط الإعلان (صورة أو فيديو — رفع إلى ad_media){' '}
                  <span className="text-red-600">*</span>
                </label>
                <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
                  <FileUp className="w-5 h-5 text-[#FF7B00]" />
                  <span className="text-xs font-bold text-[#0A192F]">
                    {mediaFile
                      ? mediaFile.name
                      : 'اختر صورة (JPG/PNG) أو فيديو (MP4/WebM)'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {localMediaPreviewUrl && (
                  <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-black aspect-video">
                    {localMediaType === 'video' ? (
                      <video
                        src={localMediaPreviewUrl}
                        controls
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <img
                        src={localMediaPreviewUrl}
                        alt="معاينة الإعلان"
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="ad-start-date"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    تاريخ البداية <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="ad-start-date"
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="ad-end-date"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      تاريخ الانتهاء <span className="text-red-600">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleApplyMaxDuration}
                      className="text-[11px] font-bold text-[#FF7B00] hover:underline cursor-pointer"
                    >
                      الحد الأقصى للباقة
                    </button>
                  </div>
                  <input
                    id="ad-end-date"
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>

              {planRules.requiresPayment ? (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
                  <div className="text-xs font-bold text-amber-900">
                    سداد رسوم الإعلان (باقة عادي — 7 أيام كحد أقصى)
                  </div>
                  <p className="text-[11px] text-amber-800">
                    باقة «عادي» تتطلب سداد قيمة الإعلان. عند الحفظ سيتم تسجيل المبلغ وتفعيل حالة الدفع.
                  </p>
                  <div>
                    <label
                      htmlFor="ad-price"
                      className="block text-xs font-semibold text-amber-950 mb-1"
                    >
                      سعر الإعلان (ج.م) <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="ad-price"
                      type="number"
                      required
                      min={1}
                      step="1"
                      value={adPrice}
                      onChange={(e) => setAdPrice(e.target.value)}
                      placeholder="مثال: 150"
                      className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-white text-sm font-mono tabular-nums text-[#0A192F]"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center justify-between">
                  <span>تكلفة الإعلان: مجاني ضمن باقة {planRules.planLabel}</span>
                  <span className="font-mono tabular-nums">0.00 ج.م</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {planRules.requiresPayment ? 'تأكيد الدفع ونشر الإعلان' : 'نشر الإعلان'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox Media Preview Modal */}
      {previewAd && (
        <div
          className="fixed inset-0 z-50 bg-[#0A192F]/80 flex items-center justify-center p-4"
          onClick={() => setPreviewAd(null)}
        >
          <div
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {previewAd.media_type === 'video' ? (
                  <Film className="w-4 h-4 text-[#FF7B00]" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-[#FF7B00]" />
                )}
                <div>
                  <h4 className="text-sm font-bold text-[#0A192F]">
                    {previewAd.title}
                  </h4>
                  <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <span>
                      {merchantNameMap.get(previewAd.merchant_id) || 'متجر هاتلي'}
                    </span>
                    <span>·</span>
                    <span className="font-mono tabular-nums inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatSubscriptionDate(previewAd.start_date)} ←{' '}
                      {formatSubscriptionDate(previewAd.end_date)}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAd(null)}
                aria-label="إغلاق المعاينة"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-black max-h-[70vh] flex items-center justify-center">
              {previewAd.media_type === 'video' ? (
                <video
                  src={previewAd.media_url}
                  controls
                  autoPlay
                  className="max-h-[70vh] w-full object-contain"
                />
              ) : (
                <img
                  src={previewAd.media_url}
                  alt={previewAd.title}
                  referrerPolicy="no-referrer"
                  className="max-h-[70vh] w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin Pricing & Approval Modal */}
      {reviewAd && (
        <div className="fixed inset-0 z-50 bg-[#0B1A33]/65 flex items-center justify-center p-4">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0B1A33]">
                  مراجعة وتسعير الإعلان
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {reviewAd.title} — {merchantNameMap.get(reviewAd.merchant_id) || 'متجر'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewAd(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdminReview} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  سعر الإعلان (ج.م)
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={reviewPrice}
                  onChange={(e) => setReviewPrice(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums text-[#0B1A33]"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  للتاجر على الباقة العادية: حدد سعر الإعلان لتأكيد التحصيل وإضافته لإيرادات هاتلي.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-[#0B1A33] cursor-pointer">
                <input
                  type="checkbox"
                  checked={reviewIsPaid}
                  onChange={(e) => setReviewIsPaid(e.target.checked)}
                  className="rounded border-slate-300 text-[#FF7F00]"
                />
                <span>تم السداد وتأكيد الدفع (is_paid)</span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  قرار المراجعة
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'approved', label: 'موافقة ونشر' },
                    { id: 'pending', label: 'معلق' },
                    { id: 'rejected', label: 'رفض' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setReviewDecision(
                          opt.id as 'pending' | 'approved' | 'rejected'
                        )
                      }
                      className={`py-2 px-2 rounded-lg border text-xs font-bold cursor-pointer ${
                        reviewDecision === opt.id
                          ? opt.id === 'rejected'
                            ? 'bg-[#EF2323] text-white border-[#EF2323]'
                            : opt.id === 'approved'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-[#0B1A33] text-white border-[#0B1A33]'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReviewAd(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingReview}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {savingReview ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>حفظ التسعير والقرار</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Store,
  Trash2,
  X,
} from 'lucide-react';
import { supabase, supabaseSignUpClient } from '../lib/supabase';
import type { Merchant, Zone } from '../types/database';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PLAN_OPTIONS,
  calculateSubscriptionDates,
  formatSubscriptionDate,
  getPlanLabel,
  isMerchantSubscriptionExpired,
  normalizeSubscriptionPlan,
  syncExpiredMerchants,
  type SubscriptionPlanKey,
} from '../utils/subscriptions';
import { invalidateSummaryCache } from '../utils/summaryCache';
import { MerchantStatementView } from './MerchantStatementView';
import { PaginationBar } from './PaginationBar';

const PAGE_SIZE = 20;

function sanitizePostgrestSearch(raw: string): string {
  return raw.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ACCOUNT_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'بانتظار تحديد الموقع', cls: 'text-slate-600' },
  pending_approval: { label: 'بانتظار موافقة الإدارة', cls: 'text-amber-700' },
  active: { label: 'نشط ومفعّل', cls: 'text-emerald-700' },
  suspended: { label: 'موقوف', cls: 'text-red-700' },
};

export function MerchantsView() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [accountStatusFilter, setAccountStatusFilter] = useState<string>('all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalMerchantsCount, setTotalMerchantsCount] = useState(0);
  const [allMerchantsForStatement, setAllMerchantsForStatement] = useState<
    Merchant[]
  >([]);
  const [activeTab, setActiveTab] = useState<'list' | 'statement'>('list');
  const [statementMerchantId, setStatementMerchantId] = useState<string | undefined>(
    undefined
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [detailsMerchant, setDetailsMerchant] = useState<Merchant | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Add Merchant Form State
  const [storeName, setStoreName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [planKey, setPlanKey] = useState<SubscriptionPlanKey>('standard');
  const [planPrice, setPlanPrice] = useState<string>('0');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Merchant Details / Renew Subscription State
  const [editPlanKey, setEditPlanKey] = useState<SubscriptionPlanKey>('standard');
  const [editPlanPrice, setEditPlanPrice] = useState<string>('0');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Delete Merchant Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<Merchant | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [deletingMerchant, setDeletingMerchant] = useState(false);
  const [suspendingInstead, setSuspendingInstead] = useState(false);
  const [totalMerchantOrdersCount, setTotalMerchantOrdersCount] = useState(0);
  const [activeOrdersCount, setActiveOrdersCount] = useState(0);
  const [relatedSummary, setRelatedSummary] = useState<{
    pastOrders: number;
    ads: number;
    revenues: number;
    settlements: number;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showSuspendFallback, setShowSuspendFallback] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const ensureAllMerchantsLoaded = useCallback(async () => {
    if (allMerchantsForStatement.length > 0) return;
    const res = await supabase
      .from('merchants')
      .select('*, profiles(full_name, phone, email)')
      .order('created_at', { ascending: false });
    if (!res.error && res.data) {
      setAllMerchantsForStatement(res.data as Merchant[]);
    }
  }, [allMerchantsForStatement.length]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const safeQ = sanitizePostgrestSearch(debouncedSearch);

    // Server-side search across profile name/phone/email as well as merchant store_name
    let matchingProfileIds: string[] = [];
    if (safeQ) {
      const profRes = await supabase
        .from('profiles')
        .select('id')
        .or(
          `full_name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,email.ilike.%${safeQ}%`
        );
      matchingProfileIds = ((profRes.data as { id: string }[]) || []).map(
        (p) => p.id
      );
    }

    const buildMerchantsQuery = (
      selectStr: string,
      includeOptionalSearchCols: boolean
    ) => {
      let q = supabase
        .from('merchants')
        .select(selectStr, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (accountStatusFilter !== 'all') {
        q = q.eq('account_status', accountStatusFilter);
      }
      if (zoneFilter !== 'all') {
        q = q.eq('zone_id', zoneFilter);
      }
      if (safeQ) {
        const searchParts = [`store_name.ilike.%${safeQ}%`];
        if (includeOptionalSearchCols) {
          searchParts.push(`phone.ilike.%${safeQ}%`, `email.ilike.%${safeQ}%`);
        }
        if (matchingProfileIds.length > 0) {
          searchParts.push(`profile_id.in.(${matchingProfileIds.join(',')})`);
        }
        q = q.or(searchParts.join(','));
      }

      return q.range(from, to);
    };

    const [merchResInitial, zonesRes] = await Promise.all([
      buildMerchantsQuery('*, profiles(full_name, phone, email), zones(id, name)', true),
      supabase
        .from('zones')
        .select('*')
        .order('created_at', { ascending: true }),
    ]);

    let merchRes = merchResInitial;
    if (
      merchRes.error &&
      safeQ &&
      (merchRes.error.code === '42703' || merchRes.error.code === 'PGRST204')
    ) {
      merchRes = await buildMerchantsQuery(
        '*, profiles(full_name, phone, email), zones(id, name)',
        false
      );
    }

    let loadedMerchants = (merchRes.data as unknown as Merchant[]) || [];
    let totalCount = merchRes.count ?? loadedMerchants.length;

    if (merchRes.error) {
      const fallbackRes = await buildMerchantsQuery('*', false);
      loadedMerchants = (fallbackRes.data as unknown as Merchant[]) || [];
      totalCount = fallbackRes.count ?? loadedMerchants.length;
    }

    // Auto-suspend any expired merchant subscriptions in Supabase & state
    const syncedMerchants = await syncExpiredMerchants(loadedMerchants);

    const loadedZones = (zonesRes.data as Zone[]) || [];
    setMerchants(syncedMerchants);
    setTotalMerchantsCount(totalCount);
    setZones(loadedZones);
    if (loadedZones.length > 0 && !zoneId) {
      setZoneId(loadedZones[0].id);
    }
    setLoading(false);
  }, [currentPage, debouncedSearch, accountStatusFilter, zoneFilter, zoneId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const zoneMap = useMemo(() => {
    const map = new Map<string, string>();
    zones.forEach((z) =>
      map.set(z.id, z.name_ar || z.name || z.zone_name || z.title || z.id)
    );
    return map;
  }, [zones]);

  const previewNewDates = useMemo(
    () => calculateSubscriptionDates(planKey),
    [planKey]
  );

  const previewEditDates = useMemo(
    () => calculateSubscriptionDates(editPlanKey),
    [editPlanKey]
  );

  const openMerchantDetails = (merchant: Merchant) => {
    setDetailsMerchant(merchant);
    setEditPlanKey(normalizeSubscriptionPlan(merchant.subscription_plan) || 'standard');
    setEditPlanPrice('0');
    setDetailsError(null);
  };

  const handleApproveMerchant = async (merchant: Merchant) => {
    setApprovingId(merchant.id);
    setFeedback(null);

    const { error } = await supabase
      .from('merchants')
      .update({ account_status: 'active' })
      .eq('id', merchant.id);

    setApprovingId(null);

    if (error) {
      setFeedback({ type: 'error', text: error.message });
      return;
    }

    const displayName =
      merchant.store_name || merchant.profiles?.full_name || merchant.name || 'المتجر';
    setFeedback({
      type: 'success',
      text: `تمت الموافقة وتفعيل متجر "${displayName}" بنجاح`,
    });
    invalidateSummaryCache('overview_');
    await loadData();
  };

  const handleCreateMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanStoreName = storeName.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim();
    const parsedPrice = Number(planPrice || 0);

    if (!cleanStoreName || !cleanPhone || !cleanEmail || password.length < 6) {
      setFormError(
        'يرجى إدخال اسم المتجر ورقم الهاتف والبريد الإلكتروني وكلمة مرور لا تقل عن 6 أحرف'
      );
      return;
    }

    if (!zoneId) {
      setFormError('يرجى اختيار المنطقة من القائمة');
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setFormError('يرجى إدخال سعر باقة صحيح (0 أو أكثر)');
      return;
    }

    setSubmitting(true);

    try {
      const { data: signUpData, error: signUpError } =
        await supabaseSignUpClient.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: cleanStoreName,
              phone: cleanPhone,
              role: 'merchant',
            },
          },
        });

      if (signUpError || !signUpData.user) {
        throw new Error(signUpError?.message || 'تعذر إنشاء حساب المتجر');
      }

      if (
        Array.isArray(signUpData.user.identities) &&
        signUpData.user.identities.length === 0
      ) {
        throw new Error('هذا البريد الإلكتروني مسجل مسبقاً في النظام');
      }

      const newUserId = signUpData.user.id;

      const { error: profileErr } = await supabase.from('profiles').upsert({
        id: newUserId,
        full_name: cleanStoreName,
        phone: cleanPhone,
        email: cleanEmail,
        role: 'merchant',
      });

      if (profileErr) {
        throw new Error(`فشل حفظ الملف الشخصي: ${profileErr.message}`);
      }

      const { startDateIso, endDateIso } = calculateSubscriptionDates(planKey);
      const planLabel = SUBSCRIPTION_PLANS[planKey].labelAr;

      const { data: insertedMerchant, error: merchantErr } = await supabase
        .from('merchants')
        .insert({
          profile_id: newUserId,
          store_name: cleanStoreName,
          zone_id: zoneId,
          account_status: 'pending',
          subscription_plan: planLabel,
          subscription_start_date: startDateIso,
          subscription_end_date: endDateIso,
          is_active: true,
        })
        .select('id')
        .single();

      if (merchantErr || !insertedMerchant) {
        throw new Error(
          `فشل حفظ بيانات المتجر: ${merchantErr?.message || 'خطأ غير معروف'}`
        );
      }

      const { error: revErr } = await supabase
        .from('subscription_revenues')
        .insert({
          merchant_id: insertedMerchant.id,
          plan_name: planLabel,
          amount: Number(parsedPrice.toFixed(2)),
          start_date: startDateIso,
          end_date: endDateIso,
        });

      if (revErr) {
        throw new Error(
          `تم إنشاء المتجر ولكن تعذر تسجيل إيراد الاشتراك: ${revErr.message}`
        );
      }

      setFeedback({
        type: 'success',
        text: `تم إنشاء متجر "${cleanStoreName}" بباقة "${planLabel}" (تنتهي في ${formatSubscriptionDate(
          endDateIso
        )}) وتسجيل إيراد الاشتراك بنجاح.`,
      });
      setModalOpen(false);
      setStoreName('');
      setPhone('');
      setEmail('');
      setPassword('');
      setPlanKey('standard');
      setPlanPrice('0');
      setAllMerchantsForStatement([]);
      invalidateSummaryCache('overview_');
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailsMerchant) return;

    setDetailsError(null);
    const parsedPrice = Number(editPlanPrice || 0);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setDetailsError('يرجى إدخال سعر باقة صحيح (0 أو أكثر)');
      return;
    }

    setSavingDetails(true);

    try {
      const { startDateIso, endDateIso } = calculateSubscriptionDates(editPlanKey);
      const planLabel = SUBSCRIPTION_PLANS[editPlanKey].labelAr;

      const { error: updateErr } = await supabase
        .from('merchants')
        .update({
          subscription_plan: planLabel,
          subscription_start_date: startDateIso,
          subscription_end_date: endDateIso,
          is_active: true,
        })
        .eq('id', detailsMerchant.id);

      if (updateErr) {
        throw new Error(`تعذر تحديث اشتراك المتجر: ${updateErr.message}`);
      }

      const { error: revErr } = await supabase
        .from('subscription_revenues')
        .insert({
          merchant_id: detailsMerchant.id,
          plan_name: planLabel,
          amount: Number(parsedPrice.toFixed(2)),
          start_date: startDateIso,
          end_date: endDateIso,
        });

      if (revErr) {
        throw new Error(
          `تم تحديث الباقة ولكن تعذر تسجيل إيراد الاشتراك: ${revErr.message}`
        );
      }

      const displayName =
        detailsMerchant.store_name ||
        detailsMerchant.profiles?.full_name ||
        'المتجر';
      setFeedback({
        type: 'success',
        text: `تم تفعيل باقة "${planLabel}" لمتجر "${displayName}" حتى ${formatSubscriptionDate(
          endDateIso
        )} وتسجيل ${parsedPrice.toFixed(2)} ج.م في إيرادات الاشتراكات`,
      });
      setDetailsMerchant(null);
      await loadData();
    } catch (err) {
      setDetailsError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الاشتراك'
      );
    } finally {
      setSavingDetails(false);
    }
  };

  const openDeleteModal = async (merchant: Merchant) => {
    setDeleteTarget(merchant);
    setDeleteError(null);
    setShowSuspendFallback(false);
    setTotalMerchantOrdersCount(0);
    setActiveOrdersCount(0);
    setRelatedSummary(null);
    setCheckingDelete(true);

    try {
      const [ordersRes, adsRes, revRes, settRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, status')
          .eq('merchant_id', merchant.id),
        supabase
          .from('advertisements')
          .select('id', { count: 'exact', head: true })
          .eq('merchant_id', merchant.id),
        supabase
          .from('subscription_revenues')
          .select('id', { count: 'exact', head: true })
          .eq('merchant_id', merchant.id),
        supabase
          .from('merchant_settlements')
          .select('id', { count: 'exact', head: true })
          .eq('merchant_id', merchant.id),
      ]);

      const orders = (ordersRes.data as { id: string; status: string }[]) || [];
      const activeCount = orders.filter(
        (o) => o.status !== 'delivered' && o.status !== 'cancelled'
      ).length;

      setTotalMerchantOrdersCount(orders.length);
      setActiveOrdersCount(activeCount);
      setRelatedSummary({
        pastOrders: orders.length - activeCount,
        ads: adsRes.count ?? 0,
        revenues: revRes.count ?? 0,
        settlements: settRes.count ?? 0,
      });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'تعذر التحقق من بيانات التاجر'
      );
    } finally {
      setCheckingDelete(false);
    }
  };

  const handleSuspendMerchantInstead = async () => {
    if (!deleteTarget) return;

    setDeleteError(null);
    setSuspendingInstead(true);

    try {
      const { data: updatedRows, error: suspendErr } = await supabase
        .from('merchants')
        .update({
          account_status: 'suspended',
          is_active: false,
        })
        .eq('id', deleteTarget.id)
        .select('id');

      if (suspendErr) {
        throw new Error(`تعذر إيقاف المتجر: ${suspendErr.message}`);
      }
      if (!updatedRows || updatedRows.length === 0) {
        throw new Error('لم يتم تحديث حالة المتجر في قاعدة البيانات.');
      }

      if (deleteTarget.profile_id) {
        await supabase
          .from('profiles')
          .update({ is_active: false, status: 'suspended' })
          .eq('id', deleteTarget.profile_id);
      }

      const displayName =
        deleteTarget.store_name ||
        deleteTarget.profiles?.full_name ||
        deleteTarget.name ||
        'التاجر';

      setAllMerchantsForStatement([]);
      invalidateSummaryCache();
      setDeleteTarget(null);
      setShowSuspendFallback(false);
      setFeedback({
        type: 'success',
        text: `تم إيقاف حساب التاجر "${displayName}" بنجاح بدلاً من حذفه.`,
      });
      await loadData();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء إيقاف المتجر'
      );
    } finally {
      setSuspendingInstead(false);
    }
  };

  const isForeignKeyViolation = (err: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null) => {
    if (!err) return false;
    const text = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`;
    return (
      err.code === '23503' ||
      /foreign key|violates.*constraint|referenced from table/i.test(text)
    );
  };

  const handleConfirmDeleteMerchant = async () => {
    if (!deleteTarget) return;

    setDeleteError(null);
    setShowSuspendFallback(false);
    setDeletingMerchant(true);

    const FK_ORDERS_MSG =
      'لا يمكن حذف التاجر لوجود طلبات مرتبطة به. يمكنك إيقاف حسابه بدلاً من ذلك.';

    try {
      const targetId = deleteTarget.id;
      const targetProfileId = deleteTarget.profile_id || null;

      console.log('Attempting to delete merchant:', {
        merchantId: targetId,
        profileId: targetProfileId,
      });

      // 1. Check active orders first — prevent deleting merchants with in-progress orders
      const { data: merchantOrders, error: ordersCheckErr } = await supabase
        .from('orders')
        .select('id, status')
        .eq('merchant_id', targetId);

      if (ordersCheckErr) {
        console.log('Supabase check merchant orders error:', ordersCheckErr);
      } else if (merchantOrders) {
        const activeList = (
          merchantOrders as { id: string; status: string }[]
        ).filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');

        if (activeList.length > 0) {
          setActiveOrdersCount(activeList.length);
          setShowSuspendFallback(true);
          throw new Error(FK_ORDERS_MSG);
        }
      }

      let merchantDeleted = false;
      let profileDeleted = false;
      let lastProfileError: {
        code?: string | null;
        message?: string | null;
        details?: string | null;
        hint?: string | null;
      } | null = null;

      // 2. First delete the associated profile record (which should cascade-delete the merchant)
      if (targetProfileId) {
        const { data: deletedProfiles, error: profileDelErr } = await supabase
          .from('profiles')
          .delete()
          .eq('id', targetProfileId)
          .select('id');

        if (profileDelErr) {
          lastProfileError = profileDelErr;
          console.log('Supabase delete profile error:', profileDelErr);

          if (isForeignKeyViolation(profileDelErr)) {
            const profErrText = `${profileDelErr.message || ''} ${
              profileDelErr.details || ''
            } ${profileDelErr.hint || ''}`;
            const { count: ordersCount } = await supabase
              .from('orders')
              .select('id', { count: 'exact', head: true })
              .eq('merchant_id', targetId);

            if ((ordersCount ?? 0) > 0 || /orders/i.test(profErrText)) {
              setShowSuspendFallback(true);
              throw new Error(FK_ORDERS_MSG);
            }
          }
        } else if (deletedProfiles && deletedProfiles.length > 0) {
          profileDeleted = true;
          const { count: remainingMerchantCount, error: checkMerchErr } =
            await supabase
              .from('merchants')
              .select('id', { count: 'exact', head: true })
              .eq('id', targetId);

          if (checkMerchErr) {
            console.log('Supabase verify cascade delete error:', checkMerchErr);
          } else if (remainingMerchantCount === 0) {
            merchantDeleted = true;
          }
        } else {
          console.log('Supabase delete profile returned 0 rows:', {
            targetProfileId,
            deletedProfiles,
          });
        }
      }

      // 3. If merchant record was not cascade-deleted, delete from merchants directly by id
      if (!merchantDeleted) {
        let { data: deletedRows, error: merchDelErr } = await supabase
          .from('merchants')
          .delete()
          .eq('id', targetId)
          .select('id');

        if (merchDelErr) {
          console.log('Supabase delete merchant error:', merchDelErr);
        }

        if (merchDelErr && isForeignKeyViolation(merchDelErr)) {
          const errText = `${merchDelErr.message || ''} ${
            merchDelErr.details || ''
          } ${merchDelErr.hint || ''}`;

          const { count: ordersCount } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('merchant_id', targetId);

          if (
            (ordersCount ?? totalMerchantOrdersCount) > 0 ||
            /orders/i.test(errText)
          ) {
            setShowSuspendFallback(true);
            throw new Error(FK_ORDERS_MSG);
          }

          // Clean up non-order merchant child records and retry deleting merchant
          await Promise.all([
            supabase.from('advertisements').delete().eq('merchant_id', targetId),
            supabase
              .from('subscription_revenues')
              .delete()
              .eq('merchant_id', targetId),
            supabase
              .from('merchant_settlements')
              .delete()
              .eq('merchant_id', targetId),
          ]);

          const retryRes = await supabase
            .from('merchants')
            .delete()
            .eq('id', targetId)
            .select('id');

          deletedRows = retryRes.data;
          merchDelErr = retryRes.error;

          if (merchDelErr) {
            console.log('Supabase delete merchant retry error:', merchDelErr);
            if (isForeignKeyViolation(merchDelErr)) {
              setShowSuspendFallback(true);
              throw new Error(FK_ORDERS_MSG);
            }
            throw new Error(
              `تعذر مسح التاجر (${merchDelErr.code || 'Error'}): ${merchDelErr.message}`
            );
          }
        } else if (merchDelErr) {
          throw new Error(
            `تعذر مسح سجل التاجر (${merchDelErr.code || 'Error'}): ${merchDelErr.message}`
          );
        }

        if (!deletedRows || deletedRows.length === 0) {
          console.log('Supabase delete merchant affected 0 rows:', {
            targetId,
            targetProfileId,
            deletedRows,
            lastProfileError,
          });
          throw new Error(
            lastProfileError?.message
              ? `لم يتم الحذف من قاعدة البيانات (${lastProfileError.code || 'RLS'}): ${lastProfileError.message}`
              : 'لم يتم حذف التاجر من قاعدة البيانات. يرجى التحقق من سياسات الحذف (RLS) في Supabase.'
          );
        }

        merchantDeleted = true;
      }

      // 4. If merchant was deleted directly and profile still exists, delete (or suspend) the profile
      if (merchantDeleted && targetProfileId && !profileDeleted) {
        const { error: secondProfDelErr } = await supabase
          .from('profiles')
          .delete()
          .eq('id', targetProfileId);

        if (secondProfDelErr) {
          console.log(
            'Supabase secondary delete profile error:',
            secondProfDelErr
          );
          await supabase
            .from('profiles')
            .update({ is_active: false, status: 'suspended' })
            .eq('id', targetProfileId);
        }
      }

      const displayName =
        deleteTarget.store_name ||
        deleteTarget.profiles?.full_name ||
        deleteTarget.name ||
        'التاجر';

      if (detailsMerchant?.id === targetId) {
        setDetailsMerchant(null);
      }

      setMerchants((prev) => prev.filter((m) => m.id !== targetId));
      setTotalMerchantsCount((prev) => Math.max(0, prev - 1));
      setAllMerchantsForStatement([]);
      invalidateSummaryCache();
      setDeleteTarget(null);
      setFeedback({
        type: 'success',
        text: `تم حذف التاجر "${displayName}" وملفه الشخصي من قاعدة البيانات بنجاح.`,
      });

      // 5. Refresh UI immediately from Supabase
      if (merchants.length <= 1 && currentPage > 1) {
        setCurrentPage((prev) => Math.max(1, prev - 1));
      } else {
        await loadData();
      }
    } catch (err) {
      console.log('Delete merchant failed:', err);
      setDeleteError(
        err instanceof Error ? err.message : 'حدث خطأ أثناء مسح التاجر'
      );
    } finally {
      setDeletingMerchant(false);
    }
  };

  return (
    <div className="space-y-5">
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
            إغلاق
          </button>
        </div>
      )}

      {/* Sub-navigation Tabs: Merchants List vs Merchant Statement */}
      <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
            activeTab === 'list'
              ? 'bg-[#0A192F] text-white'
              : 'text-slate-600 hover:text-[#0A192F]'
          }`}
        >
          قائمة المتاجر
        </button>
        <button
          type="button"
          onClick={() => {
            ensureAllMerchantsLoaded();
            setActiveTab('statement');
          }}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
            activeTab === 'statement'
              ? 'bg-[#FF7B00] text-white'
              : 'text-slate-600 hover:text-[#0A192F]'
          }`}
        >
          كشف حساب
        </button>
      </div>

      {activeTab === 'statement' ? (
        <MerchantStatementView
          merchants={
            allMerchantsForStatement.length > 0
              ? allMerchantsForStatement
              : merchants
          }
          initialMerchantId={statementMerchantId}
          onPaymentSaved={(msg) => {
            setFeedback({ type: 'success', text: msg });
            invalidateSummaryCache();
            loadData();
          }}
        />
      ) : (
        <>
          {/* Header & Server-Side Filters */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[#0A192F]">
                  المتاجر والبراندات والاشتراكات
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  إدارة الباقات الشهرية والاعتماد التلقائي — يتوقف المتجر تلقائياً عن استقبال الطلبات فور انتهاء الاشتراك
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadData}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>تحديث</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة متجر جديد</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث باسم المتجر، البريد، أو الهاتف..."
                  className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>

              <select
                value={accountStatusFilter}
                onChange={(e) => {
                  setAccountStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="تصفية حسب حالة المتجر"
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0A192F]"
              >
                <option value="all">كل حالات الحساب</option>
                <option value="active">نشط ومفعّل</option>
                <option value="pending_approval">بانتظار موافقة الإدارة</option>
                <option value="pending">بانتظار تحديد الموقع</option>
                <option value="suspended">موقوف</option>
              </select>

              <select
                value={zoneFilter}
                onChange={(e) => {
                  setZoneFilter(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="تصفية حسب المنطقة"
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0A192F]"
              >
                <option value="all">كل المناطق</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name_ar || z.name || z.zone_name || z.title || z.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Merchants Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
                <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
                <span className="text-sm">جاري تحميل المتاجر...</span>
              </div>
            ) : merchants.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="text-sm font-bold text-[#0A192F]">
                  لا توجد متاجر مسجلة حتى الآن
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] text-white text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة متجر جديد</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                      <th className="py-3 px-4 whitespace-nowrap">اسم المتجر</th>
                      <th className="py-3 px-4 whitespace-nowrap">الهاتف</th>
                      <th className="py-3 px-4 whitespace-nowrap">المنطقة</th>
                      <th className="py-3 px-4 whitespace-nowrap">الباقة وتاريخ الانتهاء</th>
                      <th className="py-3 px-4 whitespace-nowrap">الموقع</th>
                      <th className="py-3 px-4 whitespace-nowrap">الحالة</th>
                      <th className="py-3 px-4 whitespace-nowrap">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {merchants.map((merchant) => {
                      const statusMeta = ACCOUNT_STATUS_LABELS[
                        merchant.account_status
                      ] || {
                        label: merchant.account_status,
                        cls: 'text-slate-600',
                      };
                      const displayName =
                        merchant.store_name ||
                        merchant.profiles?.full_name ||
                        merchant.name ||
                        'متجر';
                      const displayPhone =
                        merchant.profiles?.phone || merchant.phone || '—';
                      const displayEmail =
                        merchant.profiles?.email || merchant.email || '—';
                      const displayZone =
                        merchant.zones?.name ||
                        (merchant.zone_id
                          ? zoneMap.get(merchant.zone_id) || merchant.zone_id
                          : '—');
                      const hasLocation =
                        merchant.latitude != null && merchant.longitude != null;
                      const isPendingApproval =
                        merchant.account_status === 'pending_approval';
                      const expired = isMerchantSubscriptionExpired(merchant);
                      const hasPlan = Boolean(
                        merchant.subscription_plan || merchant.subscription_end_date
                      );

                      return (
                        <tr key={merchant.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <div className="font-bold text-[#0A192F] whitespace-nowrap">
                              {displayName}
                            </div>
                            <div className="text-xs text-slate-500" dir="ltr">
                              {displayEmail}
                            </div>
                          </td>
                          <td
                            className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap text-right"
                            dir="ltr"
                          >
                            {displayPhone}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-700">
                            {displayZone}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {hasPlan ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[#0A192F] text-xs">
                                    {getPlanLabel(merchant.subscription_plan)}
                                  </span>
                                  {expired ? (
                                    <span className="px-2 py-0.5 rounded bg-red-100 border border-red-200 text-red-700 text-[11px] font-bold">
                                      منتهي
                                    </span>
                                  ) : (
                                    <span className="text-[11px] font-bold text-emerald-700">
                                      ساري
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                                  ينتهي: {formatSubscriptionDate(merchant.subscription_end_date)}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">غير مشترك</span>
                                {merchant.is_active === false && (
                                  <span className="px-2 py-0.5 rounded bg-red-100 border border-red-200 text-red-700 text-[11px] font-bold">
                                    منتهي
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-xs font-mono tabular-nums text-slate-600">
                            {hasLocation ? (
                              <a
                                href={`https://www.openstreetmap.org/?mlat=${merchant.latitude}&mlon=${merchant.longitude}#map=16/${merchant.latitude}/${merchant.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                title="عرض الموقع على الخريطة"
                                className="inline-flex items-center gap-1.5 text-[#0A192F] hover:text-[#FF7B00] font-semibold"
                                dir="ltr"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#FF7B00] shrink-0" />
                                <span>
                                  {Number(merchant.latitude).toFixed(4)},{' '}
                                  {Number(merchant.longitude).toFixed(4)}
                                </span>
                                <ExternalLink className="w-3 h-3 text-slate-400" />
                              </a>
                            ) : (
                              <span className="text-slate-400 font-sans">
                                لم يحدد بعد
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-3 px-4 text-xs font-bold whitespace-nowrap ${statusMeta.cls}`}
                          >
                            <div>{statusMeta.label}</div>
                            {merchant.is_active === false && (
                              <div className="text-[11px] text-red-600 mt-0.5">
                                متوقف عن استقبال الطلبات
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {isPendingApproval && (
                                <button
                                  type="button"
                                  disabled={approvingId === merchant.id}
                                  onClick={() => handleApproveMerchant(merchant)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer transition-colors"
                                >
                                  {approvingId === merchant.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                  <span>موافقة وتفعيل</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => openMerchantDetails(merchant)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-bold cursor-pointer"
                              >
                                تفاصيل / الباقة
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  ensureAllMerchantsLoaded();
                                  setStatementMerchantId(merchant.id);
                                  setActiveTab('statement');
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[#0A192F] text-xs font-bold cursor-pointer"
                              >
                                كشف حساب
                              </button>

                              <button
                                type="button"
                                onClick={() => openDeleteModal(merchant)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50/70 hover:bg-red-100 text-[#EF2323] text-xs font-bold cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>مسح</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && totalMerchantsCount > 0 && (
              <PaginationBar
                currentPage={currentPage}
                pageSize={PAGE_SIZE}
                totalCount={totalMerchantsCount}
                loading={loading}
                onPageChange={setCurrentPage}
              />
            )}
          </div>
        </>
      )}

      {/* Add Merchant Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-[#0A192F]">
                إضافة متجر جديد
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
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

            <form onSubmit={handleCreateMerchant} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="merchant-store-name"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    اسم المتجر <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="merchant-store-name"
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="مطعم أو متجر..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="merchant-phone"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    رقم الهاتف <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="merchant-phone"
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010XXXXXXXX"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="merchant-email"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    البريد الإلكتروني <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="merchant-email"
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="store@brand.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="merchant-password"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    كلمة المرور <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="merchant-password"
                    type="password"
                    required
                    minLength={6}
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="merchant-zone"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    المنطقة <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="merchant-zone"
                    required
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  >
                    {zones.length === 0 ? (
                      <option value="">جاري تحميل المناطق...</option>
                    ) : (
                      zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name_ar || z.name || z.zone_name || z.id}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="merchant-plan"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    الباقة <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="merchant-plan"
                    value={planKey}
                    onChange={(e) =>
                      setPlanKey(e.target.value as SubscriptionPlanKey)
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white font-semibold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  >
                    {SUBSCRIPTION_PLAN_OPTIONS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.labelAr} ({p.durationAr})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="merchant-plan-price"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    سعر الباقة (ج.م)
                  </label>
                  <input
                    id="merchant-plan-price"
                    type="number"
                    min={0}
                    step="1"
                    value={planPrice}
                    onChange={(e) => setPlanPrice(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#FF7B00]" />
                  <span>تاريخ انتهاء الباقة المحسوب:</span>
                </span>
                <strong className="font-mono tabular-nums text-[#0A192F]">
                  {formatSubscriptionDate(previewNewDates.endDateIso)}
                </strong>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>إنشاء المتجر وتفعيل الباقة</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merchant Details & Subscription Plan Modal */}
      {detailsMerchant && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-6 space-y-5 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#0A192F] text-[#FF7B00] flex items-center justify-center">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0A192F]">
                    تفاصيل المتجر وإدارة الباقة
                  </h3>
                  <p className="text-xs text-slate-500">
                    {detailsMerchant.store_name ||
                      detailsMerchant.profiles?.full_name ||
                      'متجر'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailsMerchant(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Merchant Summary */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-500">الهاتف</div>
                <div
                  className="font-mono tabular-nums font-bold text-[#0A192F] mt-0.5 text-right"
                  dir="ltr"
                >
                  {detailsMerchant.profiles?.phone || detailsMerchant.phone || '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">المنطقة</div>
                <div className="font-bold text-[#0A192F] mt-0.5">
                  {detailsMerchant.zones?.name ||
                    (detailsMerchant.zone_id
                      ? zoneMap.get(detailsMerchant.zone_id) ||
                        detailsMerchant.zone_id
                      : '—')}
                </div>
              </div>
              <div>
                <div className="text-slate-500">الباقة الحالية</div>
                <div className="font-bold text-[#0A192F] mt-0.5 flex items-center gap-1.5">
                  <span>
                    {detailsMerchant.subscription_plan
                      ? getPlanLabel(detailsMerchant.subscription_plan)
                      : 'غير محدد'}
                  </span>
                  {isMerchantSubscriptionExpired(detailsMerchant) && (
                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">
                      منتهي
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-slate-500">تاريخ الانتهاء الحالي</div>
                <div className="font-mono tabular-nums font-bold text-[#0A192F] mt-0.5">
                  {formatSubscriptionDate(detailsMerchant.subscription_end_date)}
                </div>
              </div>
            </div>

            {isMerchantSubscriptionExpired(detailsMerchant) && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>
                  اشتراك هذا المتجر منتهي (is_active = false) ولا يمكنه استقبال طلبات جديدة حتى تجديد الباقة.
                </span>
              </div>
            )}

            {detailsError && (
              <div
                role="alert"
                className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{detailsError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSubscription} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="edit-merchant-plan"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    الباقة <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="edit-merchant-plan"
                    value={editPlanKey}
                    onChange={(e) =>
                      setEditPlanKey(e.target.value as SubscriptionPlanKey)
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white font-semibold text-[#0A192F]"
                  >
                    {SUBSCRIPTION_PLAN_OPTIONS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.labelAr} ({p.durationAr})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="edit-merchant-plan-price"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    سعر الباقة (ج.م)
                  </label>
                  <input
                    id="edit-merchant-plan-price"
                    type="number"
                    min={0}
                    step="1"
                    value={editPlanPrice}
                    onChange={(e) => setEditPlanPrice(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
                <span>تاريخ الانتهاء الجديد بعد الحفظ:</span>
                <strong className="font-mono tabular-nums">
                  {formatSubscriptionDate(previewEditDates.endDateIso)}
                </strong>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDetailsMerchant(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  إغلاق
                </button>
                <button
                  type="submit"
                  disabled={savingDetails}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {savingDetails && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>حفظ الباقة وتسجيل الإيراد</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Merchant Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
          <div
            dir="rtl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-merchant-dialog-title"
            className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 text-[#EF2323] flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <h3
                  id="delete-merchant-dialog-title"
                  className="text-base font-bold text-[#0A192F]"
                >
                  تأكيد مسح التاجر
                </h3>
              </div>
              <button
                type="button"
                disabled={deletingMerchant}
                onClick={() => setDeleteTarget(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <div className="text-sm font-bold text-[#0A192F]">
                {deleteTarget.store_name ||
                  deleteTarget.profiles?.full_name ||
                  deleteTarget.name ||
                  'متجر'}
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums" dir="ltr">
                {deleteTarget.profiles?.phone || deleteTarget.phone || '—'} ·{' '}
                {deleteTarget.profiles?.email || deleteTarget.email || '—'}
              </div>
            </div>

            <p className="text-sm font-semibold text-[#0A192F] leading-relaxed">
              هل أنت متأكد من مسح هذا التاجر؟ سيتم حذف جميع بياناته.
            </p>

            {checkingDelete ? (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <Loader2 className="w-4 h-4 text-[#FF7B00] animate-spin shrink-0" />
                <span>جاري فحص الطلبات والبيانات المرتبطة...</span>
              </div>
            ) : totalMerchantOrdersCount > 0 ? (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold"
              >
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <span>
                  يوجد{' '}
                  <strong className="font-mono tabular-nums">
                    {totalMerchantOrdersCount}
                  </strong>{' '}
                  طلب/طلبات مرتبطة بهذا المتجر
                  {activeOrdersCount > 0
                    ? ` (منها ${activeOrdersCount} طلب نشط)`
                    : ''}
                  . قد تمنع قيود قاعدة البيانات الحذف؛ يمكنك إيقافه بدلاً من ذلك.
                </span>
              </div>
            ) : (
              relatedSummary &&
              (relatedSummary.ads > 0 ||
                relatedSummary.revenues > 0 ||
                relatedSummary.settlements > 0) && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
                  <div className="font-bold">بيانات مرتبطة بالمتجر:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {relatedSummary.ads > 0 && (
                      <li>{relatedSummary.ads} إعلان مرتبط بالمتجر</li>
                    )}
                    {relatedSummary.revenues > 0 && (
                      <li>{relatedSummary.revenues} سجل اشتراك</li>
                    )}
                    {relatedSummary.settlements > 0 && (
                      <li>{relatedSummary.settlements} سجل تسوية مالية</li>
                    )}
                  </ul>
                </div>
              )
            )}

            {deleteError && (
              <div
                role="alert"
                className="space-y-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
                {showSuspendFallback && (
                  <button
                    type="button"
                    disabled={suspendingInstead || deletingMerchant}
                    onClick={handleSuspendMerchantInstead}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0A192F] hover:bg-[#112240] disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                  >
                    {suspendingInstead && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    <span>إيقاف المتجر بدلاً من الحذف</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={deletingMerchant || suspendingInstead}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={checkingDelete || deletingMerchant || suspendingInstead}
                onClick={handleConfirmDeleteMerchant}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#EF2323] hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {deletingMerchant ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>تأكيد المسح</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileUp,
  Gavel,
  Loader2,
  Pencil,
  Plus,
  PowerOff,
  Receipt,
  RefreshCw,
  Search,
  X,
  Zap,
} from 'lucide-react';
import { supabase, supabaseSignUpClient } from '../lib/supabase';
import type {
  AccountStatus,
  Courier,
  CourierDeposit,
  CourierPenalty,
  CourierStatus,
  CourierZone,
  Order,
  OrderCourier,
  Zone,
} from '../types/database';
import { ZonesMultiSelectDropdown, getZoneLabel } from './ZonesMultiSelectDropdown';
import { fetchCourierCommissionPct } from '../utils/commissions';
import {
  DEFAULT_DAILY_CASH_LIMIT,
  DEFAULT_MAX_CASH_LIMIT,
  fetchCashLimits,
  getMillisecondsUntilMidnight,
  syncCourierCashLimits,
  type CashLimitSettings,
  type CourierCashStatus,
} from '../utils/cashLimits';
import { computeDynamicActiveOrdersMap } from '../utils/activeOrders';
import { buildCourierCustodySummaries } from '../utils/custody';
import { invalidateSummaryCache } from '../utils/summaryCache';
import { useOrdersRealtime } from '../utils/useOrdersRealtime';
import { PaginationBar } from './PaginationBar';
import { RecordDepositModal } from './RecordDepositModal';
import { RecordPenaltyModal } from './RecordPenaltyModal';
import { CourierStatementView } from './CourierStatementView';

const PAGE_SIZE = 20;

function sanitizePostgrestSearch(raw: string): string {
  return raw.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function CouriersView() {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderCouriers, setOrderCouriers] = useState<OrderCourier[]>([]);
  const [deposits, setDeposits] = useState<CourierDeposit[]>([]);
  const [penalties, setPenalties] = useState<CourierPenalty[]>([]);
  const [commissionPct, setCommissionPct] = useState<number>(70);
  const [cashLimits, setCashLimits] = useState<CashLimitSettings>({
    dailyLimit: DEFAULT_DAILY_CASH_LIMIT,
    maxLimit: DEFAULT_MAX_CASH_LIMIT,
  });
  const [cashStatusMap, setCashStatusMap] = useState<
    Map<string, CourierCashStatus>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCouriersCount, setTotalCouriersCount] = useState(0);
  const [allCouriersForDropdown, setAllCouriersForDropdown] = useState<Courier[]>([]);
  const [activeTab, setActiveTab] = useState<'list' | 'statement'>('list');
  const [statementCourierId, setStatementCourierId] = useState<string | undefined>(
    undefined
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositCourierId, setDepositCourierId] = useState<string | undefined>(
    undefined
  );
  const [penaltyModalOpen, setPenaltyModalOpen] = useState(false);
  const [penaltyCourierId, setPenaltyCourierId] = useState<string | undefined>(
    undefined
  );
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [forcingId, setForcingId] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [courierZonesMap, setCourierZonesMap] = useState<Map<string, string[]>>(
    new Map()
  );
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Add Courier Form State
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [walletNumber, setWalletNumber] = useState('');
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [nationalIdFile, setNationalIdFile] = useState<File | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit Courier Modal State
  const [editingCourier, setEditingCourier] = useState<Courier | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBankDetails, setEditBankDetails] = useState('');
  const [editWalletNumber, setEditWalletNumber] = useState('');
  const [editAccountStatus, setEditAccountStatus] = useState<AccountStatus>('active');
  const [editZoneIds, setEditZoneIds] = useState<string[]>([]);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editFormError, setEditFormError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const ensureAllCouriersLoaded = useCallback(async () => {
    if (allCouriersForDropdown.length > 0) return;
    const res = await supabase
      .from('couriers')
      .select('*, profiles(full_name, phone, email)')
      .order('created_at', { ascending: false });
    if (!res.error && res.data) {
      setAllCouriersForDropdown(res.data as Courier[]);
    }
  }, [allCouriersForDropdown.length]);

  const loadCouriers = useCallback(async (silent = false) => {
    if (silent !== true) {
      setLoading(true);
    }
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const safeQ = sanitizePostgrestSearch(debouncedSearch);

    // Server-side search across profile name/phone/email + courier wallet/bank fields
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

    const applyCourierFilters = <T extends ReturnType<typeof supabase.from>>(
      selectStr: string
    ) => {
      let q = supabase
        .from('couriers')
        .select(selectStr, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter);
      }
      if (accountStatusFilter !== 'all') {
        q = q.eq('account_status', accountStatusFilter);
      }
      if (safeQ) {
        const parts = [
          `wallet_number.ilike.%${safeQ}%`,
          `bank_account_details.ilike.%${safeQ}%`,
        ];
        if (matchingProfileIds.length > 0) {
          parts.push(`profile_id.in.(${matchingProfileIds.join(',')})`);
        }
        q = q.or(parts.join(','));
      }
      return q.range(from, to) as unknown as ReturnType<typeof q.range> & T;
    };

    const [couriersRes, zonesRes, pct, limits] = await Promise.all([
      applyCourierFilters('*, profiles(full_name, phone, email)'),
      supabase
        .from('zones')
        .select('*')
        .order('created_at', { ascending: true }),
      fetchCourierCommissionPct(),
      fetchCashLimits(),
    ]);

    const loadedZones = (zonesRes.data as Zone[]) || [];
    setZones(loadedZones);

    let loadedCouriers: Courier[] = [];
    let totalCount = couriersRes.count ?? 0;

    if (!couriersRes.error && couriersRes.data) {
      loadedCouriers = couriersRes.data as unknown as Courier[];
    } else if (couriersRes.error) {
      const fallbackCouriers = await applyCourierFilters('*');
      loadedCouriers = (fallbackCouriers.data as unknown as Courier[]) || [];
      totalCount = fallbackCouriers.count ?? loadedCouriers.length;
    }

    setTotalCouriersCount(totalCount);

    // Scope custody/cash-limit/zones queries strictly to the 20 couriers on the current page
    const pageCourierIds = Array.from(
      new Set(
        loadedCouriers
          .flatMap((c) => [c.id, c.profile_id])
          .filter(Boolean) as string[]
      )
    );
    const pagePrimaryCourierIds = Array.from(
      new Set(loadedCouriers.map((c) => c.id).filter(Boolean))
    );

    let loadedOrders: Order[] = [];
    let loadedOrderCouriers: OrderCourier[] = [];
    let loadedDeposits: CourierDeposit[] = [];
    let loadedPenalties: CourierPenalty[] = [];
    const nextCourierZonesMap = new Map<string, string[]>();

    if (pageCourierIds.length > 0) {
      const [ocRes, depositsRes, penaltiesRes, czRes] = await Promise.all([
        supabase
          .from('order_couriers')
          .select('*')
          .in('courier_id', pageCourierIds),
        supabase
          .from('courier_deposits')
          .select('*')
          .in('courier_id', pageCourierIds),
        supabase
          .from('courier_penalties')
          .select('*')
          .in('courier_id', pageCourierIds),
        supabase
          .from('courier_zones')
          .select('*')
          .in('courier_id', pagePrimaryCourierIds),
      ]);

      loadedOrderCouriers = (ocRes.data as OrderCourier[]) || [];
      loadedDeposits =
        !depositsRes.error && depositsRes.data
          ? (depositsRes.data as CourierDeposit[])
          : [];
      loadedPenalties =
        !penaltiesRes.error && penaltiesRes.data
          ? (penaltiesRes.data as CourierPenalty[])
          : [];

      if (!czRes.error && czRes.data) {
        for (const row of czRes.data as CourierZone[]) {
          const list = nextCourierZonesMap.get(row.courier_id) || [];
          if (!list.includes(row.zone_id)) {
            list.push(row.zone_id);
          }
          nextCourierZonesMap.set(row.courier_id, list);
        }
      }

      const ocOrderIds = Array.from(
        new Set(loadedOrderCouriers.map((r) => r.order_id).filter(Boolean))
      );
      const orderFilterParts = [`courier_id.in.(${pageCourierIds.join(',')})`];
      if (ocOrderIds.length > 0) {
        orderFilterParts.push(`id.in.(${ocOrderIds.join(',')})`);
      }

      const ordersRes = await supabase
        .from('orders')
        .select('*')
        .or(orderFilterParts.join(','));
      loadedOrders = (ordersRes.data as Order[]) || [];
    }

    const { updatedCouriers, statusMap } = await syncCourierCashLimits(
      loadedCouriers,
      loadedOrders,
      loadedDeposits,
      loadedOrderCouriers,
      limits
    );

    setCouriers(updatedCouriers);
    setCourierZonesMap(nextCourierZonesMap);
    setOrders(loadedOrders);
    setOrderCouriers(loadedOrderCouriers);
    setDeposits(loadedDeposits);
    setPenalties(loadedPenalties);
    setCommissionPct(pct);
    setCashLimits(limits);
    setCashStatusMap(statusMap);
    setLoading(false);
  }, [currentPage, debouncedSearch, statusFilter, accountStatusFilter]);

  useEffect(() => {
    loadCouriers();
  }, [loadCouriers]);

  // Keep active orders counter in sync if an order is delivered/updated elsewhere (e.g. Courier app)
  const ordersRealtimeTimerRef = React.useRef<number | undefined>(undefined);

  useOrdersRealtime('couriers-view-orders-sync', () => {
    invalidateSummaryCache('overview_');
    if (ordersRealtimeTimerRef.current) {
      window.clearTimeout(ordersRealtimeTimerRef.current);
    }
    ordersRealtimeTimerRef.current = window.setTimeout(() => {
      loadCouriers(true);
    }, 250);
  });

  useEffect(() => {
    return () => {
      if (ordersRealtimeTimerRef.current) {
        window.clearTimeout(ordersRealtimeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadCouriers();
    }, getMillisecondsUntilMidnight());
    return () => window.clearTimeout(timer);
  }, [loadCouriers]);

  const dynamicActiveOrdersMap = useMemo(
    () => computeDynamicActiveOrdersMap(couriers, orders, orderCouriers),
    [couriers, orders, orderCouriers]
  );

  const custodySummaries = useMemo(
    () =>
      buildCourierCustodySummaries(
        couriers,
        orders,
        deposits,
        commissionPct,
        orderCouriers,
        penalties
      ),
    [couriers, orders, deposits, commissionPct, orderCouriers, penalties]
  );

  const custodyMap = useMemo(() => {
    const m = new Map<string, { remaining: number; penalties: number }>();
    custodySummaries.forEach((s) =>
      m.set(s.courier.id, {
        remaining: s.remainingCustody,
        penalties: s.totalPenalties ?? 0,
      })
    );
    return m;
  }, [custodySummaries]);

  const zonesMap = useMemo(() => {
    const m = new Map<string, Zone>();
    zones.forEach((z) => m.set(z.id, z));
    return m;
  }, [zones]);

  const handleToggleStatus = async (courier: Courier) => {
    const nextStatus: CourierStatus =
      courier.status === 'online' ? 'offline' : 'online';
    const cashSt = cashStatusMap.get(courier.id);

    if (nextStatus === 'online' && cashSt && !cashSt.canGoOnline) {
      setFeedback({
        type: 'error',
        text:
          cashSt.message ||
          'لقد وصلت للحد اليومي للكاش. يرجى توريد المبلغ لفتح الشغل.',
      });
      return;
    }

    setTogglingId(courier.id);

    const { error } = await supabase
      .from('couriers')
      .update({ status: nextStatus })
      .eq('id', courier.id);

    setTogglingId(null);

    if (error) {
      setFeedback({ type: 'error', text: error.message });
      return;
    }

    setCouriers((prev) =>
      prev.map((c) => (c.id === courier.id ? { ...c, status: nextStatus } : c))
    );
    invalidateSummaryCache('overview_');
  };

  const handleToggleForceOnline = async (
    courier: Courier,
    nextForceOnline: boolean
  ) => {
    setForcingId(courier.id);
    setFeedback(null);

    const { data: updatedRows, error } = await supabase
      .from('couriers')
      .update({ force_online: nextForceOnline })
      .eq('id', courier.id)
      .select('id, force_online');

    setForcingId(null);

    if (error) {
      setFeedback({
        type: 'error',
        text: `تعذر تحديث التفعيل القسري: ${error.message}`,
      });
      return;
    }

    if (!updatedRows || updatedRows.length === 0) {
      setFeedback({
        type: 'error',
        text: 'لم يتم تحديث سجل المندوب في قاعدة البيانات. يرجى التحقق من صلاحيات التعديل (RLS).',
      });
      return;
    }

    const courierName = courier.profiles?.full_name || 'المندوب';
    setCouriers((prev) =>
      prev.map((c) =>
        c.id === courier.id ? { ...c, force_online: nextForceOnline } : c
      )
    );
    invalidateSummaryCache('overview_');
    setFeedback({
      type: 'success',
      text: nextForceOnline
        ? `تم تفعيل "${courierName}" قسرياً (مُفعل قسرياً) لتجاوز قيود الوردية والسيلفي.`
        : `تم إلغاء التفعيل القسري للمندوب "${courierName}".`,
    });
  };

  const uploadCourierDoc = async (
    file: File,
    userId: string,
    docType: 'national_id' | 'license'
  ): Promise<string | null> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${userId}/${docType}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('courier_documents')
      .upload(path, file, { upsert: true });

    if (error) {
      throw new Error(`فشل رفع المستند (${docType}): ${error.message}`);
    }

    const { data } = supabase.storage
      .from('courier_documents')
      .getPublicUrl(path);

    return data.publicUrl;
  };

  const handleCreateCourier = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!fullName.trim() || !phone.trim() || !email.trim() || password.length < 6) {
      setFormError('يرجى إدخال الاسم والهاتف والبريد الإلكتروني وكلمة مرور لا تقل عن 6 أحرف');
      return;
    }

    setSubmitting(true);

    try {
      const { data: signUpData, error: signUpError } =
        await supabaseSignUpClient.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              phone: phone.trim(),
              role: 'courier',
            },
          },
        });

      if (signUpError || !signUpData.user) {
        throw new Error(signUpError?.message || 'تعذر إنشاء حساب المندوب في المصادقة');
      }

      const newUserId = signUpData.user.id;

      let nationalIdUrl: string | null = null;
      let licenseUrl: string | null = null;

      if (nationalIdFile) {
        nationalIdUrl = await uploadCourierDoc(
          nationalIdFile,
          newUserId,
          'national_id'
        );
      }

      if (licenseFile) {
        licenseUrl = await uploadCourierDoc(licenseFile, newUserId, 'license');
      }

      // Insert/upsert into profiles
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: newUserId,
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        role: 'courier',
      });

      if (profileError) {
        throw new Error(`فشل حفظ الملف الشخصي: ${profileError.message}`);
      }

      // Insert into couriers and retrieve generated courier id
      const { data: createdCourier, error: courierError } = await supabase
        .from('couriers')
        .insert({
          profile_id: newUserId,
          status: 'offline',
          active_orders_count: 0,
          national_id_url: nationalIdUrl,
          license_url: licenseUrl,
          bank_account_details: bankDetails.trim() || null,
          wallet_number: walletNumber.trim() || null,
          account_status: 'active',
        })
        .select('id')
        .single();

      if (courierError || !createdCourier) {
        throw new Error(
          `فشل حفظ سجل المندوب: ${courierError?.message || 'لم يتم إرجاع المعرف'}`
        );
      }

      // Insert selected service zones into courier_zones
      if (selectedZoneIds.length > 0) {
        const zoneRows = selectedZoneIds.map((zoneId) => ({
          courier_id: createdCourier.id,
          zone_id: zoneId,
        }));
        const { error: czError } = await supabase
          .from('courier_zones')
          .insert(zoneRows);
        if (czError) {
          throw new Error(
            `تم إنشاء المندوب ولكن تعذر حفظ مناطق التوزيع (courier_zones): ${czError.message}`
          );
        }
      }

      setFeedback({
        type: 'success',
        text: `تم إضافة المندوب "${fullName.trim()}" وتفعيل حسابه بنجاح`,
      });
      setModalOpen(false);
      setFullName('');
      setPhone('');
      setEmail('');
      setPassword('');
      setBankDetails('');
      setWalletNumber('');
      setSelectedZoneIds([]);
      setNationalIdFile(null);
      setLicenseFile(null);
      setAllCouriersForDropdown([]);
      invalidateSummaryCache('overview_');
      await loadCouriers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditModal = (courier: Courier) => {
    setEditingCourier(courier);
    setEditFullName(courier.profiles?.full_name || '');
    setEditPhone(courier.profiles?.phone || '');
    setEditBankDetails(courier.bank_account_details || '');
    setEditWalletNumber(courier.wallet_number || '');
    setEditAccountStatus(courier.account_status || 'active');
    setEditZoneIds(courierZonesMap.get(courier.id) || []);
    setEditFormError(null);
  };

  const handleUpdateCourier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourier) return;
    setEditFormError(null);

    if (!editFullName.trim() || !editPhone.trim()) {
      setEditFormError('يرجى إدخال اسم المندوب ورقم الهاتف');
      return;
    }

    setEditSubmitting(true);

    try {
      if (editingCourier.profile_id) {
        const { error: profErr } = await supabase
          .from('profiles')
          .update({
            full_name: editFullName.trim(),
            phone: editPhone.trim(),
          })
          .eq('id', editingCourier.profile_id);

        if (profErr) {
          throw new Error(`تعذر تحديث بيانات الملف الشخصي: ${profErr.message}`);
        }
      }

      const { error: courierErr } = await supabase
        .from('couriers')
        .update({
          bank_account_details: editBankDetails.trim() || null,
          wallet_number: editWalletNumber.trim() || null,
          account_status: editAccountStatus,
        })
        .eq('id', editingCourier.id);

      if (courierErr) {
        throw new Error(`تعذر تحديث بيانات المندوب: ${courierErr.message}`);
      }

      // Replace courier_zones assignments cleanly
      const { error: delZonesErr } = await supabase
        .from('courier_zones')
        .delete()
        .eq('courier_id', editingCourier.id);

      if (delZonesErr) {
        throw new Error(
          `تعذر تحديث مناطق التوزيع (courier_zones): ${delZonesErr.message}`
        );
      }

      if (editZoneIds.length > 0) {
        const zoneRows = editZoneIds.map((zoneId) => ({
          courier_id: editingCourier.id,
          zone_id: zoneId,
        }));
        const { error: insZonesErr } = await supabase
          .from('courier_zones')
          .insert(zoneRows);

        if (insZonesErr) {
          throw new Error(
            `تعذر حفظ مناطق التوزيع المختارة: ${insZonesErr.message}`
          );
        }
      }

      setFeedback({
        type: 'success',
        text: `تم تحديث بيانات المندوب "${editFullName.trim()}" ومناطق التوزيع بنجاح`,
      });
      setEditingCourier(null);
      setAllCouriersForDropdown([]);
      invalidateSummaryCache('overview_');
      await loadCouriers();
    } catch (err) {
      setEditFormError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setEditSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
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

      {/* Sub-navigation Tabs: Couriers List vs Courier Statement */}
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
          قائمة المناديب
        </button>
        <button
          type="button"
          onClick={() => {
            ensureAllCouriersLoaded();
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
        <CourierStatementView
          couriers={
            allCouriersForDropdown.length > 0 ? allCouriersForDropdown : couriers
          }
          initialCourierId={statementCourierId}
          onDepositSaved={(msg) => {
            setFeedback({ type: 'success', text: msg });
            invalidateSummaryCache();
            loadCouriers();
          }}
        />
      ) : (
        <>
          {/* Header Actions & Server-Side Filters */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[#0A192F]">قائمة المناديب</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  إدارة حالة الاتصال (متصل / غير متصل)، الطلبات النشطة، ورفع مستندات التفعيل
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadCouriers()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>تحديث</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    ensureAllCouriersLoaded();
                    setPenaltyCourierId(undefined);
                    setPenaltyModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#EF2323] hover:bg-red-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Gavel className="w-4 h-4" />
                  <span>تسجيل جزاء</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    loadCouriers();
                    setDepositCourierId(undefined);
                    setDepositModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0B1A33] hover:bg-[#13294B] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Receipt className="w-4 h-4 text-[#FF7F00]" />
                  <span>تسجيل توريد</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة مندوب جديد</span>
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
                  placeholder="بحث باسم المندوب، الهاتف، أو المحفظة..."
                  className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {[
                  { id: 'all', label: 'الكل' },
                  { id: 'online', label: 'متصل (Online)' },
                  { id: 'offline', label: 'غير متصل' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setStatusFilter(tab.id as 'all' | 'online' | 'offline');
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-white text-[#0B1A33] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <select
                value={accountStatusFilter}
                onChange={(e) => {
                  setAccountStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                aria-label="تصفية حسب حالة الحساب"
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0B1A33]"
              >
                <option value="all">كل حالات الحساب</option>
                <option value="active">نشط</option>
                <option value="pending_approval">بانتظار الاعتماد</option>
                <option value="pending">قيد الانتظار</option>
                <option value="suspended">موقوف</option>
              </select>
            </div>
          </div>

      {/* Couriers Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 text-[#FF7B00] animate-spin" />
            <span className="text-sm">جاري تحميل بيانات المناديب...</span>
          </div>
        ) : couriers.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm font-bold text-[#0A192F]">
              لا يوجد مناديب مسجلون حالياً
            </div>
            <p className="text-xs text-slate-500">
              أضف أول مندوب ليتمكن محرك التوزيع التلقائي من تعيين الطلبات له
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FF7B00] text-white text-xs font-bold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة مندوب</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">اسم المندوب</th>
                  <th className="py-3 px-4 whitespace-nowrap">رقم الهاتف</th>
                  <th className="py-3 px-4 whitespace-nowrap">المناطق</th>
                  <th className="py-3 px-4 whitespace-nowrap">حالة الاتصال</th>
                  <th className="py-3 px-4 whitespace-nowrap">الطلبات النشطة</th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    رصيد الكاش (الحد {cashLimits.dailyLimit}/{cashLimits.maxLimit})
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">العهدة المتبقية</th>
                  <th className="py-3 px-4 whitespace-nowrap">بيانات البنك / المحفظة</th>
                  <th className="py-3 px-4 whitespace-nowrap">المستندات</th>
                  <th className="py-3 px-4 whitespace-nowrap">حالة الحساب</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {couriers.map((courier) => {
                  const isOnline = courier.status === 'online';
                  const isForcedOnline = courier.force_online === true;
                  const cashSt = cashStatusMap.get(courier.id);
                  const cashBal = cashSt?.cashBalance ?? 0;
                  return (
                    <tr key={courier.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-bold text-[#0A192F] whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>{courier.profiles?.full_name || 'مندوب'}</span>
                          {isForcedOnline && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-50 border border-orange-200 text-[#FF7F00] text-[11px] font-bold whitespace-nowrap">
                              <Zap className="w-3 h-3 shrink-0" />
                              <span>مُفعل قسرياً</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap text-right"
                        dir="ltr"
                      >
                        {courier.profiles?.phone || '—'}
                      </td>
                      <td className="py-3 px-4 min-w-[160px]">
                        {(() => {
                          const assignedIds = courierZonesMap.get(courier.id) || [];
                          if (assignedIds.length === 0) {
                            return (
                              <span className="text-xs text-slate-400">
                                غير محدد
                              </span>
                            );
                          }
                          return (
                            <div className="flex flex-wrap gap-1">
                              {assignedIds.map((zId) => {
                                const zone = zonesMap.get(zId);
                                const label = zone ? getZoneLabel(zone) : zId;
                                return (
                                  <span
                                    key={zId}
                                    className="inline-block px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[#0A192F] text-[11px] font-semibold whitespace-nowrap"
                                  >
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isOnline}
                            disabled={togglingId === courier.id}
                            onClick={() => handleToggleStatus(courier)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                              isOnline ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                                isOnline ? '-translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <span
                            className={`text-xs font-bold ${
                              isOnline ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {isOnline ? 'متصل (Online)' : 'غير متصل (Offline)'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-bold text-[#0A192F] whitespace-nowrap">
                        {dynamicActiveOrdersMap.get(courier.id) ?? 0} / 2
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div
                          className={`font-mono tabular-nums font-bold ${
                            cashSt?.maxLimitBlocked
                              ? 'text-red-700'
                              : cashSt?.dailyLimitBlocked
                              ? 'text-red-600'
                              : cashSt?.dailyLimitGraceToday
                              ? 'text-[#FF7B00]'
                              : 'text-[#0A192F]'
                          }`}
                        >
                          {cashBal.toFixed(2)} ج.م
                        </div>
                        {cashSt?.maxLimitBlocked ? (
                          <div className="text-[11px] font-bold text-red-600">
                            موقوف — تجاوز الحد الأقصى
                          </div>
                        ) : cashSt?.dailyLimitBlocked ? (
                          <div className="text-[11px] font-bold text-red-600">
                            مغلق — تجاوز الحد اليومي
                          </div>
                        ) : cashSt?.dailyLimitGraceToday ? (
                          <div className="text-[11px] font-bold text-[#FF7B00]">
                            تجاوز اليومي (مهلة اليوم)
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-700">
                            ضمن الحد المسموح
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums font-bold whitespace-nowrap">
                        <span
                          className={
                            (custodyMap.get(courier.id)?.remaining ?? 0) > 0
                              ? 'text-[#FF7F00]'
                              : 'text-emerald-700'
                          }
                        >
                          {(custodyMap.get(courier.id)?.remaining ?? 0).toFixed(2)} ج.م
                        </span>
                        {(custodyMap.get(courier.id)?.penalties ?? 0) > 0 && (
                          <div className="text-[11px] font-sans font-semibold text-[#EF2323]">
                            جزاءات مخصومة:{' '}
                            <span className="font-mono tabular-nums">
                              {(custodyMap.get(courier.id)?.penalties ?? 0).toFixed(2)}
                            </span>{' '}
                            ج.م
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div>{courier.bank_account_details || '—'}</div>
                        {courier.wallet_number && (
                          <div className="font-mono tabular-nums text-slate-400">
                            {courier.wallet_number}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-3">
                          {courier.national_id_url ? (
                            <a
                              href={courier.national_id_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#0A192F] hover:text-[#FF7B00] font-semibold"
                            >
                              <span>البطاقة</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-400">لا توجد بطاقة</span>
                          )}
                          <span className="text-slate-300">·</span>
                          {courier.license_url ? (
                            <a
                              href={courier.license_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#0A192F] hover:text-[#FF7B00] font-semibold"
                            >
                              <span>الرخصة</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-400">لا توجد رخصة</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-xs font-bold">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              courier.account_status === 'active'
                                ? 'text-emerald-700'
                                : courier.account_status === 'suspended'
                                ? 'text-red-700'
                                : 'text-amber-700'
                            }
                          >
                            {courier.account_status === 'active'
                              ? 'نشط'
                              : courier.account_status === 'suspended'
                              ? 'موقوف'
                              : courier.account_status}
                          </span>
                          {isForcedOnline ? (
                            <button
                              type="button"
                              disabled={forcingId === courier.id}
                              onClick={() => handleToggleForceOnline(courier, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-[#0B1A33] text-xs font-bold cursor-pointer whitespace-nowrap"
                            >
                              {forcingId === courier.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <PowerOff className="w-3.5 h-3.5 text-[#EF2323]" />
                              )}
                              <span>إلغاء التفعيل</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={forcingId === courier.id}
                              onClick={() => handleToggleForceOnline(courier, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0B1A33] hover:bg-[#FF7F00] disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              {forcingId === courier.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Zap className="w-3.5 h-3.5 text-[#FF7F00]" />
                              )}
                              <span>تفعيل قسري</span>
                            </button>
                          )}
                          {(cashSt?.maxLimitBlocked || cashSt?.dailyLimitBlocked) && (
                            <button
                              type="button"
                              onClick={() => {
                                setDepositCourierId(courier.id);
                                setDepositModalOpen(true);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-[#FF7F00] text-white text-xs font-bold cursor-pointer"
                            >
                              توريد
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setPenaltyCourierId(courier.id);
                              setPenaltyModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-[#EF2323] text-xs font-bold cursor-pointer"
                          >
                            جزاء
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(courier)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[#0B1A33] text-xs font-bold cursor-pointer whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3 text-[#FF7F00]" />
                            <span>تعديل</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setStatementCourierId(courier.id);
                              setActiveTab('statement');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-[#0B1A33] text-xs font-bold cursor-pointer"
                          >
                            كشف حساب
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
        {!loading && totalCouriersCount > 0 && (
          <PaginationBar
            currentPage={currentPage}
            pageSize={PAGE_SIZE}
            totalCount={totalCouriersCount}
            loading={loading}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
        </>
      )}

      <RecordDepositModal
        open={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        couriers={custodySummaries}
        commissionPct={commissionPct}
        initialCourierId={depositCourierId}
        onSaved={(msg) => {
          setFeedback({ type: 'success', text: msg });
          loadCouriers();
        }}
      />

      <RecordPenaltyModal
        open={penaltyModalOpen}
        onClose={() => setPenaltyModalOpen(false)}
        couriers={
          allCouriersForDropdown.length > 0 ? allCouriersForDropdown : couriers
        }
        initialCourierId={penaltyCourierId}
        onSaved={(msg) => {
          setFeedback({ type: 'success', text: msg });
          invalidateSummaryCache();
          loadCouriers();
        }}
      />

      {/* Add Courier Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-[#0A192F]">إضافة مندوب توصيل جديد</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCourier} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الاسم الكامل
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="أحمد محمود"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010XXXXXXXX"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    البريد الإلكتروني
                  </label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="courier@hatly.app"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    كلمة المرور
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    تفاصيل الحساب البنكي (bank_account_details)
                  </label>
                  <input
                    type="text"
                    value={bankDetails}
                    onChange={(e) => setBankDetails(e.target.value)}
                    placeholder="البنك الأهلي - رقم الحساب / IBAN"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رقم المحفظة الإلكترونية
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={walletNumber}
                    onChange={(e) => setWalletNumber(e.target.value)}
                    placeholder="010XXXXXXXX"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left font-mono"
                  />
                </div>
              </div>

              <ZonesMultiSelectDropdown
                zones={zones}
                selectedZoneIds={selectedZoneIds}
                onChange={setSelectedZoneIds}
                label="مناطق التوزيع"
                placeholder="اختر مناطق التوزيع التي يخدمها المندوب..."
              />

              <div className="grid sm:grid-cols-2 gap-4 pt-2">
                <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
                  <FileUp className="w-5 h-5 text-[#FF7B00]" />
                  <span className="text-xs font-bold text-[#0A192F]">
                    صورة البطاقة الشخصية
                  </span>
                  <span className="text-[11px] text-slate-500 truncate max-w-full">
                    {nationalIdFile ? nationalIdFile.name : 'رفع إلى courier_documents'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setNationalIdFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>

                <label className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-center">
                  <FileUp className="w-5 h-5 text-[#0A192F]" />
                  <span className="text-xs font-bold text-[#0A192F]">
                    صورة رخصة القيادة / المركبة
                  </span>
                  <span className="text-[11px] text-slate-500 truncate max-w-full">
                    {licenseFile ? licenseFile.name : 'رفع إلى courier_documents'}
                  </span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setLicenseFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
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
                  <span>تسجيل المندوب وتفعيله</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Courier Modal */}
      {editingCourier && (
        <div className="fixed inset-0 z-50 bg-[#0A192F]/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-[#0A192F]">
                  تعديل بيانات المندوب ومناطق التوزيع
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingCourier.profiles?.full_name || 'مندوب'}
                </p>
              </div>
              <button
                type="button"
                disabled={editSubmitting}
                onClick={() => setEditingCourier(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editFormError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editFormError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateCourier} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الاسم الكامل
                  </label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    type="tel"
                    required
                    dir="ltr"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    تفاصيل الحساب البنكي
                  </label>
                  <input
                    type="text"
                    value={editBankDetails}
                    onChange={(e) => setEditBankDetails(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رقم المحفظة الإلكترونية
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editWalletNumber}
                    onChange={(e) => setEditWalletNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-left font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  حالة الحساب
                </label>
                <select
                  value={editAccountStatus}
                  onChange={(e) =>
                    setEditAccountStatus(e.target.value as AccountStatus)
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-[#0A192F]"
                >
                  <option value="active">نشط</option>
                  <option value="pending_approval">بانتظار الاعتماد</option>
                  <option value="pending">قيد الانتظار</option>
                  <option value="suspended">موقوف</option>
                </select>
              </div>

              <ZonesMultiSelectDropdown
                zones={zones}
                selectedZoneIds={editZoneIds}
                onChange={setEditZoneIds}
                label="مناطق التوزيع"
                placeholder="اختر مناطق التوزيع التي يخدمها المندوب..."
              />

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={editSubmitting}
                  onClick={() => setEditingCourier(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#0A192F] hover:bg-[#112240] disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
                >
                  {editSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>حفظ التعديلات</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

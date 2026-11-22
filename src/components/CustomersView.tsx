import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Eye,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Customer, Profile } from '../types/database';
import { CustomerDetailsModal } from './CustomerDetailsModal';
import { PaginationBar } from './PaginationBar';

const PAGE_SIZE = 20;

function sanitizePostgrestSearch(raw: string): string {
  return raw.replace(/[,()*%]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatWhatsAppPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `2${digits}`;
  return `2${digits}`;
}

function buildWhatsAppMessage(
  customerName: string,
  customMessage: string
): string {
  const name = customerName.trim() || 'عميل هاتلي';
  const trimmed = customMessage.trim();
  if (trimmed) {
    return `مرحباً ${name}، ${trimmed}`;
  }
  return `مرحباً ${name}، لدينا عروض جديدة في هاتلي!`;
}

function unwrapProfile(
  val: Profile | Profile[] | null | undefined
): Profile | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}

export function CustomersView() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [totalCustomersCount, setTotalCustomersCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setFetchError(null);

    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const safeQ = sanitizePostgrestSearch(debouncedSearch);

      // Resolve matching profile IDs when searching by name, phone, or email
      let matchingProfileIds: string[] = [];
      if (safeQ) {
        const profSearchRes = await supabase
          .from('profiles')
          .select('id')
          .or(
            `full_name.ilike.%${safeQ}%,phone.ilike.%${safeQ}%,email.ilike.%${safeQ}%`
          );

        if (profSearchRes.error) {
          throw new Error(profSearchRes.error.message);
        }

        matchingProfileIds = (
          (profSearchRes.data as { id: string }[] | null) || []
        ).map((p) => p.id);

        if (matchingProfileIds.length === 0) {
          setCustomers([]);
          setTotalCustomersCount(0);
          setLoading(false);
          return;
        }
      }

      let query = supabase
        .from('customers')
        .select('*, profiles(*)', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (safeQ && matchingProfileIds.length > 0) {
        query = query.in('profile_id', matchingProfileIds);
      }

      const custRes = await query.range(from, to);

      let loadedRows: Customer[] = [];
      let totalCount = 0;

      if (!custRes.error && custRes.data) {
        loadedRows = (
          custRes.data as Array<
            Customer & { profiles?: Profile | Profile[] | null }
          >
        ).map((row) => ({
          ...row,
          profiles: unwrapProfile(row.profiles),
        }));
        totalCount = custRes.count ?? loadedRows.length;
      } else {
        // Fallback if embedded FK join syntax fails — query customers + profiles separately
        let fbQuery = supabase
          .from('customers')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false });

        if (safeQ && matchingProfileIds.length > 0) {
          fbQuery = fbQuery.in('profile_id', matchingProfileIds);
        }

        const fbRes = await fbQuery.range(from, to);
        if (fbRes.error) {
          throw new Error(fbRes.error.message);
        }

        loadedRows = (fbRes.data as Customer[] | null) || [];
        totalCount = fbRes.count ?? loadedRows.length;
      }

      // Ensure profiles are populated even if RLS or missing FK left profiles null
      const missingProfileIds = Array.from(
        new Set(
          loadedRows
            .filter((c) => !c.profiles && c.profile_id)
            .map((c) => c.profile_id)
        )
      );

      if (missingProfileIds.length > 0) {
        const profRes = await supabase
          .from('profiles')
          .select('*')
          .in('id', missingProfileIds);

        if (!profRes.error && profRes.data) {
          const profMap = new Map<string, Profile>();
          (profRes.data as Profile[]).forEach((p) => {
            profMap.set(p.id, p);
          });
          loadedRows = loadedRows.map((c) => ({
            ...c,
            profiles: c.profiles || profMap.get(c.profile_id) || null,
          }));
        }
      }

      setCustomers(loadedRows);
      setTotalCustomersCount(totalCount);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'تعذر تحميل قائمة العملاء';
      const isRls =
        /permission denied|row-level security|42501|rls|not authorized/i.test(
          msg
        );
      setFetchError(
        isRls
          ? `تعذر قراءة بيانات العملاء أو الملفات الشخصية بسبب صلاحيات الأمان (RLS). يرجى تطبيق سياسات قراءة المدير من ملف supabase/migrations/20261120_admin_rls_policies.sql. (${msg})`
          : `حدث خطأ أثناء تحميل العملاء: ${msg}`
      );
      setCustomers([]);
      setTotalCustomersCount(0);
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedSearch]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const previewMessage = useMemo(
    () => buildWhatsAppMessage('[اسم العميل]', customMessage),
    [customMessage]
  );

  return (
    <div dir="rtl" className="space-y-5">
      {/* Header & Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0B1A33] text-[#FF7F00] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#0B1A33]">
              سجل العملاء ({totalCustomersCount})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              عرض كافة العملاء المسجلين، تفاصيلهم، وسجل طلباتهم مع التسويق عبر
              واتساب
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[230px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف..."
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00]"
            />
          </div>
          <button
            type="button"
            onClick={loadCustomers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {fetchError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 p-4 rounded-xl bg-red-50 border border-red-200 text-[#EF2323] text-xs font-semibold"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{fetchError}</span>
        </div>
      )}

      {/* WhatsApp Marketing Custom Message Composer */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="customer-whatsapp-message"
            className="inline-flex items-center gap-2 text-xs font-bold text-[#0B1A33]"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
              <MessageCircle className="w-4 h-4" />
            </div>
            <span>رسالة التسويق عبر واتساب</span>
          </label>

          {customMessage.trim() && (
            <button
              type="button"
              onClick={() => setCustomMessage('')}
              className="text-xs font-semibold text-slate-500 hover:text-[#EF2323] cursor-pointer"
            >
              مسح النص
            </button>
          )}
        </div>

        <textarea
          id="customer-whatsapp-message"
          rows={2}
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          placeholder="اكتب هنا الرسالة الإعلانية أو العرض المخصص لإرساله للعملاء عبر واتساب..."
          className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-[#0B1A33] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00] resize-y"
        />

        <div className="px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2">
          <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold text-[#0B1A33]">معاينة الرسالة: </span>
            <span className="text-slate-700 whitespace-pre-wrap">
              {previewMessage}
            </span>
          </div>
        </div>
      </div>

      {/* Customers Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
            <span className="text-sm">جاري تحميل العملاء...</span>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            {debouncedSearch
              ? 'لا يوجد عملاء مسجلون مطابقون للبحث'
              : 'لا يوجد عملاء مسجلون حتى الآن'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">اسم العميل</th>
                  <th className="py-3 px-4 whitespace-nowrap">رقم الهاتف</th>
                  <th className="py-3 px-4 whitespace-nowrap">تاريخ الانضمام</th>
                  <th className="py-3 px-4 whitespace-nowrap">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {customers.map((c) => {
                  const customerName =
                    c.profiles?.full_name?.trim() || 'عميل هاتلي';
                  const rawPhone = c.profiles?.phone?.trim() || '';
                  const waPhone = formatWhatsAppPhone(rawPhone);
                  const waMessage = buildWhatsAppMessage(
                    customerName,
                    customMessage
                  );
                  const waHref = waPhone
                    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(
                        waMessage
                      )}`
                    : null;

                  const joinDateRaw =
                    c.created_at || c.profiles?.created_at || '';
                  const joinDateDisplay = joinDateRaw
                    ? new Date(joinDateRaw).toLocaleDateString('ar-EG', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : '—';

                  return (
                    <tr
                      key={c.id}
                      onClick={() => setSelectedCustomer(c)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-[#0B1A33] whitespace-nowrap">
                        <div>{customerName}</div>
                        {c.profiles?.email && (
                          <div
                            className="text-xs font-normal text-slate-400 mt-0.5 text-right"
                            dir="ltr"
                          >
                            {c.profiles.email}
                          </div>
                        )}
                      </td>

                      <td
                        className="py-3 px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2.5 flex-row-reverse">
                          {waHref ? (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`إرسال رسالة واتساب إلى ${customerName}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>واتساب</span>
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400 text-xs font-semibold whitespace-nowrap shrink-0">
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>واتساب</span>
                            </span>
                          )}
                          <span
                            className="font-mono tabular-nums text-slate-700 text-right"
                            dir="ltr"
                          >
                            {rawPhone || '—'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {joinDateDisplay}
                      </td>

                      <td
                        className="py-3 px-4 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedCustomer(c)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B1A33] hover:bg-[#FF7F00] text-white text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>عرض التفاصيل</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && totalCustomersCount > 0 && (
          <PaginationBar
            currentPage={currentPage}
            pageSize={PAGE_SIZE}
            totalCount={totalCustomersCount}
            loading={loading}
            onPageChange={setCurrentPage}
          />
        )}
      </div>

      <CustomerDetailsModal
        open={Boolean(selectedCustomer)}
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
      />
    </div>
  );
}

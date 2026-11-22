import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Loader2,
  Mail,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  ShoppingBag,
  User,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Customer, Order, Profile } from '../types/database';

interface CustomerDetailsModalProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
}

const ORDER_STATUS_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  new: {
    label: 'جديد',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  assigned: {
    label: 'تم التعيين',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  picked_up: {
    label: 'تم الاستلام',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  in_transit: {
    label: 'قيد التوصيل',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  delivered: {
    label: 'تم التسليم',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  cancelled: {
    label: 'ملغي',
    badgeClass: 'bg-red-50 text-[#EF2323] border-red-200',
  },
  rejected: {
    label: 'مرفوض',
    badgeClass: 'bg-red-50 text-[#EF2323] border-red-200',
  },
};

function unwrapProfile(
  val: Profile | Profile[] | null | undefined
): Profile | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] ?? null : val;
}

export function CustomerDetailsModal({
  open,
  customer,
  onClose,
}: CustomerDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [resolvedCustomer, setResolvedCustomer] = useState<Customer | null>(
    customer
  );
  const [orders, setOrders] = useState<Order[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadCustomerDetails = useCallback(async () => {
    if (!customer) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Fetch fresh customer row joined with profiles
      let freshCustomer: Customer = customer;
      const custRes = await supabase
        .from('customers')
        .select('*, profiles(*)')
        .eq('id', customer.id)
        .maybeSingle();

      if (!custRes.error && custRes.data) {
        const raw = custRes.data as Customer & {
          profiles?: Profile | Profile[] | null;
        };
        freshCustomer = {
          ...raw,
          profiles: unwrapProfile(raw.profiles) || customer.profiles || null,
        };
      } else if (customer.profile_id) {
        const profRes = await supabase
          .from('profiles')
          .select('*')
          .eq('id', customer.profile_id)
          .maybeSingle();
        if (!profRes.error && profRes.data) {
          freshCustomer = {
            ...customer,
            profiles: profRes.data as Profile,
          };
        }
      }

      setResolvedCustomer(freshCustomer);

      // 2. Fetch all orders placed by this customer (by customer_id, profile_id, or phone)
      const filterParts = [`customer_id.eq.${freshCustomer.id}`];
      if (
        freshCustomer.profile_id &&
        freshCustomer.profile_id !== freshCustomer.id
      ) {
        filterParts.push(`customer_id.eq.${freshCustomer.profile_id}`);
      }
      const cleanPhone = freshCustomer.profiles?.phone?.trim();
      if (cleanPhone) {
        const safePhone = cleanPhone.replace(/[,()*%]/g, '').trim();
        if (safePhone) {
          filterParts.push(`customer_phone.eq.${safePhone}`);
        }
      }

      const ordRes = await supabase
        .from('orders')
        .select(
          'id, order_number, created_at, total, status, delivery_address, payment_method, service_type, customer_id, customer_phone'
        )
        .or(filterParts.join(','))
        .order('created_at', { ascending: false });

      if (ordRes.error) {
        setErrorMsg(`تعذر تحميل سجل طلبات العميل: ${ordRes.error.message}`);
        setOrders([]);
      } else {
        setOrders((ordRes.data as Order[]) || []);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل بيانات العميل'
      );
    } finally {
      setLoading(false);
    }
  }, [customer]);

  useEffect(() => {
    if (open && customer) {
      setResolvedCustomer(customer);
      setOrders([]);
      loadCustomerDetails();
    }
  }, [open, customer, loadCustomerDetails]);

  const activeCustomer = resolvedCustomer || customer;

  const customerName =
    activeCustomer?.profiles?.full_name?.trim() || 'عميل هاتلي';
  const customerPhone = activeCustomer?.profiles?.phone?.trim() || '—';
  const customerEmail = activeCustomer?.profiles?.email?.trim() || '—';
  const joinDateRaw =
    activeCustomer?.created_at || activeCustomer?.profiles?.created_at || '';
  const joinDateText = joinDateRaw
    ? new Date(joinDateRaw).toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  const customerAddress = useMemo(() => {
    const direct =
      activeCustomer?.address ||
      activeCustomer?.default_address ||
      activeCustomer?.delivery_address ||
      activeCustomer?.profiles?.address;
    if (direct && direct.trim()) return direct.trim();

    const orderWithAddress = orders.find(
      (o) => o.delivery_address && o.delivery_address.trim()
    );
    if (orderWithAddress?.delivery_address) {
      return orderWithAddress.delivery_address.trim();
    }

    return activeCustomer?.city?.trim() || 'غير مسجل';
  }, [activeCustomer, orders]);

  const orderStats = useMemo(() => {
    let deliveredCount = 0;
    let totalSpent = 0;
    for (const o of orders) {
      const st = String(o.status || '').toLowerCase();
      if (st === 'delivered') {
        deliveredCount += 1;
        totalSpent += Number(o.total || 0);
      }
    }
    return {
      totalCount: orders.length,
      deliveredCount,
      totalSpent,
    };
  }, [orders]);

  if (!open || !activeCustomer) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 bg-[#0B1A33]/60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-details-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-[#0B1A33] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FF7F00] text-white flex items-center justify-center shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 id="customer-details-title" className="text-base font-bold">
                تفاصيل العميل — {customerName}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                بيانات التواصل والعنوان وسجل الطلبات الكامل
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadCustomerDetails}
              disabled={loading}
              title="تحديث البيانات"
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-[#EF2323] text-xs font-semibold"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Customer Info Section */}
          <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0B1A33]">
              <User className="w-4 h-4 text-[#FF7F00]" />
              <span>بيانات العميل</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                <div className="text-xs text-slate-500">الاسم</div>
                <div className="font-bold text-[#0B1A33]">{customerName}</div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-[#FF7F00]" />
                  <span>رقم الهاتف</span>
                </div>
                <div
                  className="font-mono tabular-nums font-bold text-[#0B1A33] text-right"
                  dir="ltr"
                >
                  {customerPhone}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1 sm:col-span-2">
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-[#FF7F00]" />
                  <span>العنوان</span>
                </div>
                <div className="font-semibold text-[#0B1A33] leading-relaxed">
                  {customerAddress}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>البريد الإلكتروني</span>
                </div>
                <div
                  className="font-mono text-xs text-slate-700 text-right truncate"
                  dir="ltr"
                >
                  {customerEmail}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-1">
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>تاريخ الانضمام</span>
                </div>
                <div className="font-semibold text-xs text-[#0B1A33]">
                  {joinDateText}
                </div>
              </div>
            </div>
          </section>

          {/* Summary Strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
              <div className="text-xs text-slate-500">إجمالي الطلبات</div>
              <div className="text-lg font-extrabold font-mono tabular-nums text-[#0B1A33] mt-1">
                {orderStats.totalCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
              <div className="text-xs text-slate-500">طلبات مكتملة</div>
              <div className="text-lg font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
                {orderStats.deliveredCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-center">
              <div className="text-xs text-slate-500">إجمالي المشتريات</div>
              <div className="text-lg font-extrabold font-mono tabular-nums text-[#FF7F00] mt-1">
                {orderStats.totalSpent.toFixed(2)} ج.م
              </div>
            </div>
          </div>

          {/* Order History Section */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B1A33]">
                <ShoppingBag className="w-4 h-4 text-[#FF7F00]" />
                <span>سجل الطلبات ({orders.length})</span>
              </div>
            </div>

            {loading ? (
              <div className="p-8 flex flex-col items-center justify-center gap-2.5 text-slate-500">
                <Loader2 className="w-6 h-6 text-[#FF7F00] animate-spin" />
                <span className="text-xs font-semibold">
                  جاري تحميل سجل طلبات العميل...
                </span>
              </div>
            ) : orders.length === 0 ? (
              <div className="p-8 flex flex-col items-center justify-center gap-2 text-slate-400">
                <Package className="w-8 h-8 text-slate-300" />
                <span className="text-sm font-semibold text-slate-500">
                  لا توجد طلبات مسجلة لهذا العميل حتى الآن
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-xs font-bold text-slate-600">
                      <th className="py-2.5 px-4 whitespace-nowrap">رقم الطلب</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">التاريخ</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">الإجمالي</th>
                      <th className="py-2.5 px-4 whitespace-nowrap">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {orders.map((order) => {
                      const statusMeta = ORDER_STATUS_META[order.status] || {
                        label: order.status || 'غير محدد',
                        badgeClass:
                          'bg-slate-100 text-slate-700 border-slate-200',
                      };
                      const orderDate = order.created_at
                        ? new Date(order.created_at).toLocaleString('ar-EG', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—';

                      return (
                        <tr key={order.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#0B1A33] whitespace-nowrap">
                            #{order.order_number || order.id.slice(0, 8)}
                          </td>
                          <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                            {orderDate}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-[#FF7F00] whitespace-nowrap">
                            {Number(order.total || 0).toFixed(2)} ج.م
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-xs font-bold ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-[#0B1A33] hover:bg-[#13294E] text-white text-xs font-bold cursor-pointer transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Lock,
  PackageCheck,
  Phone,
  ShieldCheck,
  Store,
  Truck,
  User,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type {
  CustomDeliveryPricing,
  DeliveryPricing,
  Merchant,
  OrderServiceType,
  PaymentMethod,
  PaymentStatus,
  Zone,
} from '../types/database';
import { LeafletLocationPicker } from './LeafletLocationPicker';
import {
  MINYA_CENTERS,
  findNearestCenter,
  matchCenterToZone,
  type NearestCenterResult,
} from '../utils/haversine';
import { triggerAutoDispatch } from '../utils/autoDispatch';
import {
  calculateCommissionSplit,
  fetchCourierCommissionPct,
} from '../utils/commissions';
import {
  isMerchantOperational,
  isMerchantSubscriptionExpired,
  syncExpiredMerchants,
} from '../utils/subscriptions';
import { invalidateSummaryCache } from '../utils/summaryCache';

interface NewOrderFormProps {
  onOrderCreated: () => void;
}

export function NewOrderForm({ onOrderCreated }: NewOrderFormProps) {
  const { role, merchantRecord } = useAuth();
  const isMerchantUser = role === 'merchant' && Boolean(merchantRecord?.id);

  const [serviceType, setServiceType] = useState<OrderServiceType>('brand');
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [brandPricingRows, setBrandPricingRows] = useState<DeliveryPricing[]>([]);
  const [customPricingRows, setCustomPricingRows] = useState<CustomDeliveryPricing[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  // Brand selection
  const [selectedMerchantId, setSelectedMerchantId] = useState<string>('');

  // Custom pickup fields
  const [customFromZoneId, setCustomFromZoneId] = useState<string>('');
  const [pickupDetails, setPickupDetails] = useState<string>('');
  const [pickupPhone, setPickupPhone] = useState<string>('');
  const [customFee, setCustomFee] = useState<number>(0);

  // Large Order
  const [isLargeOrder, setIsLargeOrder] = useState<boolean>(false);
  const [requiredCouriers, setRequiredCouriers] = useState<number>(2);
  const [commissionPct, setCommissionPct] = useState<number>(70);

  // Customer & Dropoff
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [customerNotes, setCustomerNotes] = useState<string>('');

  // Map & Haversine
  const [latitude, setLatitude] = useState<number>(MINYA_CENTERS[0].lat);
  const [longitude, setLongitude] = useState<number>(MINYA_CENTERS[0].lng);
  const [nearestCenter, setNearestCenter] = useState<NearestCenterResult>(() =>
    findNearestCenter(MINYA_CENTERS[0].lat, MINYA_CENTERS[0].lng)
  );
  const [toZoneId, setToZoneId] = useState<string>('');

  // Financials & Courier Pays
  const [courierPays, setCourierPays] = useState<boolean>(false);
  const [productsTotal, setProductsTotal] = useState<number>(0);
  const [amountToCollect, setAmountToCollect] = useState<number>(0);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid');
  const [cardNumber, setCardNumber] = useState<string>('');
  const [cardHolder, setCardHolder] = useState<string>('');
  const [cardExpiry, setCardExpiry] = useState<string>('');
  const [cardCvv, setCardCvv] = useState<string>('');
  const [processingCard, setProcessingCard] = useState<boolean>(false);

  // Confirmation / Payment Summary step visibility (hides fees & total until confirming)
  const [showPaymentSummary, setShowPaymentSummary] = useState<boolean>(false);

  // Submission status
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitBanner, setSubmitBanner] = useState<{
    type: 'success' | 'warning';
    orderNumber: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadReferenceData() {
      setLoadingRefs(true);
      const [merchRes, zoneRes, brandPriceRes, customPriceRes, pct] = await Promise.all([
        supabase
          .from('merchants')
          .select('*')
          .eq('account_status', 'active')
          .order('created_at', { ascending: false }),
        supabase
          .from('zones')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase.from('delivery_pricing').select('*'),
        supabase.from('custom_delivery_pricing').select('*'),
        fetchCourierCommissionPct(),
      ]);

      console.log('[Hatly NewOrderForm] zones:', zoneRes.data, zoneRes.error);
      console.log('[Hatly NewOrderForm] delivery_pricing:', brandPriceRes.data, brandPriceRes.error);
      console.log('[Hatly NewOrderForm] custom_delivery_pricing:', customPriceRes.data, customPriceRes.error);

      if (!active) return;

      const rawMerchants = (merchRes.data as Merchant[]) || [];
      const syncedMerchants = await syncExpiredMerchants(rawMerchants);
      const loadedMerchants = syncedMerchants.filter((m) =>
        isMerchantOperational(m)
      );
      const loadedZones = (zoneRes.data as Zone[]) || [];

      if (!active) return;

      setMerchants(loadedMerchants);
      setZones(loadedZones);
      setBrandPricingRows((brandPriceRes.data as DeliveryPricing[]) || []);
      setCustomPricingRows((customPriceRes.data as CustomDeliveryPricing[]) || []);
      setCommissionPct(pct);

      if (isMerchantUser && merchantRecord) {
        setSelectedMerchantId(merchantRecord.id);
      } else if (loadedMerchants.length > 0) {
        setSelectedMerchantId(loadedMerchants[0].id);
      }

      if (loadedZones.length > 0) {
        setCustomFromZoneId(loadedZones[0].id);
        const matched = matchCenterToZone(nearestCenter.center, loadedZones);
        if (matched) {
          setToZoneId(matched.id);
        } else {
          setToZoneId(loadedZones[0].id);
        }
      }

      setLoadingRefs(false);
    }

    loadReferenceData();
    return () => {
      active = false;
    };
  }, [isMerchantUser, merchantRecord]);

  const activeMerchant = useMemo(
    () => merchants.find((m) => m.id === selectedMerchantId) || null,
    [merchants, selectedMerchantId]
  );

  const fromZoneId = useMemo(() => {
    if (serviceType === 'brand') {
      return activeMerchant?.zone_id || zones[0]?.id || '';
    }
    return customFromZoneId;
  }, [serviceType, activeMerchant, customFromZoneId, zones]);

  const handleMapChange = (
    lat: number,
    lng: number,
    nearest: NearestCenterResult
  ) => {
    setLatitude(lat);
    setLongitude(lng);
    setNearestCenter(nearest);

    const matched = matchCenterToZone(nearest.center, zones);
    if (matched) {
      setToZoneId(matched.id);
    }
  };

  const round2 = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  };

  // Compute Pricing in background from Supabase tables (`delivery_pricing` / `custom_delivery_pricing`)
  const pricingBreakdown = useMemo(() => {
    if (serviceType === 'brand') {
      const match =
        brandPricingRows.find(
          (row) =>
            (row.from_zone_id === fromZoneId && row.to_zone_id === toZoneId) ||
            (row.zone_id && row.zone_id === toZoneId)
        ) ||
        brandPricingRows.find((row) => row.to_zone_id === toZoneId) ||
        brandPricingRows[0];

      const rawBaseFee = Number(
        match?.delivery_fee_base ?? match?.base_fee ?? match?.price ?? 25
      );
      const rawDiscount = Number(
        activeMerchant?.partner_discount ?? match?.partner_discount ?? 0
      );

      const baseFee = round2(
        Math.max(0, Number.isFinite(rawBaseFee) ? rawBaseFee : 25)
      );
      // Clamp partner_discount so 0 <= partner_discount <= delivery_fee_base
      // and delivery_fee_net = delivery_fee_base - partner_discount always holds
      const discount = round2(
        Math.min(
          Math.max(0, Number.isFinite(rawDiscount) ? rawDiscount : 0),
          baseFee
        )
      );
      const netFee = round2(baseFee - discount);

      return {
        deliveryFeeBase: baseFee,
        partnerDiscount: discount,
        deliveryFeeNet: netFee,
        customFeeValue: 0,
      };
    } else {
      const match =
        customPricingRows.find(
          (row) =>
            row.from_zone_id === fromZoneId && row.to_zone_id === toZoneId
        ) ||
        customPricingRows.find((row) => row.to_zone_id === toZoneId) ||
        customPricingRows[0];

      const rawBaseFee = Number(
        match?.price ?? match?.delivery_fee ?? match?.fee ?? 30
      );
      const baseFee = round2(
        Math.max(0, Number.isFinite(rawBaseFee) ? rawBaseFee : 30)
      );
      const extraCustom = round2(
        Math.max(0, Number.isFinite(Number(customFee)) ? Number(customFee) : 0)
      );

      return {
        deliveryFeeBase: baseFee,
        partnerDiscount: 0,
        deliveryFeeNet: baseFee,
        customFeeValue: extraCustom,
      };
    }
  }, [
    serviceType,
    brandPricingRows,
    customPricingRows,
    fromZoneId,
    toZoneId,
    activeMerchant,
    customFee,
  ]);

  const safeProductsTotal = round2(
    Math.max(0, Number.isFinite(Number(productsTotal)) ? Number(productsTotal) : 0)
  );
  const safeAmountToCollect = round2(
    Math.max(
      0,
      Number.isFinite(Number(amountToCollect)) ? Number(amountToCollect) : 0
    )
  );

  const itemAmount = courierPays ? safeAmountToCollect : safeProductsTotal;

  const totalDeliveryFee = round2(
    pricingBreakdown.deliveryFeeNet + pricingBreakdown.customFeeValue
  );

  const grandTotal = round2(itemAmount + totalDeliveryFee);

  const effectiveCouriersCount = isLargeOrder
    ? Math.max(2, Math.floor(requiredCouriers || 2))
    : 1;

  const liveCommissionSplit = calculateCommissionSplit(
    pricingBreakdown.deliveryFeeNet,
    commissionPct
  );
  const perCourierCommissionPreview = liveCommissionSplit.courierCommission;
  const totalCommissionHatlyPays = round2(
    perCourierCommissionPreview * effectiveCouriersCount
  );
  const netHatlyRevenueAfterLargeOrder = round2(
    pricingBreakdown.deliveryFeeNet - totalCommissionHatlyPays
  );

  const handlePayCardNow = async () => {
    setFormError(null);
    if (
      cardNumber.replace(/\s/g, '').length < 12 ||
      !cardHolder.trim() ||
      !cardExpiry.trim() ||
      cardCvv.trim().length < 3
    ) {
      setFormError('يرجى إدخال بيانات البطاقة البنكية كاملة لإتمام الدفع');
      return;
    }

    setProcessingCard(true);
    await new Promise((r) => setTimeout(r, 600));
    setProcessingCard(false);
    setPaymentStatus('paid');
  };

  const generateOrderNumber = () => {
    const num = Math.floor(1000 + Math.random() * 9000);
    return `HAT-${num}`;
  };

  const validateOrderInputs = (): boolean => {
    setFormError(null);

    if (!customerName.trim() || !customerPhone.trim() || !deliveryAddress.trim()) {
      setFormError('يرجى إدخال اسم العميل ورقم الهاتف وعنوان التوصيل');
      return false;
    }

    if (serviceType === 'brand' && !selectedMerchantId) {
      setFormError('يرجى اختيار البراند / المتجر النشط');
      return false;
    }

    if (serviceType === 'brand') {
      const targetMerchant =
        activeMerchant || (isMerchantUser ? merchantRecord : null);
      if (
        targetMerchant &&
        (targetMerchant.is_active === false ||
          isMerchantSubscriptionExpired(targetMerchant))
      ) {
        setFormError(
          'اشتراك هذا المتجر منتهي أو موقوف — يرجى تجديد الباقة قبل إنشاء طلبات جديدة'
        );
        return false;
      }
    }

    if (serviceType === 'custom' && !pickupPhone.trim()) {
      setFormError('يرجى إدخال رقم هاتف جهة الاستلام للطلب المخصوص');
      return false;
    }

    if (!courierPays && (!Number.isFinite(Number(productsTotal)) || Number(productsTotal) < 0)) {
      setFormError('يرجى إدخال قيمة منتجات صحيحة (0 أو أكثر)');
      return false;
    }

    if (courierPays && (!Number.isFinite(Number(amountToCollect)) || Number(amountToCollect) < 0)) {
      setFormError('يرجى إدخال المبلغ المطلوب دفعه بشكل صحيح (0 أو أكثر)');
      return false;
    }

    if (
      serviceType === 'custom' &&
      (!Number.isFinite(Number(customFee)) || Number(customFee) < 0)
    ) {
      setFormError('يرجى إدخال رسوم إضافية صحيحة (0 أو أكثر)');
      return false;
    }

    if (paymentMethod === 'card' && paymentStatus !== 'paid') {
      setFormError('يرجى الضغط على زر "دفع الآن" لتأكيد الدفع بالبطاقة قبل إرسال الطلب');
      return false;
    }

    return true;
  };

  const handleProceedToSummary = () => {
    setSubmitBanner(null);
    if (validateOrderInputs()) {
      setShowPaymentSummary(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitBanner(null);

    if (!showPaymentSummary) {
      handleProceedToSummary();
      return;
    }

    if (!validateOrderInputs()) {
      return;
    }

    setSubmitting(true);

    const orderNumber = generateOrderNumber();
    const combinedNotes =
      serviceType === 'custom' && pickupDetails.trim()
        ? `تفاصيل الاستلام: ${pickupDetails.trim()}${
            customerNotes.trim() ? ` | ملاحظات العميل: ${customerNotes.trim()}` : ''
          }`
        : customerNotes.trim() || null;

    const latestPct = await fetchCourierCommissionPct();
    setCommissionPct(latestPct);
    const { courierCommission: perCourierCommission } = calculateCommissionSplit(
      pricingBreakdown.deliveryFeeNet,
      latestPct
    );
    const totalOrderCouriersCommission = round2(
      perCourierCommission * effectiveCouriersCount
    );
    const netHatlyRevenue = round2(
      pricingBreakdown.deliveryFeeNet - totalOrderCouriersCommission
    );

    const orderSource = isMerchantUser ? 'merchant_portal' : 'admin';

    const payload = {
      order_number: orderNumber,
      customer_id: null,
      merchant_id: serviceType === 'brand' ? selectedMerchantId : null,
      courier_id: null,
      from_zone_id: fromZoneId || null,
      to_zone_id: toZoneId || null,
      products_total: courierPays ? 0 : safeProductsTotal,
      delivery_fee_base: pricingBreakdown.deliveryFeeBase,
      partner_discount: pricingBreakdown.partnerDiscount,
      delivery_fee_net: pricingBreakdown.deliveryFeeNet,
      total: grandTotal,
      delivery_address: deliveryAddress.trim(),
      customer_notes: combinedNotes,
      service_type: serviceType,
      order_source: orderSource,
      status: 'new',
      payment_method: paymentMethod,
      payment_status: paymentMethod === 'card' ? paymentStatus : 'unpaid',
      latitude,
      longitude,
      amount_to_collect: courierPays ? safeAmountToCollect : 0,
      pickup_phone: serviceType === 'custom' ? pickupPhone.trim() : null,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      custom_fee: serviceType === 'custom' ? pricingBreakdown.customFeeValue : 0,
      is_large_order: isLargeOrder,
      required_couriers: effectiveCouriersCount,
      courier_commission: totalOrderCouriersCommission,
      hatly_net_revenue: netHatlyRevenue,
    };

    const tryInsertOrder = async (candidate: typeof payload) => {
      let res = await supabase
        .from('orders')
        .insert(candidate)
        .select('id, order_number')
        .single();

      // If orders table does not yet have optional columns, retry cleanly without them
      if (
        res.error &&
        (res.error.code === '42703' ||
          res.error.code === 'PGRST204' ||
          res.error.message.includes('courier_commission') ||
          res.error.message.includes('hatly_net_revenue') ||
          res.error.message.includes('order_source'))
      ) {
        const msg = res.error.message || '';
        const {
          courier_commission: _cc,
          hatly_net_revenue: _hr,
          order_source: _os,
          ...rest
        } = candidate;
        const fallbackCandidate = msg.includes('order_source')
          ? rest
          : { ...rest, order_source: _os };
        res = await supabase
          .from('orders')
          .insert(fallbackCandidate)
          .select('id, order_number')
          .single();
      }
      return res;
    };

    const isMathConstraintError = (err: { code?: string; message?: string } | null) =>
      Boolean(
        err &&
          (err.code === '23514' ||
            err.message?.includes('chk_math'))
      );

    let { data: insertedOrder, error: insertError } = await tryInsertOrder(payload);

    // Handle database chk_math check constraint variants cleanly (e.g. courierPays where
    // total = products_total + delivery_fee_net, or customFee folded into delivery_fee_net)
    if (isMathConstraintError(insertError)) {
      const retryCandidates: Array<typeof payload> = [];

      if (courierPays && safeAmountToCollect > 0) {
        retryCandidates.push({
          ...payload,
          products_total: safeAmountToCollect,
          amount_to_collect: safeAmountToCollect,
        });
        retryCandidates.push({
          ...payload,
          products_total: safeAmountToCollect,
          amount_to_collect: 0,
        });
      }

      if (serviceType === 'custom' && pricingBreakdown.customFeeValue > 0) {
        const foldedBase = round2(
          pricingBreakdown.deliveryFeeBase + pricingBreakdown.customFeeValue
        );
        const foldedNet = round2(foldedBase - pricingBreakdown.partnerDiscount);
        const foldedNotes = `${
          combinedNotes ? `${combinedNotes} | ` : ''
        }رسوم إضافية للمخصوص: ${pricingBreakdown.customFeeValue.toFixed(2)} ج.م`;

        retryCandidates.push({
          ...payload,
          delivery_fee_base: foldedBase,
          delivery_fee_net: foldedNet,
          custom_fee: 0,
          customer_notes: foldedNotes,
          hatly_net_revenue: round2(foldedNet - totalOrderCouriersCommission),
        });

        if (courierPays && safeAmountToCollect > 0) {
          retryCandidates.push({
            ...payload,
            products_total: safeAmountToCollect,
            amount_to_collect: safeAmountToCollect,
            delivery_fee_base: foldedBase,
            delivery_fee_net: foldedNet,
            custom_fee: 0,
            customer_notes: foldedNotes,
            hatly_net_revenue: round2(foldedNet - totalOrderCouriersCommission),
          });
        }
      }

      for (const candidate of retryCandidates) {
        const retryRes = await tryInsertOrder(candidate);
        if (!retryRes.error && retryRes.data) {
          insertedOrder = retryRes.data;
          insertError = null;
          break;
        }
        insertError = retryRes.error;
        if (!isMathConstraintError(retryRes.error)) {
          break;
        }
      }
    }

    if (insertError || !insertedOrder) {
      setSubmitting(false);
      if (isMathConstraintError(insertError)) {
        setFormError(
          `خطأ في معادلة الحسابات بالطلب (${insertError?.message || 'chk_math'}) — تأكد من قيمة المنتجات (${safeProductsTotal})، رسوم التوصيل (${pricingBreakdown.deliveryFeeBase} - خصم ${pricingBreakdown.partnerDiscount} = ${pricingBreakdown.deliveryFeeNet})، والإجمالي (${grandTotal}).`
        );
      } else {
        setFormError(insertError?.message || 'حدث خطأ أثناء حفظ الطلب');
      }
      return;
    }

    // Trigger Auto-Dispatch Engine (assigns 1 or N couriers for Large Order)
    const dispatchResult = await triggerAutoDispatch(insertedOrder.id, {
      requiredCouriers: effectiveCouriersCount,
      deliveryFeeNet: pricingBreakdown.deliveryFeeNet,
      commissionPct: latestPct,
      paymentMethod,
      orderTotal: grandTotal,
      merchantId: serviceType === 'brand' ? selectedMerchantId : null,
      toZoneId: toZoneId || null,
    });
    setSubmitting(false);
    invalidateSummaryCache();

    setSubmitBanner({
      type: dispatchResult.assigned ? 'success' : 'warning',
      orderNumber: insertedOrder.order_number,
      message: dispatchResult.assigned
        ? `تم إنشاء الطلب ${insertedOrder.order_number} — ${dispatchResult.message}`
        : dispatchResult.merchantInactive
        ? `الطلب ${insertedOrder.order_number}: ${dispatchResult.message}`
        : `تم إنشاء الطلب ${insertedOrder.order_number} بحالة "جديد" — تنبيه: ${dispatchResult.message}`,
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Reset customer fields for rapid next entry
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setCustomerNotes('');
    setPickupDetails('');
    setPickupPhone('');
    setProductsTotal(0);
    setAmountToCollect(0);
    setCustomFee(0);
    setIsLargeOrder(false);
    setRequiredCouriers(2);
    setPaymentStatus('unpaid');
    setShowPaymentSummary(false);

    onOrderCreated();
  };

  const zoneLabel = (zone: Zone) =>
    zone.name_ar || zone.name || zone.zone_name || zone.title || zone.id;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-6xl mx-auto">
      {submitBanner && (
        <div
          role={submitBanner.type === 'warning' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-4 p-4 rounded-xl border ${
            submitBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          <div className="flex items-start gap-3">
            {submitBanner.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-bold text-sm">{submitBanner.message}</div>
              {submitBanner.type === 'warning' && (
                <p className="text-xs mt-1 text-amber-800">
                  يمكنك إعادة محاولة التوزيع التلقائي لاحقاً من جدول الطلبات عند توفر مندوب متصل.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSubmitBanner(null)}
            className="text-xs font-semibold underline shrink-0 cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="flex items-center gap-2.5 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="space-y-6">
        {/* 1. Customer Name & Phone */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-[#0A192F] border-b border-slate-100 pb-3">
            1. بيانات العميل
          </h3>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                اسم العميل
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="الاسم ثلاثي أو ثنائي"
                  className="w-full pr-9 pl-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                رقم هاتف العميل
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="010XXXXXXXX"
                  className="w-full pr-9 pl-3 py-2.5 rounded-lg border border-slate-200 text-sm text-left font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 2. Brand / Custom Toggle & Brand Selection */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm font-bold text-[#0A192F]">
                2. نوع الطلب ومصدر الاستلام
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                اختر طلب من براند أو أوردر مخصوص
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setServiceType('brand');
                  setShowPaymentSummary(false);
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  serviceType === 'brand'
                    ? 'bg-[#0A192F] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Store className="w-4 h-4" />
                <span>طلب من براند</span>
              </button>

              {!isMerchantUser && (
                <button
                  type="button"
                  onClick={() => {
                    setServiceType('custom');
                    setShowPaymentSummary(false);
                  }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    serviceType === 'custom'
                      ? 'bg-[#FF7B00] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>أوردر مخصوص</span>
                </button>
              )}
            </div>
          </div>

          {serviceType === 'brand' ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  اختر البراند النشط
                </label>
                <select
                  value={selectedMerchantId}
                  onChange={(e) => setSelectedMerchantId(e.target.value)}
                  disabled={loadingRefs || isMerchantUser}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                >
                  {merchants.length === 0 ? (
                    <option value="">لا توجد متاجر نشطة</option>
                  ) : (
                    merchants.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.store_name || m.name || m.email || m.id}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  منطقة المتجر (تلقائي)
                </label>
                <input
                  type="text"
                  readOnly
                  value={
                    zones.find((z) => z.id === fromZoneId)
                      ? zoneLabel(zones.find((z) => z.id === fromZoneId)!)
                      : fromZoneId || 'غير محددة'
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600"
                />
              </div>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  منطقة الاستلام
                </label>
                <select
                  value={customFromZoneId}
                  onChange={(e) => setCustomFromZoneId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                >
                  {zones.length === 0 ? (
                    <option value="">لا توجد مناطق</option>
                  ) : (
                    zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {zoneLabel(z)}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  رقم هاتف جهة الاستلام
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    dir="ltr"
                    value={pickupPhone}
                    onChange={(e) => setPickupPhone(e.target.value)}
                    placeholder="010XXXXXXXX"
                    className="w-full pr-9 pl-3 py-2.5 rounded-lg border border-slate-200 text-sm text-left font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  تفاصيل الاستلام
                </label>
                <input
                  type="text"
                  value={pickupDetails}
                  onChange={(e) => setPickupDetails(e.target.value)}
                  placeholder="مثال: استلام أوراق أو طرد من مكتبة أو صيدلية محددة..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>
            </div>
          )}

          {/* Large Order Toggle & Multi-Courier Config */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-[#0A192F]">أوردر كبير</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  تعيين أكثر من مندوب للطلب — يحصل كل مندوب على عمولته الكاملة وتتحمل هاتلي التكلفة الإضافية
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isLargeOrder}
                onClick={() => {
                  setIsLargeOrder((prev) => {
                    const next = !prev;
                    if (next && requiredCouriers < 2) {
                      setRequiredCouriers(2);
                    }
                    return next;
                  });
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  isLargeOrder ? 'bg-[#FF7B00]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    isLargeOrder ? '-translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {isLargeOrder && (
              <div className="p-4 rounded-xl bg-orange-50/50 border border-[#FF7B00]/30 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4 items-end">
                  <div>
                    <label
                      htmlFor="required-couriers-input"
                      className="block text-xs font-bold text-[#0A192F] mb-1.5"
                    >
                      عدد المندوبين
                    </label>
                    <input
                      id="required-couriers-input"
                      type="number"
                      min={2}
                      max={20}
                      value={requiredCouriers}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setRequiredCouriers(Number.isFinite(val) ? Math.max(2, val) : 2);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#FF7B00]/50 bg-white text-sm font-mono tabular-nums font-bold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                    />
                  </div>

                  <div className="p-3 rounded-lg bg-white border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>عمولة المندوب الواحد ({commissionPct}%):</span>
                      <strong className="font-mono tabular-nums text-[#0A192F]">
                        {perCourierCommissionPreview.toFixed(2)} ج.م
                      </strong>
                    </div>
                    <div className="flex items-center justify-between text-[#0A192F] font-bold">
                      <span>إجمالي العمولات المدفوعة من هاتلي ({effectiveCouriersCount} مناديب):</span>
                      <strong className="font-mono tabular-nums text-[#FF7B00]">
                        {totalCommissionHatlyPays.toFixed(2)} ج.م
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. Leaflet Map to select exact location (with detected zone display) */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-[#0A192F]">
                3. تحديد موقع التسليم على الخريطة
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                حرّك الدبوس أو اضغط على الخريطة ليتم تحديد المنطقة المستهدفة تلقائياً عبر Haversine
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                أقرب مركز (Haversine):{' '}
                <strong className="text-[#0A192F]">
                  {nearestCenter.center.nameAr}
                </strong>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                  منطقة التسليم:
                </label>
                <select
                  value={toZoneId}
                  onChange={(e) => setToZoneId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-[#0A192F] focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {zoneLabel(z)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <LeafletLocationPicker
            latitude={latitude}
            longitude={longitude}
            onChange={handleMapChange}
            heightClassName="h-80"
          />
        </div>

        {/* 4. Address Details (after dropping the pin) */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-[#0A192F] border-b border-slate-100 pb-3">
            4. تفاصيل العنوان
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                تفاصيل العنوان (الشارع، رقم العمارة، الدور، الشقة، علامة مميزة)
              </label>
              <input
                type="text"
                required
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="اكتب تفاصيل المبنى والعمارة والشقة بعد تحديد الموقع على الخريطة..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                ملاحظات إضافية للطلب
              </label>
              <textarea
                rows={2}
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
                placeholder="أي تعليمات خاصة للمندوب..."
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
              />
            </div>
          </div>
        </div>

        {/* 5. Payment details & Courier Pays toggle */}
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Courier Pays & Order Amount */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-[#0A192F] border-b border-slate-100 pb-3">
              5. تفاصيل المبلغ والمندوب يدفع
            </h3>

            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="text-sm font-bold text-[#0A192F]">المندوب يدفع</div>
                <div className="text-xs text-slate-500">
                  تفعيل إذا كان المندوب سيدفع مبلغاً عند الاستلام
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={courierPays}
                onClick={() => setCourierPays((prev) => !prev)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  courierPays ? 'bg-[#FF7B00]' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    courierPays ? '-translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {!courierPays ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  قيمة المنتجات (ج.م)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={productsTotal}
                  onChange={(e) => setProductsTotal(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-[#0A192F] mb-1.5">
                  المبلغ المطلوب دفعه (ج.م)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={amountToCollect}
                  onChange={(e) => setAmountToCollect(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#FF7B00]/50 bg-orange-50/40 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>
            )}

            {serviceType === 'custom' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  رسوم إضافية للأوردر المخصوص (ج.م)
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={customFee}
                  onChange={(e) => setCustomFee(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
                />
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-[#0A192F] border-b border-slate-100 pb-3">
              طريقة الدفع
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                  paymentMethod === 'cash'
                    ? 'border-[#0A192F] bg-slate-50 text-[#0A192F]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cash"
                  checked={paymentMethod === 'cash'}
                  onChange={() => {
                    setPaymentMethod('cash');
                    setPaymentStatus('unpaid');
                  }}
                  className="accent-[#FF7B00]"
                />
                <span className="text-sm font-bold">كاش</span>
              </label>

              <label
                className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                  paymentMethod === 'card'
                    ? 'border-[#0A192F] bg-slate-50 text-[#0A192F]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value="card"
                  checked={paymentMethod === 'card'}
                  onChange={() => setPaymentMethod('card')}
                  className="accent-[#FF7B00]"
                />
                <span className="text-sm font-bold">بطاقة بنكية</span>
              </label>
            </div>

            {paymentMethod === 'card' && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[#0A192F]">
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-[#FF7B00]" />
                    <span>بيانات البطاقة البنكية</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-500 font-normal">
                    <Lock className="w-3 h-3" />
                    <span>آمن</span>
                  </span>
                </div>

                {paymentStatus === 'paid' ? (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>تم تأكيد الدفع بالبطاقة بنجاح</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPaymentStatus('unpaid')}
                      className="underline font-normal cursor-pointer"
                    >
                      تعديل
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      dir="ltr"
                      maxLength={19}
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="4000 1234 5678 9010"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono tabular-nums text-left"
                    />
                    <input
                      type="text"
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value)}
                      placeholder="اسم حامل البطاقة"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        maxLength={5}
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        placeholder="MM/YY"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono tabular-nums text-left"
                      />
                      <input
                        type="password"
                        dir="ltr"
                        maxLength={4}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        placeholder="CVV"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono tabular-nums text-left"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handlePayCardNow}
                      disabled={processingCard}
                      className="w-full py-2.5 px-4 rounded-lg bg-[#0A192F] hover:bg-[#112240] text-white text-xs font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {processingCard ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>جاري تنفيذ الدفع...</span>
                        </>
                      ) : (
                        <span>دفع الآن</span>
                      )}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 6. Confirm Order Button & Bottom Payment Summary Step */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        {!showPaymentSummary ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-[#0A192F]">
                جاهز لإنشاء الطلب؟
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                سيتم احتساب رسوم التوصيل والإجمالي النهائي وعرض ملخص الدفع عند المتابعة للتأكيد
              </p>
            </div>
            <button
              type="button"
              onClick={handleProceedToSummary}
              className="px-6 py-3 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] text-white font-bold text-sm transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Truck className="w-4 h-4" />
              <span>إنشاء الطلب</span>
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#0A192F]">
                  ملخص الدفع وتأكيد الطلب
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  راجع القيم النهائية قبل إرسال الطلب وتشغيل التوزيع التلقائي
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentSummary(false)}
                className="text-xs font-semibold text-slate-600 hover:text-[#0A192F] underline cursor-pointer"
              >
                تعديل بيانات الطلب
              </button>
            </div>

            <div className="bg-[#0A192F] text-white rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-200">
                <span>المبلغ المطلوب</span>
                <span className="font-mono tabular-nums font-semibold text-white">
                  {itemAmount.toFixed(2)} ج.م
                </span>
              </div>

              <div className="flex items-center justify-between text-sm text-slate-200">
                <span>رسوم التوصيل</span>
                <span className="font-mono tabular-nums font-semibold text-white">
                  {totalDeliveryFee.toFixed(2)} ج.م
                </span>
              </div>

              {isLargeOrder && (
                <div className="pt-2 border-t border-white/10 space-y-1.5 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span>عدد المندوبين للأوردر الكبير</span>
                    <span className="font-mono tabular-nums font-bold text-white">
                      {effectiveCouriersCount} مناديب (عمولة كاملة {commissionPct}% لكل مندوب)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>عمولة كل مندوب</span>
                    <span className="font-mono tabular-nums font-semibold text-emerald-300">
                      {perCourierCommissionPreview.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>إجمالي العمولات التي ستدفعها هاتلي</span>
                    <span className="font-mono tabular-nums font-bold text-[#FF7B00]">
                      {totalCommissionHatlyPays.toFixed(2)} ج.م
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>صافي إيراد هاتلي بعد خصم العمولات</span>
                    <span
                      className={`font-mono tabular-nums font-bold ${
                        netHatlyRevenueAfterLargeOrder >= 0
                          ? 'text-emerald-300'
                          : 'text-amber-300'
                      }`}
                    >
                      {netHatlyRevenueAfterLargeOrder.toFixed(2)} ج.م
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-white/15 flex items-center justify-between text-lg font-extrabold">
                <span>الإجمالي</span>
                <span className="font-mono tabular-nums text-[#FF7B00]">
                  {grandTotal.toFixed(2)} ج.م
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPaymentSummary(false)}
                className="px-5 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-3 rounded-xl bg-[#FF7B00] hover:bg-[#E56E00] disabled:opacity-60 text-white font-bold text-sm transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري تأكيد الطلب والتوزيع...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>تأكيد إنشاء الطلب</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

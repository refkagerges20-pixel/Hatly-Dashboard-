import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  MapPin,
  Search,
  ShoppingBag,
  Smartphone,
  Store,
} from 'lucide-react';
import type { Advertisement } from '../types/database';
import { formatSubscriptionDate, getAdStatusMeta } from '../utils/subscriptions';

interface CustomerAdsPreviewProps {
  ads: Advertisement[];
  merchantNameMap: Map<string, string>;
}

export function CustomerAdsPreview({
  ads,
  merchantNameMap,
}: CustomerAdsPreviewProps) {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  const visibleAds = useMemo(() => {
    if (scope === 'all') return ads;
    const activeOnly = ads.filter(
      (ad) => getAdStatusMeta(ad.start_date, ad.end_date).key === 'active'
    );
    return activeOnly;
  }, [ads, scope]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [scope, visibleAds.length]);

  useEffect(() => {
    if (visibleAds.length <= 1) return;
    const currentAd = visibleAds[currentIndex];
    if (currentAd?.media_type === 'video') return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % visibleAds.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [visibleAds, currentIndex]);

  const activeAd = visibleAds[currentIndex] || null;
  const activeMerchantName = activeAd
    ? merchantNameMap.get(activeAd.merchant_id) || 'متجر هاتلي'
    : '';

  const goNext = () => {
    if (visibleAds.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % visibleAds.length);
  };

  const goPrev = () => {
    if (visibleAds.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + visibleAds.length) % visibleAds.length);
  };

  return (
    <div dir="rtl" className="grid lg:grid-cols-12 gap-6 items-start">
      {/* Controls & Thumbnails */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-[#FF7B00]" />
            <h3 className="text-sm font-bold text-[#0A192F]">
              معاينة شاشة تطبيق العميل
            </h3>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setScope('active')}
              className={`px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                scope === 'active'
                  ? 'bg-[#0A192F] text-white'
                  : 'text-slate-600 hover:text-[#0A192F]'
              }`}
            >
              النشطة فقط
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                scope === 'all'
                  ? 'bg-[#FF7B00] text-white'
                  : 'text-slate-600 hover:text-[#0A192F]'
              }`}
            >
              كل الإعلانات ({ads.length})
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          هكذا تظهر إعلانات المتاجر (صور وفيديو) داخل شريط العروض الرئيسي في تطبيق عملاء هاتلي.
        </p>

        {visibleAds.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500 space-y-2">
            <div>لا توجد إعلانات نشطة للعرض حالياً.</div>
            {ads.length > 0 && scope === 'active' && (
              <button
                type="button"
                onClick={() => setScope('all')}
                className="text-[#FF7B00] font-bold underline cursor-pointer"
              >
                عرض جميع الإعلانات المجدولة والمنتهية ({ads.length})
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-[360px] overflow-y-auto pl-1">
            {visibleAds.map((ad, idx) => {
              const isSelected = idx === currentIndex;
              const statusMeta = getAdStatusMeta(ad.start_date, ad.end_date);
              return (
                <button
                  key={ad.id}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-full text-right p-2.5 rounded-xl border flex items-center gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#FF7B00] bg-orange-50/50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="w-14 h-14 rounded-lg bg-slate-900 overflow-hidden shrink-0 flex items-center justify-center">
                    {ad.media_type === 'video' ? (
                      <Film className="w-5 h-5 text-[#FF7B00]" />
                    ) : (
                      <img
                        src={ad.media_url}
                        alt={ad.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-[#0A192F] truncate">
                      {ad.title}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {merchantNameMap.get(ad.merchant_id) || 'متجر هاتلي'} ·{' '}
                      <span className={statusMeta.cls}>{statusMeta.label}</span>
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">
                      {formatSubscriptionDate(ad.start_date)} ←{' '}
                      {formatSubscriptionDate(ad.end_date)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer Mobile App Frame Preview */}
      <div className="lg:col-span-7 flex justify-center">
        <div className="w-full max-w-[390px] rounded-[2rem] border-[6px] border-[#0A192F] bg-slate-50 overflow-hidden shadow-lg">
          {/* App Top Header */}
          <div className="bg-[#0A192F] text-white px-4 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#FF7B00] flex items-center justify-center font-extrabold text-xs">
                هـ
              </div>
              <div>
                <div className="text-xs font-extrabold">هاتلي</div>
                <div className="text-[10px] text-slate-300 flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5 text-[#FF7B00]" />
                  <span>المنيا · التوصيل السريع</span>
                </div>
              </div>
            </div>
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
              <ShoppingBag className="w-3.5 h-3.5 text-[#FF7B00]" />
            </div>
          </div>

          <div className="p-3.5 space-y-4">
            {/* Search Mock Bar */}
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-slate-400">
              <Search className="w-3.5 h-3.5" />
              <span>ابحث عن مطعم أو متجر...</span>
            </div>

            {/* Featured Ads Carousel */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#0A192F]">عروض وإعلانات المتاجر</span>
                {visibleAds.length > 0 && (
                  <span className="font-mono tabular-nums text-[11px] text-slate-500">
                    {currentIndex + 1} / {visibleAds.length}
                  </span>
                )}
              </div>

              <div className="relative rounded-2xl overflow-hidden bg-[#0A192F] aspect-[16/10] border border-slate-200">
                {!activeAd ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-2 p-4 text-center">
                    <ImageIcon className="w-7 h-7 text-[#FF7B00]" />
                    <span className="text-xs">لا توجد إعلانات مضافة للعرض</span>
                  </div>
                ) : (
                  <>
                    {activeAd.media_type === 'video' ? (
                      <video
                        key={activeAd.id}
                        src={activeAd.media_url}
                        controls
                        muted
                        playsInline
                        loop
                        className="w-full h-full object-cover bg-black"
                      />
                    ) : (
                      <img
                        key={activeAd.id}
                        src={activeAd.media_url}
                        alt={activeAd.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}

                    {/* Gradient Scrim & Caption */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3.5 text-white">
                      <div className="text-[10px] font-semibold text-[#FF7B00]">
                        إعلان ممول · {activeMerchantName}
                      </div>
                      <div className="text-sm font-extrabold truncate mt-0.5">
                        {activeAd.title}
                      </div>
                    </div>

                    {visibleAds.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={goPrev}
                          aria-label="الإعلان السابق"
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={goNext}
                          aria-label="الإعلان التالي"
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>

              {visibleAds.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  {visibleAds.map((ad, idx) => (
                    <button
                      key={ad.id}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      aria-label={`عرض الإعلان ${idx + 1}`}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        idx === currentIndex
                          ? 'w-5 bg-[#FF7B00]'
                          : 'w-1.5 bg-slate-300'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Mock Store Row Under Carousel */}
            <div className="space-y-2 pt-1">
              <div className="text-xs font-bold text-[#0A192F]">
                متاجر قريبة منك
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Array.from(merchantNameMap.entries())
                  .slice(0, 2)
                  .map(([id, name]) => (
                    <div
                      key={id}
                      className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-2"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#0A192F]/10 text-[#0A192F] flex items-center justify-center shrink-0">
                        <Store className="w-4 h-4 text-[#FF7B00]" />
                      </div>
                      <div className="text-[11px] font-bold text-[#0A192F] truncate">
                        {name}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

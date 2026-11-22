import { BarChart3, Clock, RefreshCw, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface DayChartPoint {
  dayIndex: number;
  dayName: string;
  ordersCount: number;
}

export interface HourChartPoint {
  hour: number;
  hourLabel: string;
  ordersCount: number;
}

interface OverviewChartsProps {
  weeklyOrdersData: DayChartPoint[];
  totalDeliveredOrders: number;
  hourlyOrdersData: HourChartPoint[];
  peakWindowText: string;
  peakHourCount: number;
  totalOrdersAnalyzed: number;
  onRefresh: () => void;
}

export default function OverviewCharts({
  weeklyOrdersData,
  totalDeliveredOrders,
  hourlyOrdersData,
  peakWindowText,
  peakHourCount,
  totalOrdersAnalyzed,
  onRefresh,
}: OverviewChartsProps) {
  return (
    <>
      {/* Widget 1: Orders per Day of the Week (Bar Chart) */}
      <section className="lg:col-span-6 xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#FF7F00]" />
              <h2 className="text-sm font-bold text-[#0B1A33]">
                الطلبات المُسلّمة حسب أيام الأسبوع
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              توزيع{' '}
              <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
                {totalDeliveredOrders}
              </span>{' '}
              طلب مُسلّم (الأحد ← السبت)
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="تحديث الرسوم البيانية"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-[#0B1A33] hover:bg-slate-50 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {totalDeliveredOrders === 0 ? (
          <div className="h-[230px] flex flex-col items-center justify-center text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 p-4">
            <BarChart3 className="w-6 h-6 text-slate-300 mb-2" />
            <div className="text-xs font-bold text-slate-600">
              لا توجد طلبات مُسلّمة بعد
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              سيظهر الرسم البياني تلقائياً بمجرد تسليم أول طلب
            </p>
          </div>
        ) : (
          <div dir="ltr" className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={weeklyOrdersData}
                margin={{ top: 8, right: 0, left: 8, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E2E8F0"
                />
                <XAxis
                  dataKey="dayName"
                  reversed={true}
                  tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(11, 26, 51, 0.05)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as DayChartPoint;
                    return (
                      <div
                        dir="rtl"
                        className="bg-[#0B1A33] text-white px-3 py-2 rounded-lg text-xs shadow-md border border-[#13294B]"
                      >
                        <div className="font-bold text-[#FF7F00]">
                          يوم {pt.dayName}
                        </div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          الطلبات المُسلّمة: {pt.ordersCount}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="ordersCount"
                  name="عدد الطلبات"
                  fill="#FF7F00"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Widget 2: Peak Hours Analysis (Line Chart) */}
      <section className="lg:col-span-6 xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#0B1A33]" />
              <h2 className="text-sm font-bold text-[#0B1A33]">
                تحليل ساعات الذروة (24 ساعة)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              كثافة الطلبات على مدار اليوم (
              <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
                {totalOrdersAnalyzed}
              </span>{' '}
              طلب)
            </p>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FF7F00]/10 border border-[#FF7F00]/30 text-[#0B1A33] text-xs font-bold whitespace-nowrap shrink-0">
            <Clock className="w-3.5 h-3.5 text-[#FF7F00] shrink-0" />
            <span className="font-mono tabular-nums">{peakWindowText}</span>
          </div>
        </div>

        {totalOrdersAnalyzed === 0 ? (
          <div className="h-[230px] flex flex-col items-center justify-center text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 p-4">
            <Clock className="w-6 h-6 text-slate-300 mb-2" />
            <div className="text-xs font-bold text-slate-600">
              لا توجد بيانات ساعات ذروة بعد
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              ستظهر كثافة الطلبات عبر ساعات اليوم فور تسجيل الطلبات
            </p>
          </div>
        ) : (
          <div dir="ltr" className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={hourlyOrdersData}
                margin={{ top: 8, right: 0, left: 10, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E2E8F0"
                />
                <XAxis
                  dataKey="hourLabel"
                  reversed={true}
                  tick={{ fill: '#334155', fontSize: 10 }}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tickLine={false}
                  interval={3}
                />
                <YAxis
                  orientation="right"
                  allowDecimals={false}
                  tick={{ fill: '#64748B', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as HourChartPoint;
                    return (
                      <div
                        dir="rtl"
                        className="bg-[#0B1A33] text-white px-3 py-2 rounded-lg text-xs shadow-md border border-[#13294B]"
                      >
                        <div className="font-mono font-bold text-[#FF7F00]">
                          الساعة {pt.hourLabel}
                        </div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          عدد الطلبات: {pt.ordersCount}
                        </div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="ordersCount"
                  name="كثافة الطلبات"
                  stroke="#0B1A33"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#FF7F00', strokeWidth: 0 }}
                  activeDot={{
                    r: 5,
                    fill: '#FF7F00',
                    stroke: '#0B1A33',
                    strokeWidth: 2,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {peakHourCount > 0 && (
          <div className="pt-2.5 mt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>أعلى معدل ساعي مسجّل</span>
            <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
              {peakHourCount} طلب / ساعة
            </span>
          </div>
        )}
      </section>
    </>
  );
}

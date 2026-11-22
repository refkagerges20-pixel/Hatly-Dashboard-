import React, { useState } from 'react';
import { Lock, Mail, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { HatlyLogo } from './HatlyLogo';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!email.trim() || !password) {
      setErrorMessage('يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }

    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);

    if (error) {
      setErrorMessage(
        error.includes('Invalid login')
          ? 'بيانات الدخول غير صحيحة، يرجى التحقق من البريد وكلمة المرور'
          : error
      );
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-12 bg-slate-50">
      {/* Navy Brand Panel matched to Hatly Logo */}
      <div className="hidden lg:flex lg:col-span-5 bg-[#0B1A33] text-white flex-col justify-between p-12 relative overflow-hidden">
        <div className="relative z-10 space-y-6">
          <HatlyLogo size="lg" darkBg />
          <div className="bg-white rounded-2xl p-4 w-fit shadow-lg border border-white/10">
            <img
              src="/assets/aistudio/hatly-logo_d5d15672.png"
              alt="شعار هاتلي"
              className="w-40 h-40 object-contain"
            />
          </div>
          <p className="text-slate-300 text-sm leading-relaxed max-w-sm">
            منظومة إدارة التوصيل واللوجستيات في مدينة المنيا والمنيا الجديدة — مطاعم، متاجر، وشحن سريع.
          </p>
        </div>

        <div className="relative z-10 space-y-6">
          <h1 className="text-3xl font-bold leading-snug text-white">
            إدارة مركزية للطلبات، المناديب، المتاجر والتسعير الذكي
          </h1>
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div>
              <div className="text-xl font-bold text-[#FF7F00] tabular-nums">Auto-Dispatch</div>
              <div className="text-xs text-slate-300 mt-1">توزيع تلقائي فوري للمناديب المتاحين</div>
            </div>
            <div>
              <div className="text-xl font-bold text-[#EF2323] tabular-nums">Haversine GIS</div>
              <div className="text-xs text-slate-300 mt-1">تحديد تلقائي لنطاق مدينة المنيا والمنيا الجديدة</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-slate-400">
          Hatly Delivery Operations Console · Your Order. Our Mission.
        </div>
      </div>

      {/* Login Form Area */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8">
          <div className="lg:hidden flex items-center justify-between mb-6">
            <HatlyLogo size="md" darkBg={false} />
          </div>

          <h2 className="text-2xl font-bold text-[#0B1A33]">تسجيل الدخول</h2>
          <p className="text-sm text-slate-500 mt-1.5">
            أدخل بيانات حساب الإدارة أو العمليات أو الدعم أو المتجر للمتابعة
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-[#EF2323]/30 text-[#EF2323] text-sm font-semibold"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-semibold text-slate-700 mb-1.5"
              >
                البريد الإلكتروني
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@hatly.app"
                  className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00] text-left"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-semibold text-slate-700 mb-1.5"
              >
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#FF7F00]/30 focus:border-[#FF7F00] text-left"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-[#FF7F00] hover:bg-[#E57000] disabled:opacity-60 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري التحقق من الحساب...</span>
                </>
              ) : (
                <span>دخول إلى لوحة التحكم</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { Menu, Plus } from 'lucide-react';
import type { DashboardSection } from '../types/database';
import { useAuth } from '../contexts/AuthContext';

interface HeaderProps {
  activeSection: DashboardSection;
  onOpenMobileMenu: () => void;
  onCreateNewOrder: () => void;
}

const SECTION_TITLES: Record<DashboardSection, string> = {
  overview: 'لوحة التحكم العامة',
  orders: 'إدارة الطلبات',
  'new-order': 'إضافة طلب جديد',
  couriers: 'إدارة المناديب',
  shifts: 'إدارة الورديات',
  merchants: 'المتاجر والبراندات',
  customers: 'العملاء',
  ads: 'الإعلانات',
  'subscription-plans': 'باقات الاشتراك',
  complaints: 'الشكاوى والدعم',
  'zones-pricing': 'المناطق والتسعير',
  financials: 'المالية والعهدة',
  payroll: 'رواتب المندوبين',
  settlements: 'التسويات والمدفوعات',
  audit: 'سجل المراجعة',
  users: 'المستخدمون والصلاحيات',
  settings: 'الإعدادات',
};

export function Header({
  activeSection,
  onOpenMobileMenu,
  onCreateNewOrder,
}: HeaderProps) {
  const { canAccess, role } = useAuth();
  const sectionTitle =
    activeSection === 'ads' && role === 'merchant'
      ? 'إدارة الإعلانات'
      : SECTION_TITLES[activeSection];

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="فتح القائمة"
          className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
            هاتلي
          </span>
          <span className="text-slate-300 hidden sm:inline">/</span>
          <h1 className="text-base sm:text-lg font-bold text-[#0B1A33] truncate">
            {sectionTitle}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {canAccess('new-order') && activeSection !== 'new-order' && (
          <button
            type="button"
            onClick={onCreateNewOrder}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FF7F00] hover:bg-[#E57000] text-white text-xs sm:text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>طلب جديد</span>
          </button>
        )}
      </div>
    </header>
  );
}

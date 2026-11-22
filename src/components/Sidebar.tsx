import {
  LayoutDashboard,
  ClipboardList,
  PlusCircle,
  Bike,
  Clock,
  Store,
  UserCheck,
  MapPinned,
  Wallet,
  Receipt,
  History,
  Users,
  LogOut,
  Megaphone,
  Layers,
  MessageSquareWarning,
  X,
  Settings,
  Banknote,
} from 'lucide-react';
import type { DashboardSection, UserRole } from '../types/database';
import { useAuth } from '../contexts/AuthContext';
import { HatlyLogo } from './HatlyLogo';

interface SidebarProps {
  activeSection: DashboardSection;
  onSelect: (section: DashboardSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: DashboardSection;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'لوحة التحكم', icon: LayoutDashboard },
  { id: 'orders', label: 'إدارة الطلبات', icon: ClipboardList },
  { id: 'new-order', label: 'إضافة طلب جديد', icon: PlusCircle },
  { id: 'couriers', label: 'إدارة المناديب', icon: Bike },
  { id: 'shifts', label: 'إدارة الورديات', icon: Clock },
  { id: 'merchants', label: 'المتاجر والبراندات', icon: Store },
  { id: 'customers', label: 'العملاء', icon: UserCheck },
  { id: 'ads', label: 'الإعلانات', icon: Megaphone },
  { id: 'subscription-plans', label: 'باقات الاشتراك', icon: Layers },
  { id: 'complaints', label: 'الشكاوى والدعم', icon: MessageSquareWarning },
  { id: 'zones-pricing', label: 'المناطق والتسعير', icon: MapPinned },
  { id: 'financials', label: 'المالية والعهدة', icon: Wallet },
  { id: 'payroll', label: 'رواتب المندوبين', icon: Banknote },
  { id: 'settlements', label: 'التسويات والمدفوعات', icon: Receipt },
  { id: 'audit', label: 'سجل المراجعة', icon: History },
  { id: 'users', label: 'المستخدمون والصلاحيات', icon: Users },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'مدير النظام',
  operations: 'مشرف العمليات',
  support: 'علاقات عامة ودعم',
  finance: 'المحاسب المالي',
  merchant: 'متجر / براند',
  courier: 'مندوب توصيل',
};

export function Sidebar({
  activeSection,
  onSelect,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { fullName, role, canAccess, signOut } = useAuth();

  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item.id));

  const sidebarContent = (
    <aside className="w-[260px] h-full bg-[#0B1A33] text-slate-200 flex flex-col justify-between select-none">
      <div>
        <div className="h-16 px-4 flex items-center justify-between border-b border-white/10">
          <HatlyLogo size="sm" darkBg />
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="إغلاق القائمة"
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-3 space-y-1 overflow-y-auto max-h-[calc(100vh-148px)]">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            const displayLabel =
              item.id === 'ads' && role === 'merchant'
                ? 'إدارة الإعلانات'
                : item.label;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#FF7F00] text-white'
                    : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{displayLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">
            {fullName || 'جرجس نبيل'}
          </div>
          <div className="text-xs text-[#FF7F00] font-semibold truncate mt-0.5">
            {ROLE_LABELS[role] || role}
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/15 text-xs font-semibold text-slate-200 hover:bg-[#EF2323]/20 hover:border-[#EF2323]/40 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <div className="hidden lg:block shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-[#0B1A33]/60 backdrop-blur-xs"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { OverviewView } from './components/OverviewView';
import { OrdersView } from './components/OrdersView';
import { NewOrderForm } from './components/NewOrderForm';
import { CouriersView } from './components/CouriersView';
import { CourierShiftsView } from './components/CourierShiftsView';
import { MerchantsView } from './components/MerchantsView';
import { CustomersView } from './components/CustomersView';
import { AdsManagementView } from './components/AdsManagementView';
import { SubscriptionPlansView } from './components/SubscriptionPlansView';
import { ComplaintsView } from './components/ComplaintsView';
import { ZonesPricingView } from './components/ZonesPricingView';
import { CourierPayrollView } from './components/CourierPayrollView';
import {
  AuditView,
  FinancialsView,
  SettingsView,
  SettlementsView,
  UsersView,
} from './components/AdminOnlyViews';
import type { DashboardSection, UserRole } from './types/database';
import {
  getDefaultSectionForRole,
  getFirstAllowedSection,
} from './utils/permissions';
import { invalidateSummaryCache } from './utils/summaryCache';
import { useOrdersRealtime } from './utils/useOrdersRealtime';

function getInitialSection(role: UserRole): DashboardSection {
  if (typeof window !== 'undefined') {
    if (window.location.pathname === '/shifts') return 'shifts';
    if (window.location.pathname === '/payroll') return 'payroll';
  }
  return getDefaultSectionForRole(role);
}

function DashboardShell() {
  const { role, permissions, canAccess } = useAuth();
  const [activeSection, setActiveSection] = useState<DashboardSection>(() =>
    getInitialSection(role)
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  useOrdersRealtime('dashboard-global-orders', () => {
    invalidateSummaryCache();
  });

  const firstAllowed = getFirstAllowedSection(role, permissions);

  useEffect(() => {
    if (!canAccess(activeSection) && firstAllowed) {
      setActiveSection(firstAllowed);
    }
  }, [activeSection, canAccess, firstAllowed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolved = canAccess(activeSection) ? activeSection : firstAllowed;
    if (resolved === 'payroll' && window.location.pathname !== '/payroll') {
      window.history.replaceState(null, '', '/payroll');
    } else if (
      resolved &&
      resolved !== 'payroll' &&
      window.location.pathname === '/payroll'
    ) {
      window.history.replaceState(null, '', '/');
    }
  }, [activeSection, canAccess, firstAllowed]);

  const renderSection = () => {
    if (!firstAllowed) {
      return (
        <div
          dir="rtl"
          className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2"
        >
          <div className="text-base font-bold text-[#0B1A33]">
            لا توجد صلاحيات وصول مفعّلة لهذا الحساب
          </div>
          <p className="text-xs text-slate-500">
            يرجى التواصل مع مدير النظام لتفعيل الصلاحيات المطلوبة لحسابك.
          </p>
        </div>
      );
    }

    const resolvedSection = canAccess(activeSection)
      ? activeSection
      : firstAllowed;

    switch (resolvedSection) {
      case 'overview':
        return <OverviewView onNavigate={setActiveSection} />;
      case 'orders':
        return <OrdersView onNavigateNewOrder={() => setActiveSection('new-order')} />;
      case 'new-order':
        return <NewOrderForm onOrderCreated={() => {}} />;
      case 'couriers':
        return <CouriersView />;
      case 'shifts':
        return <CourierShiftsView />;
      case 'merchants':
        return <MerchantsView />;
      case 'customers':
        return <CustomersView />;
      case 'ads':
        return <AdsManagementView />;
      case 'subscription-plans':
        return <SubscriptionPlansView />;
      case 'complaints':
        return <ComplaintsView />;
      case 'zones-pricing':
        return <ZonesPricingView />;
      case 'financials':
        return <FinancialsView />;
      case 'payroll':
        return <CourierPayrollView />;
      case 'settlements':
        return <SettlementsView />;
      case 'audit':
        return <AuditView />;
      case 'users':
        return <UsersView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewView onNavigate={setActiveSection} />;
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeSection={activeSection}
        onSelect={setActiveSection}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <Header
          activeSection={activeSection}
          onOpenMobileMenu={() => setMobileOpen(true)}
          onCreateNewOrder={() => setActiveSection('new-order')}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {renderSection()}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <DashboardShell />
      </ProtectedRoute>
    </AuthProvider>
  );
}

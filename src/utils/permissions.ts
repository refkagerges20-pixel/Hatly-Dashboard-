import type { DashboardSection, UserRole } from '../types/database';

export interface DashboardModuleDefinition {
  id: DashboardSection;
  label: string;
  description: string;
}

export const DASHBOARD_MODULES: DashboardModuleDefinition[] = [
  {
    id: 'overview',
    label: 'لوحة التحكم والإحصائيات',
    description: 'الرسوم البيانية ومؤشرات الأداء الرئيسية',
  },
  {
    id: 'orders',
    label: 'إدارة الطلبات',
    description: 'متابعة الطلبات، طلبات الإلغاء، وتعيين المناديب',
  },
  {
    id: 'new-order',
    label: 'إضافة طلب جديد',
    description: 'إنشاء طلبات التوصيل والبراندات يدوياً',
  },
  {
    id: 'couriers',
    label: 'إدارة المناديب',
    description: 'حسابات المناديب، الاعتماد، والجزاءات',
  },
  {
    id: 'shifts',
    label: 'إدارة الورديات',
    description: 'جدولة ونشر ورديات المناديب وسجل الحضور',
  },
  {
    id: 'merchants',
    label: 'المتاجر والبراندات',
    description: 'إدارة المتاجر، الباقات، وكشف حساب التاجر',
  },
  {
    id: 'customers',
    label: 'العملاء',
    description: 'سجل العملاء والتسويق عبر واتساب',
  },
  {
    id: 'ads',
    label: 'الإعلانات',
    description: 'إدارة ومراجعة إعلانات المتاجر والبنرات',
  },
  {
    id: 'subscription-plans',
    label: 'باقات الاشتراك',
    description: 'إعداد باقات الاشتراك الشهرية للمتاجر',
  },
  {
    id: 'complaints',
    label: 'الشكاوى والدعم',
    description: 'مراجعة وحل شكاوى العملاء والمتاجر',
  },
  {
    id: 'zones-pricing',
    label: 'المناطق والتسعير',
    description: 'إدارة مناطق التوصيل وتسعيرة المسافات',
  },
  {
    id: 'financials',
    label: 'المالية والعهدة',
    description: 'الإيرادات، المصاريف، عهدة المناديب، والربح الصافي',
  },
  {
    id: 'payroll',
    label: 'رواتب المندوبين',
    description: 'حساب العمولات الشهرية والخصومات وصافي مستحقات المناديب',
  },
  {
    id: 'settlements',
    label: 'التسويات والمدفوعات',
    description: 'سجل توريدات المناديب وتسويات المتاجر',
  },
  {
    id: 'audit',
    label: 'سجل المراجعة',
    description: 'مراجعة العمليات المالية والتعديلات الحساسة',
  },
  {
    id: 'users',
    label: 'المستخدمون والصلاحيات',
    description: 'إدارة فريق العمل والأدوار والصلاحيات المخصصة',
  },
  {
    id: 'settings',
    label: 'الإعدادات',
    description: 'إعدادات العمولات وحدود الكاش والنظام',
  },
];

export type UserPermissionsMap = Partial<Record<DashboardSection, boolean>>;

export function getDefaultPermissionsForRole(
  role: UserRole
): Record<DashboardSection, boolean> {
  const base: Record<DashboardSection, boolean> = {
    overview: false,
    orders: false,
    'new-order': false,
    couriers: false,
    shifts: false,
    merchants: false,
    customers: false,
    ads: false,
    'subscription-plans': false,
    complaints: false,
    'zones-pricing': false,
    financials: false,
    payroll: false,
    settlements: false,
    audit: false,
    users: false,
    settings: false,
  };

  if (role === 'admin') {
    for (const mod of DASHBOARD_MODULES) {
      base[mod.id] = true;
    }
    return base;
  }

  if (role === 'operations') {
    base.overview = true;
    base.orders = true;
    base['new-order'] = true;
    base.couriers = true;
    base.shifts = true;
    base.merchants = true;
    base.customers = true;
    base['zones-pricing'] = true;
    return base;
  }

  if (role === 'support') {
    base.customers = true;
    base.merchants = true;
    base.complaints = true;
    return base;
  }

  if (role === 'finance') {
    base.financials = true;
    base.payroll = true;
    base.settlements = true;
    base.audit = true;
    return base;
  }

  if (role === 'merchant') {
    base.orders = true;
    base['new-order'] = true;
    base.ads = true;
    return base;
  }

  // courier
  base.orders = true;
  return base;
}

export function normalizePermissionsObject(
  raw: unknown
): UserPermissionsMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return null;

  const validKeys = new Set<string>(DASHBOARD_MODULES.map((m) => m.id));
  const result: UserPermissionsMap = {};
  let hasAnyValidKey = false;

  for (const [key, val] of entries) {
    if (validKeys.has(key) && typeof val === 'boolean') {
      result[key as DashboardSection] = val;
      hasAnyValidKey = true;
    }
  }

  return hasAnyValidKey ? result : null;
}

export function resolveEffectivePermissions(
  role: UserRole,
  customPermissions?: UserPermissionsMap | null
): Record<DashboardSection, boolean> {
  const defaults = getDefaultPermissionsForRole(role);
  if (!customPermissions) return defaults;

  const merged = { ...defaults };
  for (const mod of DASHBOARD_MODULES) {
    if (typeof customPermissions[mod.id] === 'boolean') {
      merged[mod.id] = Boolean(customPermissions[mod.id]);
    }
  }
  return merged;
}

export function hasCustomPermissionsOverride(
  role: UserRole,
  customPermissions?: UserPermissionsMap | null
): boolean {
  if (!customPermissions) return false;
  const defaults = getDefaultPermissionsForRole(role);
  return DASHBOARD_MODULES.some(
    (mod) =>
      typeof customPermissions[mod.id] === 'boolean' &&
      customPermissions[mod.id] !== defaults[mod.id]
  );
}

export function getDefaultSectionForRole(role: UserRole): DashboardSection {
  switch (role) {
    case 'merchant':
    case 'courier':
      return 'orders';
    case 'support':
      return 'complaints';
    case 'finance':
      return 'financials';
    case 'operations':
    case 'admin':
    default:
      return 'overview';
  }
}

export function getFirstAllowedSection(
  role: UserRole,
  customPermissions?: UserPermissionsMap | null
): DashboardSection | null {
  const effective = resolveEffectivePermissions(role, customPermissions);
  const preferred = getDefaultSectionForRole(role);
  if (effective[preferred]) return preferred;

  const first = DASHBOARD_MODULES.find((m) => effective[m.id]);
  return first ? first.id : null;
}

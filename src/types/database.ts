export type UserRole =
  | 'admin'
  | 'operations'
  | 'support'
  | 'finance'
  | 'merchant'
  | 'courier';

export type OrderServiceType = 'brand' | 'custom';
export type OrderStatus =
  | 'new'
  | 'assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';
export type PaymentMethod = 'cash' | 'card';
export type PaymentStatus = 'paid' | 'unpaid';

export type CourierStatus = 'online' | 'offline';
export type AccountStatus = 'pending' | 'pending_approval' | 'active' | 'suspended';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
  address?: string | null;
  status?: string | null;
  is_active?: boolean | null;
  permissions?: Partial<Record<DashboardSection, boolean>> | null;
  created_at?: string;
  updated_at?: string;
}

export interface Zone {
  id: string;
  name?: string | null;
  name_ar?: string | null;
  zone_name?: string | null;
  title?: string | null;
  city?: string | null;
  center_lat?: number | null;
  center_lng?: number | null;
  is_active?: boolean | null;
}

export interface Merchant {
  id: string;
  profile_id?: string | null;
  name?: string | null;
  store_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  pickup_address?: string | null;
  zone_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  account_status: AccountStatus;
  partner_discount?: number | null;
  subscription_plan?: string | null;
  subscription_start_date?: string | null;
  subscription_end_date?: string | null;
  is_active?: boolean | null;
  created_at?: string;
  profiles?: Profile | null;
  zones?: Zone | null;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  max_ads?: number | null;
  max_instant_orders?: number | null;
  is_active?: boolean | null;
  features?: string | null;
  max_ads_per_month?: number | null;
  is_free_ads?: boolean | null;
}

export interface SubscriptionRevenue {
  id: string;
  merchant_id: string;
  plan_name: string;
  amount: number;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface Advertisement {
  id: string;
  merchant_id: string;
  title: string;
  media_url: string;
  media_type: 'image' | 'video' | string;
  start_date: string;
  end_date: string;
  is_paid: boolean;
  amount_paid: number;
  created_at: string;
}

export interface Courier {
  id: string;
  profile_id: string;
  status: CourierStatus;
  force_online?: boolean | null;
  active_orders_count: number;
  national_id_url?: string | null;
  license_url?: string | null;
  bank_account_details?: string | null;
  wallet_number?: string | null;
  account_status: AccountStatus;
  current_lat?: number | null;
  current_lng?: number | null;
  created_at?: string;
  profiles?: Profile | null;
}

export interface CourierZone {
  id?: string;
  courier_id: string;
  zone_id: string;
  created_at?: string;
  zones?: Zone | null;
}

export interface CourierShift {
  id: string;
  courier_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  late_minutes?: number | null;
  status?: string | null;
  created_at?: string;
}

export interface CourierPenalty {
  id: string;
  courier_id: string;
  penalty_type: string;
  amount: number;
  reason?: string | null;
  proof_url?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface Customer {
  id: string;
  profile_id: string;
  address?: string | null;
  default_address?: string | null;
  delivery_address?: string | null;
  city?: string | null;
  created_at?: string;
  profiles?: Profile | null;
}

export interface Complaint {
  id: string;
  customer_id?: string | null;
  order_id?: string | null;
  subject: string;
  message: string;
  status: string;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id?: string | null;
  merchant_id?: string | null;
  courier_id?: string | null;
  from_zone_id?: string | null;
  to_zone_id?: string | null;
  products_total: number;
  delivery_fee_base: number;
  partner_discount: number;
  delivery_fee_net: number;
  total: number;
  delivery_address: string;
  customer_notes?: string | null;
  service_type: OrderServiceType | string;
  order_source?:
    | 'customer_app'
    | 'admin'
    | 'merchant_portal'
    | 'call_center'
    | string
    | null;
  status: OrderStatus | string;
  payment_method: PaymentMethod | string;
  payment_status: PaymentStatus | string;
  latitude: number;
  longitude: number;
  amount_to_collect: number;
  pickup_phone?: string | null;
  customer_name: string;
  customer_phone: string;
  custom_fee: number;
  courier_commission?: number | null;
  hatly_net_revenue?: number | null;
  tips?: number | null;
  is_large_order?: boolean | null;
  required_couriers?: number | null;
  merchant_payable?: number | null;
  is_merchant_settled?: boolean | null;
  rejected_by_couriers?: string[] | null;
  cancel_status?: string | null;
  cancel_reason?: string | null;
  cancel_proof_url?: string | null;
  delivery_photo_1?: string | null;
  delivery_photo_2?: string | null;
  delivery_photo_3?: string | null;
  is_cash_collected?: boolean | null;
  created_at: string;
}

export interface MerchantSettlement {
  id: string;
  merchant_id: string;
  amount: number;
  receipt_url?: string | null;
  notes?: string | null;
  payment_date?: string | null;
  created_at?: string | null;
}

export interface OrderCourier {
  id: string;
  order_id: string;
  courier_id: string;
  commission_amount: number;
  cash_collected?: number | null;
  status?: string | null;
  created_at?: string;
  couriers?: Courier | null;
}

export interface CourierDeposit {
  id: string;
  courier_id: string;
  amount: number;
  receipt_url?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  title: string;
  description: string;
  amount: number;
  expense_date: string;
  created_by?: string | null;
}

export interface DeliveryPricing {
  id?: string;
  from_zone_id?: string | null;
  to_zone_id?: string | null;
  zone_id?: string | null;
  price?: number | null;
  base_fee?: number | null;
  delivery_fee_base?: number | null;
  partner_discount?: number | null;
  from_zone?: Zone | null;
  to_zone?: Zone | null;
  zone?: Zone | null;
}

export interface CustomDeliveryPricing {
  id?: string;
  from_zone_id: string;
  to_zone_id: string;
  price: number;
  delivery_fee?: number | null;
  fee?: number | null;
  from_zone?: Zone | null;
  to_zone?: Zone | null;
}

export type DashboardSection =
  | 'overview'
  | 'orders'
  | 'new-order'
  | 'couriers'
  | 'shifts'
  | 'merchants'
  | 'customers'
  | 'ads'
  | 'subscription-plans'
  | 'complaints'
  | 'zones-pricing'
  | 'financials'
  | 'payroll'
  | 'settlements'
  | 'audit'
  | 'users'
  | 'settings';

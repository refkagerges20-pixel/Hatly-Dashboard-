-- Admin & Dashboard Staff RLS Policies for Hatly (Supabase / PostgreSQL)
-- Run this script in the Supabase Dashboard -> SQL Editor.

-- 1. Recursion-safe role helper functions (SECURITY DEFINER avoids infinite recursion on profiles)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_dashboard_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'operations', 'support', 'finance')
  );
$$;

-- 2. Enable RLS on profiles, customers, orders, and merchants
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;

-- 3. PROFILES policies (Admin/Staff can read all profiles; users can read/update their own)
DROP POLICY IF EXISTS "Admins and staff can read all profiles" ON public.profiles;
CREATE POLICY "Admins and staff can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR public.is_dashboard_staff()
  );

DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4. CUSTOMERS policies (Admin/Staff can read all customers; customer can read own row)
DROP POLICY IF EXISTS "Admins and staff can read all customers" ON public.customers;
CREATE POLICY "Admins and staff can read all customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_dashboard_staff()
  );

DROP POLICY IF EXISTS "Admins can manage customers" ON public.customers;
CREATE POLICY "Admins can manage customers"
  ON public.customers
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5. ORDERS policies (Admin/Staff can read all orders for customer order history)
DROP POLICY IF EXISTS "Admins and staff can read all orders" ON public.orders;
CREATE POLICY "Admins and staff can read all orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.is_dashboard_staff());

-- 6. MERCHANTS policies (Ensure Admin can SELECT, INSERT, UPDATE, and DELETE merchants)
DROP POLICY IF EXISTS "Admins and staff can read all merchants" ON public.merchants;
CREATE POLICY "Admins and staff can read all merchants"
  ON public.merchants
  FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_dashboard_staff()
  );

DROP POLICY IF EXISTS "Admins can delete merchants" ON public.merchants;
CREATE POLICY "Admins can delete merchants"
  ON public.merchants
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins and staff can update merchants" ON public.merchants;
CREATE POLICY "Admins and staff can update merchants"
  ON public.merchants
  FOR UPDATE
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR public.is_dashboard_staff()
  )
  WITH CHECK (
    profile_id = auth.uid()
    OR public.is_dashboard_staff()
  );

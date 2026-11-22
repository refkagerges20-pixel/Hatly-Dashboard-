-- Ensure dashboard staff (admin/operations/finance/support) can read & manage
-- courier_deposits and merchant_settlements, and couriers can read/insert their own deposits.
-- Also enable Supabase Realtime on courier_deposits and merchant_settlements.

ALTER TABLE IF EXISTS public.courier_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.merchant_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dashboard staff can read all courier deposits" ON public.courier_deposits;
CREATE POLICY "Dashboard staff can read all courier deposits"
  ON public.courier_deposits
  FOR SELECT
  TO authenticated
  USING (
    public.is_dashboard_staff()
    OR courier_id IN (
      SELECT id FROM public.couriers WHERE profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins and staff can insert courier deposits" ON public.courier_deposits;
CREATE POLICY "Admins and staff can insert courier deposits"
  ON public.courier_deposits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_dashboard_staff()
    OR courier_id IN (
      SELECT id FROM public.couriers WHERE profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can update or delete courier deposits" ON public.courier_deposits;
CREATE POLICY "Admins can update or delete courier deposits"
  ON public.courier_deposits
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Dashboard staff can read all merchant settlements" ON public.merchant_settlements;
CREATE POLICY "Dashboard staff can read all merchant settlements"
  ON public.merchant_settlements
  FOR SELECT
  TO authenticated
  USING (
    public.is_dashboard_staff()
    OR merchant_id IN (
      SELECT id FROM public.merchants WHERE profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins and staff can insert merchant settlements" ON public.merchant_settlements;
CREATE POLICY "Admins and staff can insert merchant settlements"
  ON public.merchant_settlements
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_dashboard_staff());

DROP POLICY IF EXISTS "Admins can manage merchant settlements" ON public.merchant_settlements;
CREATE POLICY "Admins can manage merchant settlements"
  ON public.merchant_settlements
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'courier_deposits'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'courier_deposits'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.courier_deposits;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'merchant_settlements'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'merchant_settlements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_settlements;
  END IF;
END
$$;

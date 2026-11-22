-- Create courier_zones table linking couriers to the delivery zones they serve,
-- along with RLS policies for Admin/Staff management and Auto-Dispatch queries.

CREATE TABLE IF NOT EXISTS public.courier_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier_id, zone_id)
);

CREATE INDEX IF NOT EXISTS idx_courier_zones_courier_id
  ON public.courier_zones (courier_id);

CREATE INDEX IF NOT EXISTS idx_courier_zones_zone_id
  ON public.courier_zones (zone_id);

ALTER TABLE public.courier_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read courier zones" ON public.courier_zones;
CREATE POLICY "Authenticated users can read courier zones"
  ON public.courier_zones
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Dashboard staff can manage courier zones" ON public.courier_zones;
CREATE POLICY "Dashboard staff can manage courier zones"
  ON public.courier_zones
  FOR ALL
  TO authenticated
  USING (public.is_dashboard_staff())
  WITH CHECK (public.is_dashboard_staff());

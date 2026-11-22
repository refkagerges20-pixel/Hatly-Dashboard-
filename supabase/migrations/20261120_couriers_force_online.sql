-- Add force_online flag to public.couriers so Admins can override shift time and selfie checks
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS force_online boolean NOT NULL DEFAULT false;

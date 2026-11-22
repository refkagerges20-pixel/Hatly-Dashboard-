import { useEffect, useId, useRef } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Order } from '../types/database';

export type OrderRealtimePayload = RealtimePostgresChangesPayload<Order>;

/**
 * Subscribes to Supabase Realtime `postgres_changes` on `public.orders`
 * for INSERT, UPDATE, and DELETE events without polling timers.
 */
export function useOrdersRealtime(
  channelPrefix: string,
  onOrderChange: (payload: OrderRealtimePayload) => void,
  enabled = true
) {
  const callbackRef = useRef(onOrderChange);
  callbackRef.current = onOrderChange;
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(`${channelPrefix}-${reactId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          callbackRef.current(payload as OrderRealtimePayload);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelPrefix, reactId, enabled]);
}

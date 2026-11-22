import type { Zone } from '../types/database';

export interface MinyaCenter {
  key: 'minya_city' | 'new_minya';
  nameAr: string;
  nameEn: string;
  lat: number;
  lng: number;
}

export const MINYA_CENTERS: MinyaCenter[] = [
  {
    key: 'minya_city',
    nameAr: 'مدينة المنيا',
    nameEn: 'Minya City',
    lat: 28.099,
    lng: 30.755,
  },
  {
    key: 'new_minya',
    nameAr: 'المنيا الجديدة',
    nameEn: 'New Minya',
    lat: 28.12,
    lng: 30.8,
  },
];

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Pure TypeScript Haversine formula returning distance in kilometers.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface NearestCenterResult {
  center: MinyaCenter;
  distanceKm: number;
}

export function findNearestCenter(lat: number, lng: number): NearestCenterResult {
  let closest = MINYA_CENTERS[0];
  let minDistance = haversineDistanceKm(lat, lng, closest.lat, closest.lng);

  for (let i = 1; i < MINYA_CENTERS.length; i++) {
    const candidate = MINYA_CENTERS[i];
    const dist = haversineDistanceKm(lat, lng, candidate.lat, candidate.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closest = candidate;
    }
  }

  return {
    center: closest,
    distanceKm: Number(minDistance.toFixed(2)),
  };
}

/**
 * Maps a resolved MinyaCenter to a matching zone row from the `zones` table.
 */
export function matchCenterToZone(
  center: MinyaCenter,
  zones: Zone[]
): Zone | undefined {
  if (!zones || zones.length === 0) return undefined;

  const isNewMinya = center.key === 'new_minya';

  const exactMatch = zones.find((z) => {
    const label = `${z.name_ar || ''} ${z.name || ''}`.toLowerCase();
    if (isNewMinya) {
      return label.includes('جديدة') || label.includes('new');
    }
    return (
      (label.includes('المنيا') || label.includes('minya')) &&
      !label.includes('جديدة') &&
      !label.includes('new')
    );
  });

  if (exactMatch) return exactMatch;

  // Fallback: compare coordinates if zones carry center_lat / center_lng
  const withCoords = zones.filter(
    (z) => typeof z.center_lat === 'number' && typeof z.center_lng === 'number'
  );
  if (withCoords.length > 0) {
    let best = withCoords[0];
    let bestDist = haversineDistanceKm(
      center.lat,
      center.lng,
      best.center_lat!,
      best.center_lng!
    );
    for (const z of withCoords.slice(1)) {
      const d = haversineDistanceKm(
        center.lat,
        center.lng,
        z.center_lat!,
        z.center_lng!
      );
      if (d < bestDist) {
        best = z;
        bestDist = d;
      }
    }
    return best;
  }

  return zones[0];
}

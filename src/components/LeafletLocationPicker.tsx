import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, MapPin } from 'lucide-react';
import {
  MINYA_CENTERS,
  findNearestCenter,
  type NearestCenterResult,
} from '../utils/haversine';

interface LeafletLocationPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number, nearest: NearestCenterResult) => void;
  heightClassName?: string;
}

const createPinIcon = () =>
  L.divIcon({
    className: 'hatly-custom-pin',
    html: `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;transform:translate(-50%,-100%);">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 6px rgba(10,25,47,0.35));">
        <path d="M12 2C7.58 2 4 5.58 4 10C4 15.54 11.14 21.56 11.45 21.81C11.77 22.07 12.23 22.07 12.55 21.81C12.86 21.56 20 15.54 20 10C20 5.58 16.42 2 12 2Z" fill="#FF7B00" stroke="#0A192F" stroke-width="1.6"/>
        <circle cx="12" cy="10" r="3.2" fill="#FFFFFF"/>
      </svg>
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

export function LeafletLocationPicker({
  latitude,
  longitude,
  onChange,
  heightClassName = 'h-72',
}: LeafletLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [nearest, setNearest] = useState<NearestCenterResult>(() =>
    findNearestCenter(latitude, longitude)
  );
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Reference markers for Minya centers
    MINYA_CENTERS.forEach((center) => {
      L.circleMarker([center.lat, center.lng], {
        radius: 6,
        color: '#0A192F',
        weight: 2,
        fillColor: '#0A192F',
        fillOpacity: 0.2,
      })
        .bindTooltip(center.nameAr, { direction: 'top' })
        .addTo(map);
    });

    const marker = L.marker([latitude, longitude], {
      draggable: true,
      icon: createPinIcon(),
    }).addTo(map);

    const updatePosition = (lat: number, lng: number) => {
      const cleanLat = Number(lat.toFixed(6));
      const cleanLng = Number(lng.toFixed(6));
      const computed = findNearestCenter(cleanLat, cleanLng);
      setNearest(computed);
      onChangeRef.current(cleanLat, cleanLng, computed);
    };

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      updatePosition(pos.lat, pos.lng);
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      updatePosition(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Ensure Leaflet calculates size correctly inside modals/tabs
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      const current = markerRef.current.getLatLng();
      if (
        Math.abs(current.lat - latitude) > 0.00001 ||
        Math.abs(current.lng - longitude) > 0.00001
      ) {
        markerRef.current.setLatLng([latitude, longitude]);
        mapRef.current.panTo([latitude, longitude]);
      }
      setNearest(findNearestCenter(latitude, longitude));
    }
  }, [latitude, longitude]);

  const jumpTo = (lat: number, lng: number) => {
    if (mapRef.current && markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], 14);
    }
    const computed = findNearestCenter(lat, lng);
    setNearest(computed);
    onChange(Number(lat.toFixed(6)), Number(lng.toFixed(6)), computed);
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        jumpTo(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {MINYA_CENTERS.map((c) => {
            const active = nearest.center.key === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => jumpTo(c.lat, c.lng)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#0A192F] text-white border-[#0A192F]'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {c.nameAr}
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5 text-[#FF7B00]" />
            <span>{locating ? 'جاري التحديد...' : 'موقعي الحالي'}</span>
          </button>
        </div>

        <div className="text-xs text-slate-600 flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-[#FF7B00] shrink-0" />
          <span>أقرب مركز:</span>
          <strong className="text-[#0A192F]">{nearest.center.nameAr}</strong>
          <span className="text-slate-400">·</span>
          <span className="font-mono tabular-nums text-slate-500">
            {nearest.distanceKm} كم
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`w-full ${heightClassName} rounded-xl border border-slate-200 overflow-hidden bg-slate-100`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>اسحب الدبوس البرتقالي أو اضغط على الخريطة لتحديد الموقع بدقة</span>
        <span className="font-mono tabular-nums text-slate-600" dir="ltr">
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </span>
      </div>
    </div>
  );
}

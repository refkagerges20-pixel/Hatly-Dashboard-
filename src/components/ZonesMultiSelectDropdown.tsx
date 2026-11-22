import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';
import type { Zone } from '../types/database';

interface ZonesMultiSelectDropdownProps {
  zones: Zone[];
  selectedZoneIds: string[];
  onChange: (nextIds: string[]) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function getZoneLabel(zone?: Zone | null): string {
  if (!zone) return '';
  return zone.name_ar || zone.name || zone.zone_name || zone.title || zone.id;
}

export function ZonesMultiSelectDropdown({
  zones,
  selectedZoneIds,
  onChange,
  label = 'مناطق التوزيع',
  placeholder = 'اختر مناطق التوزيع...',
  disabled = false,
}: ZonesMultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const zoneById = useMemo(() => {
    const m = new Map<string, Zone>();
    zones.forEach((z) => m.set(z.id, z));
    return m;
  }, [zones]);

  const selectedSet = useMemo(() => new Set(selectedZoneIds), [selectedZoneIds]);

  const filteredZones = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => getZoneLabel(z).toLowerCase().includes(q));
  }, [zones, search]);

  const toggleZone = (zoneId: string) => {
    if (selectedSet.has(zoneId)) {
      onChange(selectedZoneIds.filter((id) => id !== zoneId));
    } else {
      onChange([...selectedZoneIds, zoneId]);
    }
  };

  const selectedLabels = selectedZoneIds
    .map((id) => getZoneLabel(zoneById.get(id)))
    .filter(Boolean);

  const summaryText =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
      ? selectedLabels.join('، ')
      : `${selectedLabels.slice(0, 2).join('، ')} (+${selectedLabels.length - 2})`;

  return (
    <div ref={containerRef} className="relative space-y-2">
      <label className="block text-xs font-semibold text-slate-700">
        {label}
      </label>

      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 disabled:opacity-60 text-sm text-right flex items-center justify-between gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#FF7B00]/30 focus:border-[#FF7B00]"
      >
        <span className="flex items-center gap-2 min-w-0">
          <MapPin className="w-4 h-4 text-[#FF7B00] shrink-0" />
          <span
            className={`truncate ${
              selectedLabels.length === 0
                ? 'text-slate-400'
                : 'text-[#0A192F] font-semibold'
            }`}
          >
            {summaryText}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 space-y-2 bg-slate-50">
            {zones.length > 5 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث عن منطقة..."
                  className="w-full pr-8 pl-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:border-[#FF7B00]"
                />
              </div>
            )}

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500 font-semibold">
                المحدد: {selectedZoneIds.length} / {zones.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange(zones.map((z) => z.id))}
                  className="text-[#0A192F] hover:text-[#FF7B00] font-bold cursor-pointer"
                >
                  تحديد الكل
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="text-red-600 hover:underline font-bold cursor-pointer"
                >
                  مسح الكل
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
            {filteredZones.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                {zones.length === 0
                  ? 'لا توجد مناطق مسجلة في جدول zones'
                  : 'لا توجد مناطق مطابقة للبحث'}
              </div>
            ) : (
              filteredZones.map((zone) => {
                const checked = selectedSet.has(zone.id);
                const zoneName = getZoneLabel(zone);
                return (
                  <button
                    key={zone.id}
                    type="button"
                    onClick={() => toggleZone(zone.id)}
                    className={`w-full px-3 py-2 text-right text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      checked
                        ? 'bg-orange-50/70 text-[#0A192F] font-bold'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked
                            ? 'bg-[#FF7B00] border-[#FF7B00] text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </span>
                      <span className="truncate">{zoneName}</span>
                    </span>
                    {zone.city && (
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {zone.city}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {selectedZoneIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {selectedZoneIds.map((id) => {
            const z = zoneById.get(id);
            const name = z ? getZoneLabel(z) : id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[#0A192F] text-[11px] font-semibold"
              >
                <span>{name}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleZone(id)}
                  aria-label={`إزالة ${name}`}
                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

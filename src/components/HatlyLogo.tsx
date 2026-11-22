import React from 'react';

interface HatlyLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  darkBg?: boolean;
}

export function HatlyLogo({
  className = '',
  size = 'md',
  showText = true,
  darkBg = true,
}: HatlyLogoProps) {
  const boxSize =
    size === 'lg'
      ? 'w-14 h-14'
      : size === 'sm'
      ? 'w-9 h-9'
      : 'w-11 h-11';

  const titleSize =
    size === 'lg'
      ? 'text-2xl'
      : size === 'sm'
      ? 'text-lg'
      : 'text-xl';

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      <div
        className={`${boxSize} rounded-xl bg-white p-0.5 border border-slate-200/80 shadow-xs flex items-center justify-center overflow-hidden shrink-0`}
      >
        <img
          src="/assets/aistudio/hatly-logo_d5d15672.png"
          alt="شعار هاتلي Hatly"
          className="w-full h-full object-contain"
        />
      </div>
      {showText && (
        <div className="min-w-0 leading-tight">
          <div
            className={`${titleSize} font-extrabold tracking-tight whitespace-nowrap ${
              darkBg ? 'text-white' : 'text-[#0B1A33]'
            }`}
          >
            هاتلي <span className="text-[#FF7F00]">· Hatly</span>
          </div>
          {size === 'lg' && (
            <div
              className={`text-[11px] font-semibold mt-0.5 ${
                darkBg ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              Your Order. Our Mission.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

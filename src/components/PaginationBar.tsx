import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationBarProps {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
}

function buildPageNumbers(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p += 1) {
    pages.push(p);
  }
  if (end < totalPages - 1) pages.push('ellipsis');
  pages.push(totalPages);
  return pages;
}

export function PaginationBar({
  currentPage,
  pageSize,
  totalCount,
  loading = false,
  onPageChange,
}: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const from = totalCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(totalCount, safePage * pageSize);
  const pages = buildPageNumbers(safePage, totalPages);

  return (
    <div
      dir="rtl"
      className="px-4 py-3 border-t border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 text-xs"
    >
      <div className="text-slate-600">
        عرض{' '}
        <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
          {from}
        </span>{' '}
        –{' '}
        <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
          {to}
        </span>{' '}
        من أصل{' '}
        <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
          {totalCount}
        </span>{' '}
        <span className="text-slate-400">·</span>{' '}
        <span className="text-slate-500">
          صفحة{' '}
          <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
            {safePage}
          </span>{' '}
          من{' '}
          <span className="font-mono tabular-nums font-bold text-[#0B1A33]">
            {totalPages}
          </span>
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={loading || safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-bold text-[#0B1A33] cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
        >
          <ChevronRight className="w-3.5 h-3.5" />
          <span>السابق</span>
        </button>

        <div className="hidden sm:flex items-center gap-1">
          {pages.map((item, idx) =>
            item === 'ellipsis' ? (
              <span
                key={`ellipsis-${idx}`}
                className="px-1.5 text-slate-400 font-mono"
              >
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                disabled={loading}
                onClick={() => onPageChange(item)}
                className={`min-w-[32px] h-8 px-2 rounded-lg font-mono tabular-nums text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  item === safePage
                    ? 'bg-[#0B1A33] text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {item}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          disabled={loading || safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-bold text-[#0B1A33] cursor-pointer disabled:cursor-not-allowed whitespace-nowrap shrink-0"
        >
          <span>التالي</span>
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDaysIso,
  buildGermanCalendarMonthGrid,
  formatIsoDateDe,
  getIsoWeekNumber,
  getMondayOfIsoWeek,
  getUpcomingMondayIso
} from '../utils/multiWeekPlanUtils';
import { getLocalDateIso } from '../utils/sessionPlannerUtils';

interface GermanWeekPickerProps {
  id?: string;
  value: string;
  onChange: (mondayIso: string) => void;
  weekCount?: number;
}

const GERMAN_MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
];

const WEEKDAY_HEADERS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function GermanWeekPicker({
  id,
  value,
  onChange,
  weekCount = 1
}: GermanWeekPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedMonday = useMemo(() => getMondayOfIsoWeek(value), [value]);
  const selectedWeekNumber = useMemo(
    () => getIsoWeekNumber(selectedMonday),
    [selectedMonday]
  );
  const rangeEndIso = useMemo(
    () => addDaysIso(selectedMonday, Math.max(1, weekCount) * 7 - 1),
    [selectedMonday, weekCount]
  );
  const todayIso = useMemo(() => getLocalDateIso(), []);

  const [viewYear, setViewYear] = useState(() => Number(selectedMonday.slice(0, 4)));
  const [viewMonth0, setViewMonth0] = useState(() => Number(selectedMonday.slice(5, 7)) - 1);

  useEffect(() => {
    setViewYear(Number(selectedMonday.slice(0, 4)));
    setViewMonth0(Number(selectedMonday.slice(5, 7)) - 1);
  }, [selectedMonday]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const monthGrid = useMemo(
    () => buildGermanCalendarMonthGrid(viewYear, viewMonth0),
    [viewYear, viewMonth0]
  );

  function shiftMonth(delta: -1 | 1) {
    let nextMonth = viewMonth0 + delta;
    let nextYear = viewYear;
    if (nextMonth < 0) {
      nextMonth = 11;
      nextYear -= 1;
    } else if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    setViewYear(nextYear);
    setViewMonth0(nextMonth);
  }

  function selectMonday(mondayIso: string) {
    onChange(mondayIso);
    setViewYear(Number(mondayIso.slice(0, 4)));
    setViewMonth0(Number(mondayIso.slice(5, 7)) - 1);
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs text-white transition hover:border-blue-500 focus:border-blue-500 focus:outline-none"
      >
        <span className="flex items-center gap-2 truncate">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <span className="font-semibold">
            KW {selectedWeekNumber} · {formatIsoDateDe(selectedMonday)}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 z-40 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-700 bg-slate-900 p-3.5 shadow-2xl">
          {/* Month navigation */}
          <div className="flex items-center justify-between gap-2 pb-2.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
              aria-label="Vorheriger Monat"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-xs font-bold text-white">
              {GERMAN_MONTH_NAMES[viewMonth0]} {viewYear}
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
              aria-label="Nächster Monat"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Quick-select shortcuts */}
          <div className="mb-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => selectMonday(getMondayOfIsoWeek(todayIso))}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-blue-500 hover:text-white"
            >
              Diese Woche
            </button>
            <button
              type="button"
              onClick={() => selectMonday(getUpcomingMondayIso(todayIso))}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-semibold text-blue-300 hover:border-blue-500 hover:text-white"
            >
              Nächster Montag
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-8 gap-1 pb-1 text-center text-[10px] font-bold uppercase text-slate-400">
            <div>KW</div>
            {WEEKDAY_HEADERS.map((wd) => (
              <div key={wd}>{wd}</div>
            ))}
          </div>

          {/* Week rows (clicking any day selects that week's Monday) */}
          <div className="space-y-1">
            {monthGrid.map((row) => {
              const isStartWeek = row.mondayIso === selectedMonday;
              const isInRange =
                row.mondayIso >= selectedMonday && row.mondayIso <= rangeEndIso;

              return (
                <button
                  key={row.mondayIso}
                  type="button"
                  onClick={() => selectMonday(row.mondayIso)}
                  className={`grid w-full grid-cols-8 items-center gap-1 rounded-lg px-0.5 py-1 text-center text-[11px] transition ${
                    isStartWeek
                      ? 'bg-blue-600/35 ring-1 ring-blue-500'
                      : isInRange
                        ? 'bg-blue-950/60 hover:bg-blue-600/25'
                        : 'hover:bg-blue-600/20'
                  }`}
                >
                  <span
                    className={`text-[10px] font-bold ${
                      isStartWeek ? 'text-blue-200' : 'text-slate-400'
                    }`}
                  >
                    {row.isoWeek}
                  </span>
                  {row.days.map((day) => {
                    const isToday = day.isoDate === todayIso;
                    return (
                      <span
                        key={day.isoDate}
                        className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md font-medium ${
                          isToday
                            ? 'ring-1 ring-emerald-400 font-bold text-emerald-300'
                            : isStartWeek
                              ? 'font-bold text-white'
                              : day.inCurrentMonth
                                ? 'text-slate-200'
                                : 'text-slate-500'
                        }`}
                      >
                        {day.dayOfMonth}
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>

          {/* Footer preview */}
          <div className="mt-2.5 border-t border-slate-800 pt-2 text-center text-[11px] text-slate-300">
            Start: <strong className="text-white">KW {selectedWeekNumber}</strong> ({formatIsoDateDe(selectedMonday)} – {formatIsoDateDe(rangeEndIso)})
          </div>
        </div>
      )}
    </div>
  );
}

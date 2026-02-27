import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";

interface DatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}

function DatePickerDialog({ open, onOpenChange, value, onChange }: DatePickerDialogProps) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value + "T00:00:00") : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  });
  const [selected, setSelected] = useState<Date | null>(null);

  useEffect(() => {
    if (open) {
      const d = value ? new Date(value + "T00:00:00") : new Date();
      const valid = !isNaN(d.getTime()) ? d : new Date();
      setViewMonth(valid);
      setSelected(valid);
    }
  }, [open, value]);

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const handleSelect = (day: Date) => {
    setSelected(day);
  };

  const handleOk = () => {
    if (selected) {
      onChange(format(selected, "yyyy-MM-dd"));
    }
    onOpenChange(false);
  };

  const today = new Date();
  const weekDays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] p-0 overflow-hidden rounded-2xl border-0 gap-0">
        <div className="bg-[#4a6741] px-5 py-4">
          <div className="text-white/60 text-xs font-medium uppercase tracking-wider mb-1">
            Select date
          </div>
          <div className="text-white text-2xl font-bold">
            {selected ? format(selected, "EEE, MMM d, yyyy") : "—"}
          </div>
        </div>

        <div className="bg-[#f5f0e8] px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#4a6741] hover:bg-[#4a6741]/10"
              onClick={() => setViewMonth(subMonths(viewMonth, 1))}
              data-testid="calendar-prev-month"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold text-[#2d2d2d]">
              {format(viewMonth, "MMMM yyyy")}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#4a6741] hover:bg-[#4a6741]/10"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              data-testid="calendar-next-month"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0 mb-1">
            {weekDays.map((d) => (
              <div key={d} className="text-center text-[10px] font-bold uppercase text-[#888] py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0">
            {days.map((day) => {
              const inMonth = isSameMonth(day, viewMonth);
              const isSelected = selected && isSameDay(day, selected);
              const isToday = isSameDay(day, today);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => handleSelect(day)}
                  className={`
                    w-full aspect-square flex items-center justify-center rounded-full text-sm transition-all
                    ${!inMonth ? "text-[#ccc] hover:bg-[#e0dbd0]" : ""}
                    ${inMonth && !isSelected && !isToday ? "text-[#2d2d2d] hover:bg-[#e0dbd0]" : ""}
                    ${isToday && !isSelected ? "text-[#4a6741] font-bold ring-1 ring-[#4a6741]/40" : ""}
                    ${isSelected ? "bg-[#4a6741] text-white font-bold shadow-md" : ""}
                  `}
                  data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-3">
            <Button
              type="button"
              variant="ghost"
              className="text-[#4a6741] font-medium text-sm hover:bg-[#4a6741]/10 px-3"
              onClick={() => {
                const t = new Date();
                setSelected(t);
                setViewMonth(t);
              }}
              data-testid="calendar-today-button"
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-[#4a6741] font-bold text-base hover:bg-[#4a6741]/10"
              onClick={handleOk}
              data-testid="calendar-ok-button"
            >
              OK
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "data-testid"?: string;
  className?: string;
}

export function DateInput({ value, onChange, placeholder = "Select date", "data-testid": testId, className }: DateInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const displayValue = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? format(new Date(value + "T00:00:00"), "MMM d, yyyy")
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className={`px-3 py-1.5 text-sm text-left rounded-md border border-input bg-background hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 cursor-pointer ${className || "w-full"}`}
        data-testid={testId}
      >
        {displayValue || <span className="text-muted-foreground">{placeholder}</span>}
      </button>
      <DatePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={value || format(new Date(), "yyyy-MM-dd")}
        onChange={onChange}
      />
    </>
  );
}

export { DatePickerDialog };

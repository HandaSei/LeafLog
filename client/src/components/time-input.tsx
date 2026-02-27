import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type PickerPhase = "hours" | "minutes";

const OUTER_HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const INNER_HOURS = [24, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const MINUTE_LABELS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function angleForHour(h: number): number {
  if (h === 0 || h === 12 || h === 24) return 0;
  return ((h % 12) / 12) * 360;
}

function angleForMinute(m: number): number {
  return (m / 60) * 360;
}

function posOnCircle(angleDeg: number, radius: number, cx: number, cy: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

interface ClockPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}

function ClockPickerDialog({ open, onOpenChange, value, onChange }: ClockPickerDialogProps) {
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [phase, setPhase] = useState<PickerPhase>("hours");
  const [dragging, setDragging] = useState(false);
  const clockRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (open) {
      const parts = value.split(":");
      const h = parseInt(parts[0] || "0", 10);
      const m = parseInt(parts[1] || "0", 10);
      setHours(isNaN(h) ? 0 : h);
      setMinutes(isNaN(m) ? 0 : m);
      setPhase("hours");
    }
  }, [open, value]);

  const SIZE = 280;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const OUTER_R = 110;
  const INNER_R = 75;
  const MINUTE_R = 110;

  const getAngleFromEvent = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!clockRef.current) return null;
    const rect = clockRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left - rect.width / 2;
    const y = clientY - rect.top - rect.height / 2;
    const dist = Math.sqrt(x * x + y * y);
    let angle = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    return { angle, dist };
  }, []);

  const selectFromAngle = useCallback((angle: number, dist: number) => {
    if (phase === "hours") {
      const sector = Math.round(angle / 30) % 12;
      const isInner = dist < (OUTER_R + INNER_R) / 2 * (280 / SIZE);
      if (isInner) {
        const h = INNER_HOURS[sector];
        setHours(h === 24 ? 0 : h);
      } else {
        setHours(OUTER_HOURS[sector]);
      }
    } else {
      const exactMinute = Math.round(angle / 6) % 60;
      setMinutes(exactMinute);
    }
  }, [phase]);

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const result = getAngleFromEvent(e);
    if (!result) return;
    setDragging(true);
    selectFromAngle(result.angle, result.dist);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragging) return;
    const result = getAngleFromEvent(e);
    if (!result) return;
    selectFromAngle(result.angle, result.dist);
  };

  const handlePointerUp = () => {
    if (dragging) {
      setDragging(false);
      if (phase === "hours") {
        setTimeout(() => setPhase("minutes"), 200);
      }
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const up = () => {
      setDragging(false);
      if (phase === "hours") {
        setTimeout(() => setPhase("minutes"), 200);
      }
    };
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, [dragging, phase]);

  const handleOk = () => {
    const hh = hours.toString().padStart(2, "0");
    const mm = minutes.toString().padStart(2, "0");
    onChange(`${hh}:${mm}`);
    onOpenChange(false);
  };

  const currentAngle = phase === "hours" ? angleForHour(hours) : angleForMinute(minutes);
  const isInnerHour = phase === "hours" && (hours === 0 || (hours >= 13 && hours <= 23));
  const handLength = phase === "hours" ? (isInnerHour ? INNER_R : OUTER_R) : MINUTE_R;
  const handEnd = posOnCircle(currentAngle, handLength, CX, CY);

  const displayHours = hours.toString().padStart(2, "0");
  const displayMinutes = minutes.toString().padStart(2, "0");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[320px] p-0 overflow-hidden rounded-2xl border-0 gap-0">
        <div className="bg-[#4a6741] px-6 py-5 flex items-center justify-center">
          <div className="flex items-baseline gap-0">
            <button
              type="button"
              onClick={() => setPhase("hours")}
              className={`text-5xl font-bold tracking-tight transition-opacity ${phase === "hours" ? "text-white opacity-100" : "text-white/50 opacity-70"}`}
              data-testid="clock-select-hours"
            >
              {displayHours}
            </button>
            <span className={`text-5xl font-bold ${phase === "hours" ? "text-white" : "text-white/50"}`}>:</span>
            <button
              type="button"
              onClick={() => setPhase("minutes")}
              className={`text-5xl font-bold tracking-tight transition-opacity ${phase === "minutes" ? "text-white opacity-100" : "text-white/50 opacity-70"}`}
              data-testid="clock-select-minutes"
            >
              {displayMinutes}
            </button>
          </div>
        </div>

        <div className="bg-[#f5f0e8] px-4 pt-6 pb-4 flex flex-col items-center relative">
          <svg
            ref={clockRef}
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="select-none cursor-pointer"
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            data-testid="clock-face"
          >
            <circle cx={CX} cy={CY} r={CX - 4} fill="transparent" stroke="#c4a96a" strokeWidth={1.5} />

            <line
              x1={CX}
              y1={CY}
              x2={handEnd.x}
              y2={handEnd.y}
              stroke="#c4a96a"
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle cx={CX} cy={CY} r={4} fill="#c4a96a" />
            <circle cx={handEnd.x} cy={handEnd.y} r={18} fill="#c4a96a" opacity={0.85} />

            {phase === "hours" ? (
              <>
                {OUTER_HOURS.map((h, i) => {
                  const angle = (i / 12) * 360;
                  const pos = posOnCircle(angle, OUTER_R, CX, CY);
                  const isSelected = hours === h;
                  return (
                    <text
                      key={`outer-${h}`}
                      x={pos.x}
                      y={pos.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="pointer-events-none"
                      fill={isSelected ? "white" : "#2d2d2d"}
                      fontSize={18}
                      fontWeight={isSelected ? "700" : "500"}
                    >
                      {h}
                    </text>
                  );
                })}
                {INNER_HOURS.map((h, i) => {
                  const angle = (i / 12) * 360;
                  const pos = posOnCircle(angle, INNER_R, CX, CY);
                  const displayH = h === 24 ? 0 : h;
                  const isSelected = hours === displayH || (h === 24 && hours === 0);
                  return (
                    <text
                      key={`inner-${h}`}
                      x={pos.x}
                      y={pos.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="pointer-events-none"
                      fill={isSelected ? "white" : "#666"}
                      fontSize={13}
                      fontWeight={isSelected ? "700" : "400"}
                    >
                      {h === 24 ? "00" : h}
                    </text>
                  );
                })}
              </>
            ) : (
              <>
                {Array.from({ length: 60 }, (_, i) => i).map((m) => {
                  const angle = (m / 60) * 360;
                  const isLabel = m % 5 === 0;
                  const isSelected = minutes === m;
                  if (isLabel) {
                    const pos = posOnCircle(angle, MINUTE_R, CX, CY);
                    return (
                      <text
                        key={`min-${m}`}
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="pointer-events-none"
                        fill={isSelected ? "white" : "#2d2d2d"}
                        fontSize={16}
                        fontWeight={isSelected ? "700" : "500"}
                      >
                        {m.toString().padStart(2, "0")}
                      </text>
                    );
                  }
                  const tickOuter = posOnCircle(angle, MINUTE_R + 18, CX, CY);
                  const tickInner = posOnCircle(angle, MINUTE_R + 14, CX, CY);
                  return (
                    <line
                      key={`tick-${m}`}
                      x1={tickInner.x}
                      y1={tickInner.y}
                      x2={tickOuter.x}
                      y2={tickOuter.y}
                      stroke={isSelected ? "#c4a96a" : "#ccc"}
                      strokeWidth={isSelected ? 2 : 1}
                      className="pointer-events-none"
                    />
                  );
                })}
                {minutes % 5 !== 0 && (
                  <text
                    x={CX}
                    y={CY + 42}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="pointer-events-none"
                    fill="#4a6741"
                    fontSize={13}
                    fontWeight="600"
                  >
                    :{minutes.toString().padStart(2, "0")}
                  </text>
                )}
              </>
            )}
          </svg>

          <div className="w-full flex justify-end mt-3">
            <Button
              type="button"
              variant="ghost"
              className="text-[#4a6741] font-bold text-base hover:bg-[#4a6741]/10"
              onClick={handleOk}
              data-testid="clock-ok-button"
            >
              OK
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "data-testid"?: string;
}

export function TimeInput({ value, onChange, placeholder = "HH:MM", "data-testid": testId }: TimeInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="w-20 px-2.5 py-1.5 text-sm font-mono text-center rounded-md border border-input bg-background hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 cursor-pointer"
        data-testid={testId}
      >
        {value && /^\d{2}:\d{2}$/.test(value) ? value : <span className="text-muted-foreground">{placeholder}</span>}
      </button>
      <ClockPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={value || "00:00"}
        onChange={onChange}
      />
    </>
  );
}

interface TimeRangeInputProps {
  startValue: string;
  endValue: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  startTestId?: string;
  endTestId?: string;
}

export function TimeRangeInput({ startValue, endValue, onStartChange, onEndChange, startTestId, endTestId }: TimeRangeInputProps) {
  return (
    <div className="flex items-center gap-2">
      <TimeInput value={startValue} onChange={onStartChange} data-testid={startTestId} />
      <span className="text-sm text-muted-foreground font-medium select-none">to</span>
      <TimeInput value={endValue} onChange={onEndChange} data-testid={endTestId} />
    </div>
  );
}

export { ClockPickerDialog };

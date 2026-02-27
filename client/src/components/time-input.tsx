import { useState, useRef, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Check } from "lucide-react";
import { format } from "date-fns";

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "data-testid"?: string;
}

export function ClockPicker({ value, onChange, isOpen, onClose }: { value: string, onChange: (v: string) => void, isOpen: boolean, onClose: () => void }) {
  const [mode, setMode] = useState<"hours" | "minutes">("hours");
  const [tempHours, setTempHours] = useState(() => {
    const [h] = value.split(":");
    return isNaN(parseInt(h)) ? 12 : parseInt(h);
  });
  const [tempMinutes, setTempMinutes] = useState(() => {
    const [, m] = value.split(":");
    return isNaN(parseInt(m)) ? 0 : parseInt(m);
  });

  useEffect(() => {
    if (isOpen) {
      const [h, m] = value.split(":");
      setTempHours(isNaN(parseInt(h)) ? 12 : parseInt(h));
      setTempMinutes(isNaN(parseInt(m)) ? 0 : parseInt(m));
      setMode("hours");
    }
  }, [isOpen, value]);

  const handleSelectHour = (h: number) => {
    setTempHours(h);
    setMode("minutes");
  };

  const handleSelectMinute = (m: number) => {
    setTempMinutes(m);
  };

  const handleConfirm = () => {
    const hh = tempHours.toString().padStart(2, "0");
    const mm = tempMinutes.toString().padStart(2, "0");
    onChange(`${hh}:${mm}`);
    onClose();
  };

  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const innerHours = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 overflow-hidden max-w-[320px] rounded-2xl border-none shadow-2xl">
        <div className="bg-[#2D4F2D] p-6 text-white text-center relative">
          <button onClick={onClose} className="absolute right-4 top-4 hover:opacity-80">
            <X className="w-5 h-5" />
          </button>
          <div className="text-5xl font-light tracking-tight flex justify-center items-center gap-1">
            <button 
              onClick={() => setMode("hours")}
              className={`hover:opacity-80 transition-opacity ${mode === "hours" ? "opacity-100" : "opacity-50"}`}
            >
              {tempHours.toString().padStart(2, "0")}
            </button>
            <span>:</span>
            <button 
              onClick={() => setMode("minutes")}
              className={`hover:opacity-80 transition-opacity ${mode === "minutes" ? "opacity-100" : "opacity-50"}`}
            >
              {tempMinutes.toString().padStart(2, "0")}
            </button>
          </div>
        </div>

        <div className="bg-[#F9F6F0] p-8 relative flex items-center justify-center aspect-square select-none">
          {/* Background pattern placeholder - decorative leaves */}
          <div className="absolute inset-0 opacity-5 pointer-events-none overflow-hidden">
             <div className="absolute top-0 left-0 w-32 h-32 rotate-45 transform -translate-x-10 -translate-y-10 bg-primary rounded-full blur-3xl" />
             <div className="absolute bottom-0 right-0 w-32 h-32 -rotate-45 transform translate-x-10 translate-y-10 bg-primary rounded-full blur-3xl" />
          </div>

          <div className="w-full h-full rounded-full border-[1px] border-[#D4C4A8] relative">
            {/* Center dot */}
            <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-[#D4C4A8] rounded-full -translate-x-1/2 -translate-y-1/2 z-10" />
            
            {/* Needle */}
            {(() => {
              const val = mode === "hours" ? tempHours : tempMinutes;
              const isInner = mode === "hours" && (val === 0 || val >= 13);
              const totalItems = mode === "hours" ? 12 : 60;
              const angle = ((mode === "hours" ? (val % 12) : val) * (360 / totalItems)) - 90;
              const length = isInner ? "35%" : "42%";
              
              return (
                <div 
                  className="absolute top-1/2 left-1/2 origin-left bg-[#D4C4A8] h-0.5 transition-all duration-200"
                  style={{ 
                    width: length,
                    transform: `rotate(${angle}deg) translateY(-50%)`,
                  }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-8 h-8 rounded-full bg-[#D4C4A8]/30 border-2 border-[#D4C4A8] flex items-center justify-center shadow-sm">
                    <div className="w-6 h-6 rounded-full bg-[#D4C4A8] flex items-center justify-center">
                       <span className="text-[10px] text-[#2D4F2D] font-bold">{val}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {mode === "hours" ? (
              <>
                {/* Outer hours 1-12 */}
                {hours.map((h, i) => {
                  const angle = (i * 30) - 90;
                  return (
                    <button
                      key={`outer-${h}`}
                      onClick={() => handleSelectHour(h)}
                      className="absolute w-8 h-8 flex items-center justify-center text-sm font-medium hover:text-primary transition-colors rounded-full hover:bg-primary/5"
                      style={{
                        top: `calc(50% + ${Math.sin(angle * Math.PI / 180) * 42}%)`,
                        left: `calc(50% + ${Math.cos(angle * Math.PI / 180) * 42}%)`,
                        transform: "translate(-50%, -50%)"
                      }}
                    >
                      {h}
                    </button>
                  );
                })}
                {/* Inner hours 13-00 */}
                {innerHours.map((h, i) => {
                  const angle = (i * 30) - 90;
                  return (
                    <button
                      key={`inner-${h}`}
                      onClick={() => handleSelectHour(h)}
                      className="absolute w-6 h-6 flex items-center justify-center text-[10px] text-muted-foreground hover:text-primary transition-colors rounded-full hover:bg-primary/5"
                      style={{
                        top: `calc(50% + ${Math.sin(angle * Math.PI / 180) * 28}%)`,
                        left: `calc(50% + ${Math.cos(angle * Math.PI / 180) * 28}%)`,
                        transform: "translate(-50%, -50%)"
                      }}
                    >
                      {h === 0 ? "00" : h}
                    </button>
                  );
                })}
              </>
            ) : (
              /* Minutes */
              minutes.map((m, i) => {
                const angle = (i * 30) - 90;
                return (
                  <button
                    key={`min-${m}`}
                    onClick={() => handleSelectMinute(m)}
                    className="absolute w-8 h-8 flex items-center justify-center text-sm font-medium hover:text-primary transition-colors rounded-full hover:bg-primary/5"
                    style={{
                      top: `calc(50% + ${Math.sin(angle * Math.PI / 180) * 42}%)`,
                      left: `calc(50% + ${Math.cos(angle * Math.PI / 180) * 42}%)`,
                      transform: "translate(-50%, -50%)"
                    }}
                  >
                    {m.toString().padStart(2, "0")}
                  </button>
                );
              })
            )}
          </div>

          <div className="absolute bottom-4 right-6">
            <button 
              onClick={handleConfirm}
              className="text-[#2D4F2D] font-bold text-sm hover:opacity-70 transition-opacity uppercase tracking-widest"
            >
              OK
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TimeInput({ value, onChange, placeholder = "HH:MM", "data-testid": testId }: TimeInputProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-testid={testId}
        className="w-20 px-2.5 py-1.5 text-sm font-mono text-center rounded-md border border-input bg-background hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      >
        {value || placeholder}
      </button>
      
      <ClockPicker 
        value={value} 
        onChange={onChange} 
        isOpen={isOpen} 
        onClose={() => setIsOpen(false)} 
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

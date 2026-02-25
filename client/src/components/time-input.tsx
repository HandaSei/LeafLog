import { useState, useRef, useEffect } from "react";

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "data-testid"?: string;
}

function generateSuggestions(partial: string): string[] {
  if (!partial) return [];

  const parts = partial.split(":");
  const hourStr = parts[0] || "";
  const minStr = parts[1];

  if (minStr !== undefined) {
    const hour = parseInt(hourStr, 10);
    if (isNaN(hour) || hour < 0 || hour > 23) return [];
    const hh = hour.toString().padStart(2, "0");

    if (minStr === "") {
      return ["00", "15", "30", "45"].map(m => `${hh}:${m}`);
    }

    const suggestions: string[] = [];
    for (let m = 0; m < 60; m += 5) {
      const mm = m.toString().padStart(2, "0");
      if (mm.startsWith(minStr)) {
        suggestions.push(`${hh}:${mm}`);
      }
    }
    if (minStr.length === 2) {
      const exactMin = parseInt(minStr, 10);
      if (exactMin >= 0 && exactMin < 60) {
        const exact = `${hh}:${minStr.padStart(2, "0")}`;
        if (!suggestions.includes(exact)) suggestions.unshift(exact);
      }
    }
    return suggestions.slice(0, 5);
  }

  if (hourStr.length === 0) return [];

  const suggestions: string[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = h.toString().padStart(2, "0");
    if (hh.startsWith(hourStr.padStart(2, "0")) || h.toString().startsWith(hourStr)) {
      suggestions.push(`${hh}:00`, `${hh}:15`, `${hh}:30`, `${hh}:45`);
    }
  }
  return suggestions.slice(0, 5);
}

export function TimeInput({ value, onChange, placeholder = "HH:MM", "data-testid": testId }: TimeInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = generateSuggestions(inputValue);

  const handleInputChange = (raw: string) => {
    let cleaned = raw.replace(/[^0-9:]/g, "");
    if (cleaned.length === 2 && !cleaned.includes(":") && inputValue.length < cleaned.length) {
      cleaned = cleaned + ":";
    }
    if (cleaned.length > 5) cleaned = cleaned.slice(0, 5);
    setInputValue(cleaned);
    setShowSuggestions(true);
    setHighlightIndex(0);
    if (/^\d{2}:\d{2}$/.test(cleaned)) {
      const [h, m] = cleaned.split(":").map(Number);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        onChange(cleaned);
      }
    }
  };

  const selectSuggestion = (s: string) => {
    setInputValue(s);
    onChange(s);
    setShowSuggestions(false);
    setHighlightIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        selectSuggestion(suggestions[highlightIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={inputValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => { setShowSuggestions(true); setHighlightIndex(0); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
        className="w-20 px-2.5 py-1.5 text-sm font-mono text-center rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 placeholder:text-muted-foreground"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 min-w-[80px] bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm font-mono transition-colors
                ${i === 0 && highlightIndex === 0
                  ? "text-primary font-semibold bg-primary/8"
                  : i === highlightIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/60 text-foreground"}`}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
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

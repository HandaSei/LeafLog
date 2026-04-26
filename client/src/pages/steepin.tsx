import { memo, useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRefreshOnVisibility } from "@/hooks/use-refresh-on-visibility";
import { useEntriesSync } from "@/hooks/use-entries-sync";
import { useLocation } from "wouter";
import { format } from "date-fns";
import type { Employee, TimeEntry } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import {
  addToQueue,
  shouldQueueAction,
  processQueue,
  getQueue,
  cacheEntries,
  getCachedEntries,
} from "@/lib/offline-queue";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Clock, LogIn, LogOut, Coffee, ArrowLeft, Search, Timer, CheckCircle2, Info, StickyNote, WifiOff, CloudUpload, RefreshCw, Delete,
} from "lucide-react";

const STEEPIN_CACHE_KEY = "leaflog_steepin_employees";
const THEME_CACHE_KEY = "leaflog_steepin_theme";
const STEEPIN_AUTH_CACHE_KEY = "leaflog_steepin_auth";

interface SteepinTheme {
  mode: "light" | "dark" | "auto";
  dayStartHour: number;
  nightStartHour: number;
}

function getCachedTheme(): SteepinTheme {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { mode: "light", dayStartHour: 7, nightStartHour: 19 };
}

function resolveTheme(settings: SteepinTheme): "light" | "dark" {
  if (settings.mode === "light") return "light";
  if (settings.mode === "dark") return "dark";
  const hour = new Date().getHours();
  const { dayStartHour, nightStartHour } = settings;
  if (dayStartHour < nightStartHour) {
    return hour >= dayStartHour && hour < nightStartHour ? "light" : "dark";
  }
  return hour >= dayStartHour || hour < nightStartHour ? "light" : "dark";
}

const THEME_COLORS = {
  light: {
    bg: "#F0EDE6",
    bgImage: "/steepin-bg-watercolor.webp",
    cardBgImage: "/employee-card-bg.webp",
    initials: "#3D5038",
    name: "#111111",
    role: "#3D5038",
    headerText: "#3D5038",
    timeText: "#3D5038",
    searchBg: "bg-white/60",
    searchBorder: "border-[#C5C5C5]",
    searchPlaceholder: "placeholder:text-[#7A7A7A]",
    searchFocusBg: "focus:bg-white/80",
    buttonBg: "bg-white/60",
    buttonBorder: "border-[#4A5D45]/30",
    buttonText: "text-[#3D5038]",
    buttonHoverBg: "hover:bg-[#4A5D45]/10",
    buttonHoverText: "hover:text-[#2E3F2B]",
    exitBg: "bg-[#8B2635]/5",
    exitBorder: "border-[#8B2635]/25",
    exitText: "text-[#8B2635]",
    exitHoverBg: "hover:bg-[#8B2635]/10",
    exitHoverText: "hover:text-[#7A1F2D]",
    shiftBg: "bg-white/70",
    shiftBorder: "border-[#8B9E8B]/25",
    shiftLabel: "#3D5038",
    entryName: "#1A1A1A",
    entryTime: "#5A5A5A",
    managerBg: "bg-white/70",
    managerBorder: "border-[#8B6BAD]/20",
    managerLabel: "#5A3D7A",
    dialogBg: "bg-[#F5F5F0]",
    dialogTitle: "#1A1A1A",
    dialogDesc: "#8C8C8C",
    pinDot: "bg-[#4A5D45]",
    pinPlaceholder: "#6B6B6B",
    pinBtnBg: "bg-white",
    pinBtnBorder: "border-[#C5C5C5]",
    pinBtnText: "#1A1A1A",
    pinBtnHover: "[@media(hover:hover)]:hover:bg-[#F5F5F0]",
    pinBackText: "#6B6B6B",
    actionBtnBg: "bg-white/80",
    actionBtnBorder: "border-[#8B9E8B]/40",
    actionBtnText: "text-[#3D5038]",
    actionBtnHoverBg: "hover:bg-white/90",
    actionBtnHoverBorder: "hover:border-[#4A5D45]/50",
    confirmBtnBg: "bg-[#4A5D45]",
    confirmBtnHover: "hover:bg-[#3A4D35]",
    noteInputBg: "bg-white/50",
    noteInputBorder: "border-[#D9D9D9]",
    noteLabelColor: "#4A5D45",
    skeletonBg: "bg-white/40",
    skeletonCardBg: "bg-white/30",
    offlineAmberBg: "bg-amber-100",
    offlineAmberText: "text-amber-800",
    offlineAmberBorder: "border-amber-300",
    offlineSyncBg: "bg-blue-50",
    offlineSyncText: "text-blue-700",
    offlineSyncBorder: "border-blue-200",
    leafNameDisplay: "#1A1A1A",
    leafRoleDisplay: "#5A6B55",
    cardShadow: "shadow-[0_2px_12px_rgba(0,0,0,0.08)]",
    cardHoverShadow: "hover:shadow-[0_8px_28px_rgba(0,0,0,0.14)]",
    cardBorderColor: "border-black/8",
  },
  dark: {
    bg: "#1F1A17",
    bgImage: "/steepin-bg-watercolor-dark.webp",
    cardBgImage: "/employee-card-bg-dark.webp",
    initials: "#D4A574",
    name: "#E8E4E0",
    role: "#B8956E",
    headerText: "#D4A574",
    timeText: "#B8956E",
    searchBg: "bg-[#2A2220]/80",
    searchBorder: "border-[#5A4035]",
    searchPlaceholder: "placeholder:text-[#7B6B5B]",
    searchFocusBg: "focus:bg-[#2A2220]",
    buttonBg: "bg-[#2A2220]/60",
    buttonBorder: "border-[#6B4A35]/40",
    buttonText: "text-[#D4A574]",
    buttonHoverBg: "hover:bg-[#3A2E28]/60",
    buttonHoverText: "hover:text-[#E0B888]",
    exitBg: "bg-[#3D1A1A]/40",
    exitBorder: "border-[#8B2635]/30",
    exitText: "text-[#E88090]",
    exitHoverBg: "hover:bg-[#4D2A2A]/50",
    exitHoverText: "hover:text-[#F0A0B0]",
    shiftBg: "bg-[#2A2220]/70",
    shiftBorder: "border-[#6B4A35]/30",
    shiftLabel: "#B8956E",
    entryName: "#E0E0E0",
    entryTime: "#8B7B6B",
    managerBg: "bg-[#2A2840]/60",
    managerBorder: "border-[#6B5BAD]/25",
    managerLabel: "#B8A8D8",
    dialogBg: "bg-[#252018]",
    dialogTitle: "#E8E4E0",
    dialogDesc: "#7B6B5B",
    pinDot: "bg-[#B8956E]",
    pinPlaceholder: "#7B6B5B",
    pinBtnBg: "bg-[#2A2220]",
    pinBtnBorder: "border-[#5A4035]",
    pinBtnText: "#D8D0C8",
    pinBtnHover: "[@media(hover:hover)]:hover:bg-[#3A2E28]",
    pinBackText: "#7B6B5B",
    actionBtnBg: "bg-[#2A2220]/80",
    actionBtnBorder: "border-[#6B4A35]/40",
    actionBtnText: "text-[#D4A574]",
    actionBtnHoverBg: "hover:bg-[#3A2E28]/80",
    actionBtnHoverBorder: "hover:border-[#8B6045]/60",
    confirmBtnBg: "bg-[#6B4A35]",
    confirmBtnHover: "hover:bg-[#7B5A45]",
    noteInputBg: "bg-[#2A2220]/60",
    noteInputBorder: "border-[#5A4035]",
    noteLabelColor: "#B8956E",
    skeletonBg: "bg-[#2A2220]/60",
    skeletonCardBg: "bg-[#2A2220]/40",
    offlineAmberBg: "bg-amber-900/40",
    offlineAmberText: "text-amber-300",
    offlineAmberBorder: "border-amber-700",
    offlineSyncBg: "bg-blue-900/30",
    offlineSyncText: "text-blue-300",
    offlineSyncBorder: "border-blue-700",
    leafNameDisplay: "#E8E4E0",
    leafRoleDisplay: "#D4A574",
    cardShadow: "shadow-[0_2px_12px_rgba(0,0,0,0.3)]",
    cardHoverShadow: "hover:shadow-[0_8px_28px_rgba(0,0,0,0.5)]",
    cardBorderColor: "border-white/8",
  },
} as const;

// Pre-seed query cache from localStorage synchronously at module load.
// Return visits show employees with zero wait — no skeleton needed.
try {
  const raw = localStorage.getItem(STEEPIN_CACHE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      queryClient.setQueryData(["/api/steepin/employees"], parsed);
    }
  }
} catch {}


// Performance Optimization: Memoized Background
const BackgroundVector = memo(({ isDark }: { isDark: boolean }) => {
  const t = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
  return (
    <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
      <img
        src={t.bgImage}
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-center"
        style={{ minWidth: "100%", minHeight: "100%" }}
        draggable={false}
        fetchPriority="high"
        loading="eager"
      />
      {isDark && (
        <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.15)" }} />
      )}
    </div>
  );
});
BackgroundVector.displayName = "BackgroundVector";

const EmployeeCard = memo(({ emp, onClick, isDark, isMobile = false }: { emp: Employee; onClick: (e: Employee) => void; isDark: boolean; isMobile?: boolean }) => {
  const initial = emp.name.charAt(0).toUpperCase();
  const borderColor = isDark ? "rgba(170,100,55,0.75)" : "rgba(70,110,65,0.65)";
  const circleBorder = isDark ? "rgba(180,110,60,0.8)" : "rgba(70,110,65,0.7)";
  const glassBg = isDark ? "rgba(40,28,20,0.68)" : "rgba(242,247,238,0.76)";
  const nameColor = isDark ? "#F0E0CC" : "#2E4028";
  const defaultSubtitleColor = isDark ? "#E0A860" : "#4A7245";
  const initialColor = isDark ? "#EEBC80" : "#2E4028";
  const hasRole = !!(emp.role && emp.role.trim());
  const subtitleText = hasRole ? emp.role : "Loose leaf";
  const subtitleColor = hasRole ? (emp.color || defaultSubtitleColor) : defaultSubtitleColor;

  if (isMobile) {
    return (
      <button
        onClick={() => onClick(emp)}
        className="group w-full flex items-center gap-4 px-5 py-4 rounded-xl transition-colors duration-150 active:scale-[0.98]"
        style={{ backgroundColor: glassBg, border: `1.5px solid ${borderColor}` }}
        data-testid={`card-employee-${emp.id}`}
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
          style={{ border: `1.5px solid ${circleBorder}`, backgroundColor: "transparent" }}
        >
          <span className="text-xl font-light tracking-wide" style={{ color: initialColor, fontFamily: "Georgia, 'Times New Roman', serif" }}>{initial}</span>
        </div>
        <div className="text-left min-w-0">
          <h3 className="text-base font-medium tracking-wide truncate" style={{ color: nameColor }}>{emp.name}</h3>
          <p className="text-sm font-light tracking-wider" style={{ color: subtitleColor }}>{subtitleText}</p>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onClick(emp)}
      className="group relative w-full rounded-xl transition-[transform,background-color] duration-150 active:scale-[0.97] hover:scale-[1.02] transform-gpu"
      style={{ backgroundColor: glassBg, border: `1.5px solid ${borderColor}`, height: 'clamp(9rem, 32vh, 17rem)' }}
      data-testid={`card-employee-${emp.id}`}
    >
      <div className="h-full w-full flex flex-col items-center justify-center"
        style={{ gap: 'clamp(0.2rem, 1.5vh, 1rem)', padding: 'clamp(0.5rem, 2vh, 1.25rem)' }}>
        <div
          className="rounded-full flex items-center justify-center shrink-0"
          style={{
            width: 'clamp(3rem, 17vh, 6rem)',
            height: 'clamp(3rem, 17vh, 6rem)',
            border: `1.5px solid ${circleBorder}`,
            backgroundColor: "transparent",
          }}
        >
          <span style={{ fontSize: 'clamp(1.1rem, 7vh, 2.5rem)', color: initialColor, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 300, letterSpacing: '0.05em' }}>{initial}</span>
        </div>
        <div className="text-center shrink-0">
          <h3 style={{ fontSize: 'clamp(0.7rem, 3.5vh, 1.1rem)', color: nameColor, fontWeight: 500, letterSpacing: '0.05em', lineHeight: 1.2, margin: 0 }}>
            {emp.name}
          </h3>
          <p style={{ fontSize: 'clamp(0.6rem, 2.5vh, 0.82rem)', color: subtitleColor, fontWeight: 300, letterSpacing: '0.1em', marginTop: '0.2em' }}>
            {subtitleText}
          </p>
        </div>
      </div>
    </button>
  );
});
EmployeeCard.displayName = "EmployeeCard";

const SteepInLoadingMark = memo(({ isDark }: { isDark: boolean }) => {
  return (
    <div
      className="w-10 h-10 rounded-full animate-spin"
      style={{
        border: `3px solid ${isDark ? "rgba(180,110,60,0.24)" : "rgba(90,120,85,0.22)"}`,
        borderTopColor: isDark ? "#D4A574" : "#5A7855",
      }}
    />
  );
});
SteepInLoadingMark.displayName = "SteepInLoadingMark";

const PinPad = memo(({ value, onChange, maxLength = 6, isDark = false }: { value: string; onChange: (v: string) => void; maxLength?: number; isDark?: boolean }) => {
  const t = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
  const press = (d: string) => { 
    if (value.length < maxLength) {
      onChange(value + d);
      if (typeof window !== "undefined" && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(10);
      }
    }
  };
  const back = () => {
    onChange(value.slice(0, -1));
    if (typeof window !== "undefined" && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(5);
    }
  };
  return (
    <div className="flex flex-col items-center gap-6 py-4 select-none">
      <div className="flex gap-4 h-4 items-center">
        {Array.from({ length: value.length }, (_, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full ${t.pinDot} animate-in zoom-in duration-200`}
          />
        ))}
        {value.length === 0 && (
          <span className="text-sm font-light italic animate-pulse tracking-widest uppercase" style={{ color: t.pinPlaceholder }}>Enter Passcode</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className={`w-20 h-16 rounded-2xl border ${t.pinBtnBorder} ${t.pinBtnBg} text-2xl font-light ${t.pinBtnHover} active:scale-90 transition-[transform,background-color] duration-75 shadow-sm flex items-center justify-center`}
            style={{ color: t.pinBtnText }}
          >
            {d}
          </button>
        ))}
        <div />
        <button
          key="0"
          type="button"
          onClick={() => press("0")}
          className={`w-20 h-16 rounded-2xl border ${t.pinBtnBorder} ${t.pinBtnBg} text-2xl font-light ${t.pinBtnHover} active:scale-90 transition-[transform,background-color] duration-75 shadow-sm flex items-center justify-center`}
          style={{ color: t.pinBtnText }}
        >
          0
        </button>
        <button
          key="back"
          type="button"
          onClick={back}
          className={`w-20 h-16 rounded-2xl border ${t.pinBtnBorder} ${t.pinBtnBg} ${t.pinBtnHover} active:scale-90 transition-[transform,background-color] duration-75 shadow-sm flex items-center justify-center`}
          style={{ color: t.pinBackText }}
        >
          <Delete className="w-8 h-8" />
        </button>
      </div>
    </div>
  );
});
PinPad.displayName = "PinPad";

interface BreakPolicy {
  paidBreakMinutes: number | null;
  maxBreakMinutes: number | null;
}

type ActionType = "clock-in" | "clock-out" | "break-start" | "break-end";

export default function SteepInPage() {
  const { data: authState, isLoading: authLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const { exitSteepIn } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [passcode, setPasscode] = useState("");
  const [passcodeDialogOpen, setPasscodeDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitUsername, setExitUsername] = useState("");
  const [exitPassword, setExitPassword] = useState("");
  const [noteText, setNoteText] = useState("");
  const [reClockData, setReClockData] = useState<{ lastClockOutTime: string; lastClockOutId: number; lastClockOutDate: string; minutesSince: number } | null>(null);
  const [reClockDialogOpen, setReClockDialogOpen] = useState(false);
  const [reClockPasscode, setReClockPasscode] = useState("");
  const [deviceLocked, setDeviceLocked] = useState(true);
  const [introDialogOpen, setIntroDialogOpen] = useState(false);
  const lockPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const lastMutationTsRef = useRef<number>(0);

  const [liveTime, setLiveTime] = useState(() => format(new Date(), "HH:mm"));
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const scheduleNext = () => {
      const now = new Date();
      const msUntilNextMinute =
        60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
      timeoutId = setTimeout(() => {
        setLiveTime(format(new Date(), "HH:mm"));
        scheduleNext();
      }, msUntilNextMinute);
    };
    scheduleNext();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const [themeSettings] = useState<SteepinTheme>(getCachedTheme);
  const [isDark, setIsDark] = useState(() => resolveTheme(getCachedTheme()) === "dark");

  useEffect(() => {
    if (themeSettings.mode !== "auto") {
      setIsDark(resolveTheme(themeSettings) === "dark");
      return;
    }
    const check = () => setIsDark(resolveTheme(themeSettings) === "dark");
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [themeSettings]);

  const t = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
  const [softenInitialPaint, setSoftenInitialPaint] = useState(true);
  const initialPaintClass = softenInitialPaint ? " steepin-initial-appear" : "";

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSoftenInitialPaint(false), 220);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const user = authState?.user;
  const isActive = !!authState?.authenticated && !!authState?.steepinMode;

  const { data: employees, isLoading: empsLoading } = useQuery<Employee[]>({
    queryKey: ["/api/steepin/employees"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/steepin/employees");
      if (!res.ok) throw new Error("Failed to fetch employees");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: isActive,
    initialData: authState?.employees,
    staleTime: 300000,
  });

  const hasEmployees = !!(employees && employees.length > 0);

  const { 
    data: entries = [], 
    isLoading: entriesLoading, 
    isFetching: entriesFetching,
    refetch: refetchEntries,
    dataUpdatedAt: entriesUpdatedAt,
  } = useQuery<TimeEntry[]>({
    queryKey: ["/api/steepin/entries", selectedEmployee?.id?.toString() || ""],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isActive && !!selectedEmployee,
    initialData: () => {
      if (selectedEmployee && authState?.steepinEntries) {
        return authState.steepinEntries[selectedEmployee.id.toString()];
      }
      if (selectedEmployee) {
        return getCachedEntries(selectedEmployee.id) as TimeEntry[] | undefined;
      }
      return undefined;
    },
    staleTime: 60000,
    // Retry failed fetches when coming back online
    retry: (failureCount, error: any) => {
      // Don't retry if offline - will be handled by visibility/online handlers
      if (!navigator.onLine) return false;
      // Retry up to 3 times when online
      return failureCount < 3;
    },
    retryDelay: 1000,
  });

  const { data: breakPolicy } = useQuery<BreakPolicy>({
    queryKey: ["/api/settings/break-policy"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: isActive,
  });

  // Persist fresh employees to localStorage so next visit is instant
  useEffect(() => {
    if (employees && Array.isArray(employees) && employees.length > 0) {
      try {
        localStorage.setItem(STEEPIN_CACHE_KEY, JSON.stringify(employees));
      } catch {}
    }
  }, [employees]);

  // Persist auth state so offline reloads keep SteepIn mode active
  useEffect(() => {
    if (authState?.authenticated && authState?.steepinMode) {
      try {
        localStorage.setItem(STEEPIN_AUTH_CACHE_KEY, JSON.stringify(authState));
      } catch {}
    }
  }, [authState]);

  useEffect(() => {
    if (selectedEmployee) {
      cacheEntries(selectedEmployee.id, entries);
    }
  }, [selectedEmployee, entries]);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(() => getQueue().length);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Refresh entries when app becomes visible (user returns to device)
  // MULTI-DEVICE STALE STATE FIX:
  // When an employee switches between devices (e.g., clocks in on Device A, 
  // starts break on Device B, then returns to Device A to end break), 
  // Device A would show stale cached data unless refreshed.
  // 
  // This hook triggers a refresh when:
  // 1. The app becomes visible again (user returns to this device)
  // 2. The connection comes back online
  // 3. It's been at least 3 seconds since the last refresh (throttling)
  //
  // Offline mode is preserved:
  // - No refresh attempts when offline
  // - Initial data still comes from localStorage cache
  // - Optimistic UI updates continue to work
  // Tracks the time the currently-selected employee was opened. We compare this
  // against `entriesUpdatedAt` to decide whether the data we're showing reflects
  // a fresh server fetch made AFTER the selection — anything older might be stale
  // from another device and could let the user fire a conflicting action.
  const [selectedAt, setSelectedAt] = useState<number>(0);
  const prevSelectedEmpRef = useRef<number | null>(null);
  useEffect(() => {
    const empId = selectedEmployee?.id ?? null;
    if (empId && empId !== prevSelectedEmpRef.current) {
      setSelectedAt(Date.now());
      if (isActive && navigator.onLine) {
        // Always refetch on selection so we never trust the cached snapshot
        // for actionable decisions — another device may have updated the
        // employee's status while this kiosk was idle.
        refetchEntries();
      }
    }
    prevSelectedEmpRef.current = empId;
  }, [selectedEmployee, isActive, refetchEntries]);

  // True when we're online with an employee selected but haven't yet received a
  // server response newer than the moment they were selected. Used to lock the
  // action buttons so users can't act on stale cached state.
  const isVerifyingStatus =
    isOnline &&
    !!selectedEmployee &&
    selectedAt > 0 &&
    (entriesFetching || !entriesUpdatedAt || entriesUpdatedAt < selectedAt);

  const handleVisibleRefresh = useCallback(async () => {
    if (!selectedEmployee || !isActive) return;
    if (!navigator.onLine) return;

    try {
      await refetchEntries();
    } catch (error) {
      console.debug("[SteepIn] Refresh failed:", error);
    }
  }, [selectedEmployee, isActive, refetchEntries]);

  useRefreshOnVisibility({
    onVisible: handleVisibleRefresh,
    minInterval: 3000,
    enabled: isActive && isOnline && !!selectedEmployee,
  });

  const { isConnected: isSyncConnected } = useEntriesSync({
    employeeId: selectedEmployee?.id ?? null,
    onUpdateDetected: async () => {
      console.debug("[SteepIn] SSE update detected, refreshing...");
      await refetchEntries();
      if (Date.now() - lastMutationTsRef.current > 3000) {
        toast({
          title: "Status Updated",
          description: "Employee status was updated from another device",
          duration: 2000,
        });
      }
    },
    enabled: isActive && isOnline && !!selectedEmployee,
  });

  useEffect(() => {
    if (!isActive || !isOnline) return;
    const queue = getQueue();
    if (queue.length === 0) return;

    const syncActions = async () => {
      let conflictCount = 0;
      const count = await processQueue((action, success, errorMessage) => {
        if (!success && errorMessage) {
          conflictCount++;
          toast({
            title: "Action Failed",
            description: errorMessage,
            variant: "destructive",
          });
        }
      });
      setPendingCount(getQueue().length);
      if (count > 0 && conflictCount === 0) {
        toast({
          title: "Synced",
          description: `${count} queued action${count > 1 ? "s" : ""} uploaded`,
        });
      }
    };
    syncActions();
  }, [isActive, isOnline]);

  useEffect(() => {
    if (!authLoading && !isActive) {
      // When offline with cached employees, keep SteepIn open — the auth
      // server is unreachable but the device was a valid kiosk.
      if (!isOnline && hasEmployees) return;
      setLocation("/login");
    }
  }, [authLoading, isActive, isOnline, hasEmployees, setLocation]);

  // Background prefetch of entries for every employee on the kiosk roster so
  // when an employee taps their card the action screen opens with buttons
  // already enabled — no isVerifyingStatus wait. Runs at idle time, respects
  // staleTime (no-op if cache is already fresh), and is gated to small rosters
  // to avoid request storms on large tenants.
  const prefetchedFor = useRef<string>("");
  useEffect(() => {
    if (!isActive || !isOnline || !employees || employees.length === 0) return;
    if (employees.length > 30) return;
    const sig = employees.map((e) => e.id).sort().join(",");
    if (sig === prefetchedFor.current) return;
    prefetchedFor.current = sig;

    const run = () => {
      employees.forEach((emp) => {
        queryClient.prefetchQuery({
          queryKey: ["/api/steepin/entries", emp.id.toString()],
          queryFn: getQueryFn({ on401: "returnNull" }),
          staleTime: 60000,
        });
      });
    };
    if (typeof (window as any).requestIdleCallback === "function") {
      const id = (window as any).requestIdleCallback(run, { timeout: 2000 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [employees, isActive, isOnline]);

  useEffect(() => {
    if (!isActive) return;

    function getOrCreateDeviceId(): string {
      let id = localStorage.getItem("leaflog_device_id");
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("leaflog_device_id", id);
      }
      return id;
    }

    function getDeviceName(): string {
      const ua = navigator.userAgent;
      if (/iPhone/.test(ua)) return "iPhone";
      if (/iPad/.test(ua)) return "iPad";
      if (/Android/.test(ua)) return "Android Device";
      if (/Windows/.test(ua)) return "Windows PC";
      if (/Macintosh/.test(ua)) return "Mac";
      if (/Linux/.test(ua)) return "Linux PC";
      return "Unknown Device";
    }

    const deviceId = getOrCreateDeviceId();
    const deviceName = getDeviceName();

    apiRequest("POST", "/api/devices/register", { deviceId, deviceName })
      .then(() => {
        const introKey = "leaflog_steepin_intro_shown";
        if (!localStorage.getItem(introKey)) {
          localStorage.setItem(introKey, "1");
          setIntroDialogOpen(true);
        }
      })
      .catch(() => {});

    async function checkLock() {
      try {
        const res = await apiRequest("GET", `/api/devices/check?deviceId=${encodeURIComponent(deviceId)}`);
        if (res.ok) {
          const data = await res.json();
          setDeviceLocked(!!data.isLocked);
        }
      } catch (_) {}
    }

    checkLock();

    const startPolling = () => {
      if (lockPollRef.current) return;
      lockPollRef.current = setInterval(checkLock, 30000);
    };
    const stopPolling = () => {
      if (lockPollRef.current) {
        clearInterval(lockPollRef.current);
        lockPollRef.current = null;
      }
    };

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      startPolling();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Catch up immediately on wake, then resume polling.
        checkLock();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopPolling();
    };
  }, [isActive]);

  const actionMutation = useMutation({
    mutationFn: async ({ employeeId, type, passcode, notes, reClockAction, skipReClockCheck }: { employeeId: number; type: ActionType; passcode: string; notes?: string; reClockAction?: string; skipReClockCheck?: boolean }) => {
      try {
        const res = await apiRequest("POST", "/api/steepin/action", { employeeId, type, passcode, notes: notes || undefined, reClockAction, skipReClockCheck });
        lastMutationTsRef.current = Date.now();
        return res.json();
      } catch (error) {
        if (!shouldQueueAction(error)) throw error;

        const emp = employees?.find((e) => e.id === employeeId);
        if (!emp || emp.accessCode !== passcode) {
          throw new Error("Invalid passcode");
        }

        const now = new Date();
        addToQueue({
          employeeId,
          type,
          passcode,
          notes: notes || undefined,
          timestamp: now.toISOString(),
          date: now.toISOString().split("T")[0],
        });
        // Note: optimistic entry already appended in onMutate — do NOT add it again here.

        setPendingCount((c) => c + 1);
        return { _queued: true, type };
      }
    },
    // Instant optimistic UI: append the entry to the cache BEFORE the network
    // round-trip so the kiosk feels immediate. We snapshot the previous list so
    // onError can roll back, and we skip optimistic for ONLINE clock-ins
    // because the server may transform them into reClockDetected/reClockHandled
    // (delete + recreate) which our naive append would model incorrectly.
    onMutate: async (variables) => {
      const key = ["/api/steepin/entries", variables.employeeId.toString()];
      await queryClient.cancelQueries({ queryKey: key });
      const prevEntries = queryClient.getQueryData<TimeEntry[]>(key);

      const skipOptimistic = navigator.onLine && variables.type === "clock-in";
      let optimisticId: number | null = null;
      if (!skipOptimistic) {
        const now = new Date();
        optimisticId = -now.getTime();
        const optimisticEntry: TimeEntry = {
          id: optimisticId,
          employeeId: variables.employeeId,
          type: variables.type,
          timestamp: now.toISOString(),
          date: now.toISOString().split("T")[0],
          notes: variables.notes ?? null,
          source: "employee",
          isUnpaid: false,
        };
        queryClient.setQueryData<TimeEntry[]>(
          key,
          (old) => [...(old || []), optimisticEntry],
        );
      }
      return { prevEntries, optimisticId, queryKey: key };
    },
    onSuccess: (data, variables, context) => {
      const key = context?.queryKey ?? ["/api/steepin/entries", variables.employeeId.toString()];

      if (data._queued) {
        const labels: Record<ActionType, string> = {
          "clock-in": "Clocked In",
          "clock-out": "Clocked Out",
          "break-start": "Break Started",
          "break-end": "Break Ended",
        };
        toast({
          title: `${labels[variables.type]} (queued)`,
          description: `${selectedEmployee?.name} - will sync when online`,
        });
        setPasscode("");
        setPasscodeDialogOpen(false);
        setPendingAction(null);
        setNoteText("");
        return;
      }
      if (data.reClockDetected) {
        // Server didn't actually create an entry — roll back any optimistic
        // entry we might have added. (Currently we skip optimistic for online
        // clock-in so optimisticId is null here, but defensive cleanup keeps
        // the cache honest if that policy ever changes.)
        if (context?.optimisticId != null) {
          queryClient.setQueryData<TimeEntry[]>(
            key,
            (old) => (old || []).filter((e) => e.id !== context.optimisticId),
          );
        }
        setReClockData(data);
        setReClockPasscode(variables.passcode);
        setPasscodeDialogOpen(false);
        setPasscode("");
        setReClockDialogOpen(true);
        return;
      }
      if (data.reClockHandled) {
        // reClock paths don't (yet) include `entries`; fall back to invalidate.
        queryClient.invalidateQueries({ queryKey: key });
        const labels: Record<string, string> = {
          reopen: "Shift Reopened",
          "unpaid-break": "Break Recorded",
        };
        toast({
          title: labels[data.action] || "Updated",
          description: `${selectedEmployee?.name} - ${format(new Date(), "HH:mm")}`,
        });
        setPasscode("");
        setPasscodeDialogOpen(false);
        setPendingAction(null);
        setNoteText("");
        return;
      }

      // Normal success path. Prefer the authoritative `entries` list returned
      // by the server (avoids the follow-up GET round-trip). If the server is
      // older and didn't include it, fall back to: replace any optimistic with
      // the real entry, then invalidate to refetch.
      if (Array.isArray(data.entries)) {
        queryClient.setQueryData<TimeEntry[]>(key, data.entries);
      } else {
        const real: TimeEntry = {
          id: data.id ?? -Date.now(),
          employeeId: data.employeeId ?? variables.employeeId,
          type: data.type ?? variables.type,
          timestamp: data.timestamp ?? new Date().toISOString(),
          date: data.date ?? new Date().toISOString().split("T")[0],
          notes: data.notes ?? variables.notes ?? null,
          source: data.source ?? "employee",
          isUnpaid: data.isUnpaid ?? false,
        };
        queryClient.setQueryData<TimeEntry[]>(
          key,
          (old) => {
            const withoutOptimistic = (old || []).filter(
              (e) => context?.optimisticId == null || e.id !== context.optimisticId,
            );
            return [...withoutOptimistic, real];
          },
        );
        queryClient.invalidateQueries({ queryKey: key });
      }

      const labels: Record<ActionType, string> = {
        "clock-in": "Clocked In",
        "clock-out": "Clocked Out",
        "break-start": "Break Started",
        "break-end": "Break Ended",
      };
      toast({ title: labels[variables.type], description: `${selectedEmployee?.name} - ${format(new Date(), "HH:mm")}` });
      setPasscode("");
      setPasscodeDialogOpen(false);
      setPendingAction(null);
      setNoteText("");
      setReClockDialogOpen(false);
      setReClockData(null);
      setReClockPasscode("");
    },
    onError: (err: any, variables, context) => {
      // Roll back the optimistic entry first so the UI never lies on failure.
      if (context?.prevEntries !== undefined && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.prevEntries);
      }

      // Check if it's a conflict (409) - stale state
      const isConflict = err.message?.includes("409");
      if (isConflict) {
        toast({
          title: "Session Conflict",
          description: "Your session was updated on another device. Refreshing...",
          variant: "destructive",
        });
        // Force refresh to get current state
        if (selectedEmployee) {
          queryClient.invalidateQueries({
            queryKey: ["/api/steepin/entries", selectedEmployee.id.toString()],
          });
        }
        // 409 means the action is no longer valid — close the dialog so the
        // user is not stranded on an empty pin pad waiting to retry.
        setPasscode("");
        setPasscodeDialogOpen(false);
        setPendingAction(null);
        setNoteText("");
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
        // For other errors (e.g. wrong passcode), keep the dialog open and just
        // clear the entered passcode so the user can retry immediately.
        setPasscode("");
      }
    },
  });

  const exitMutation = useMutation({
    mutationFn: async () => {
      // Route through useAuth so the AuthProvider's authState is cleared atomically
      // with the server-side session. Otherwise App.tsx's `isSteepIn` stays true,
      // re-redirects /login back to /SteepIn, and we get a render loop.
      await exitSteepIn(exitUsername, exitPassword);
    },
    onSuccess: () => {
      setExitDialogOpen(false);
      setExitUsername("");
      setExitPassword("");
      toast({ title: "SteepIn Exited", description: "Successfully deactivated SteepIn mode" });
      setLocation("/login");
    },
    onError: (err: Error) => {
      toast({ title: "Exit Failed", description: err.message, variant: "destructive" });
    }
  });

  const currentShiftEntries = useMemo(() => {
    if (!entries.length) return [];
    const sorted = [...entries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let lastClockInIndex = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].type === "clock-in") {
        lastClockInIndex = i;
        break;
      }
    }
    if (lastClockInIndex === -1) return [];
    const shiftSlice = sorted.slice(lastClockInIndex);
    const clockOutIndex = shiftSlice.findIndex(e => e.type === "clock-out");
    const shiftEntries = clockOutIndex !== -1
      ? shiftSlice.slice(0, clockOutIndex + 1)
      : shiftSlice;
    return shiftEntries;
  }, [entries]);

  const isShiftActive = useMemo(() => {
    if (!currentShiftEntries.length) return false;
    return !currentShiftEntries.some(e => e.type === "clock-out");
  }, [currentShiftEntries]);

  const managerEdits = useMemo(() => {
    if (!isShiftActive || !currentShiftEntries.length) return [];
    return currentShiftEntries.filter(e => (e as any).source === "manager");
  }, [currentShiftEntries, isShiftActive]);

  const currentStatus = useMemo(() => {
    if (!isShiftActive) return "not-started";
    if (!currentShiftEntries.length) return "not-started";
    const last = currentShiftEntries[currentShiftEntries.length - 1];
    return last.type;
  }, [isShiftActive, currentShiftEntries]);

  const filteredEmployees = useMemo(() => {
    if (!employees || !Array.isArray(employees)) return [];
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.role && e.role.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  }, [employees, searchQuery]);

  const handleSelectEmployee = useCallback((emp: Employee) => {
    setSelectedEmployee(emp);
  }, []);

  const PageSkeleton = (
    <div className="h-screen flex items-center justify-center font-serif relative overflow-hidden" style={{ backgroundColor: t.bg }}>
      <BackgroundVector isDark={isDark} />
      <div className="relative z-10">
        <SteepInLoadingMark isDark={isDark} />
      </div>
    </div>
  );

  // Offline-first: if we have cached employees, skip the skeleton entirely.
  // The real page renders with cached data while auth validates in the background.
  if (hasEmployees) {
    // Auth confirmed not in SteepIn mode and no cached employees to fall back on
    if (!authLoading && !isActive) return PageSkeleton;
    // Fall through to render the real page with cached employees
  } else {
    // No cached employees — must wait for auth + employee fetch
    if (authLoading) return PageSkeleton;
    if (!isActive) return PageSkeleton;
  }

  const handleAction = (type: ActionType) => {
    if (!selectedEmployee) return;
    setPendingAction(type);
    setPasscodeDialogOpen(true);
  };

  const submitPasscode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !pendingAction || passcode.length < 4 || passcode.length > 6) return;
    actionMutation.mutate({ employeeId: selectedEmployee.id, type: pendingAction, passcode, notes: noteText.trim() || undefined });
  };

  const handleReClockChoice = (action: "new-shift" | "break" | "working") => {
    if (!selectedEmployee || !reClockData) return;
    if (action === "new-shift") {
      actionMutation.mutate({ employeeId: selectedEmployee.id, type: "clock-in", passcode: reClockPasscode, skipReClockCheck: true, notes: noteText.trim() || undefined });
    } else {
      actionMutation.mutate({ employeeId: selectedEmployee.id, type: "clock-in", passcode: reClockPasscode, reClockAction: action });
    }
  };

  const handleExitSteepIn = async (e: React.FormEvent) => {
    e.preventDefault();
    exitMutation.mutate();
  };

  if (selectedEmployee) {
    return (
      <div className={`h-screen flex flex-col font-serif relative overflow-hidden${initialPaintClass}`} style={{ backgroundColor: t.bg }}>
        <BackgroundVector isDark={isDark} />

        <header className="flex items-center justify-between gap-3 pt-3 pb-2 px-6 relative z-10 shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedEmployee(null)}
              className={`${t.buttonText} ${t.buttonHoverBg} ${t.buttonHoverText} text-lg font-medium border ${t.buttonBorder} ${t.buttonBg} px-6 rounded-xl transition-[background-color,color] duration-150 shadow-sm`}
              data-testid="button-steepin-back"
            >
              <ArrowLeft className="w-5 h-5 mr-2" /> Back
            </Button>
            {!isOnline && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${t.offlineAmberBg} ${t.offlineAmberText} border ${t.offlineAmberBorder}`}
                data-testid="status-offline-indicator-detail"
              >
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xl font-light tracking-widest uppercase" style={{ color: t.timeText }} data-testid="text-steepin-time">
              {liveTime}
            </div>
            {/* Live sync indicator */}
            {isOnline && isSyncConnected && (
              <div 
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-300"
                title="Cross-device sync active"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Live
              </div>
            )}
            {/* Manual refresh button - only show when online */}
            {isOnline && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetchEntries()}
                disabled={entriesFetching}
                className={`h-8 w-8 rounded-full ${t.buttonBg} ${t.buttonBorder} ${t.buttonText} ${t.buttonHoverBg} ${t.buttonHoverText} transition-[background-color,color] duration-200`}
                title={entriesUpdatedAt ? `Last updated: ${format(entriesUpdatedAt, "HH:mm:ss")}` : "Refresh"}
              >
                <RefreshCw className={`w-4 h-4 ${entriesFetching ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
          <div className="w-[80px]" />
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3 relative z-10" style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain", touchAction: "pan-y" } as React.CSSProperties}>
          <div className="w-full max-w-lg mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(1rem, 4vh, 2rem)' }}>
            <div className="text-center">
              <h2 style={{ fontSize: 'clamp(1.3rem, 6vh, 2rem)', fontWeight: 500, color: t.leafNameDisplay, margin: 0 }} data-testid="text-steepin-employee-name">{selectedEmployee.name}</h2>
              <p style={{ fontSize: 'clamp(0.9rem, 3.5vh, 1.15rem)', fontStyle: 'italic', marginTop: '0.25em', color: t.leafRoleDisplay }}>{selectedEmployee.role ? selectedEmployee.role : "Loose leaf"}</p>
            </div>

            {(entriesLoading && entries.length === 0) ? (
              <div className="grid grid-cols-2" style={{ gap: 'clamp(0.5rem, 2vh, 1.5rem)' }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl" style={{ height: 'clamp(3.5rem, 18vh, 6rem)', backgroundColor: isDark ? "rgba(35,25,20,0.2)" : "rgba(255,255,255,0.18)", border: `1.5px solid ${isDark ? "rgba(140,80,45,0.2)" : "rgba(107,130,100,0.15)"}` }} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {isVerifyingStatus ? (
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium ${t.offlineAmberBg} ${t.offlineAmberText} border ${t.offlineAmberBorder}`}>
                    <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                    <span>Verifying current status…</span>
                  </div>
                ) : !isOnline ? (
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium ${t.offlineAmberBg} ${t.offlineAmberText} border ${t.offlineAmberBorder}`}>
                    <WifiOff className="w-3.5 h-3.5 shrink-0" />
                    <span>Offline — current status unknown. All actions are available.</span>
                  </div>
                ) : entriesUpdatedAt && Date.now() - entriesUpdatedAt > 5 * 60 * 1000 ? (
                  // Show warning if data is older than 5 minutes (even when online)
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium ${t.offlineAmberBg} ${t.offlineAmberText} border ${t.offlineAmberBorder}`}>
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Data may be outdated — last updated {Math.round((Date.now() - entriesUpdatedAt) / 60000)}m ago</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-2" style={{ gap: 'clamp(0.5rem, 2vh, 1.5rem)' }}>
                  <Button
                    size="lg"
                    className="flex flex-col gap-2 text-base font-medium rounded-2xl transition-[transform] duration-150 hover:scale-[1.02] active:scale-[0.98] shadow-sm"
                    style={{ backgroundColor: "#10B981", color: "white", height: 'clamp(3.5rem, 18vh, 6rem)' }}
                    disabled={isVerifyingStatus || (isOnline ? (currentStatus === "clock-in" || currentStatus === "break-start" || currentStatus === "break-end" || actionMutation.isPending) : actionMutation.isPending)}
                    onClick={() => handleAction("clock-in")}
                    data-testid="button-clock-in"
                  >
                    <LogIn className="w-6 h-6" />
                    Clock In
                  </Button>
                  <Button
                    size="lg"
                    className="flex flex-col gap-2 text-base font-medium rounded-2xl transition-[transform] duration-150 hover:scale-[1.02] active:scale-[0.98] shadow-sm"
                    style={{ backgroundColor: "#EF4444", color: "white", height: 'clamp(3.5rem, 18vh, 6rem)' }}
                    disabled={isVerifyingStatus || (isOnline ? ((currentStatus !== "clock-in" && currentStatus !== "break-end" && currentStatus !== "break-start") || actionMutation.isPending) : actionMutation.isPending)}
                    onClick={() => handleAction("clock-out")}
                    data-testid="button-clock-out"
                  >
                    <LogOut className="w-6 h-6" />
                    Clock Out
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className={`flex flex-col gap-2 text-base font-medium rounded-2xl ${t.actionBtnBg} ${t.actionBtnBorder} ${t.actionBtnText} ${t.actionBtnHoverBg} ${t.actionBtnHoverBorder} transition-[transform,background-color,border-color] duration-150 hover:scale-[1.02] active:scale-[0.98] shadow-sm`}
                    style={{ height: 'clamp(3.5rem, 18vh, 6rem)' }}
                    disabled={isVerifyingStatus || (isOnline ? ((currentStatus !== "clock-in" && currentStatus !== "break-end") || actionMutation.isPending) : actionMutation.isPending)}
                    onClick={() => handleAction("break-start")}
                    data-testid="button-break-start"
                  >
                    <Coffee className="w-6 h-6" />
                    Start Break
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className={`flex flex-col gap-2 text-base font-medium rounded-2xl ${t.actionBtnBg} ${t.actionBtnBorder} ${t.actionBtnText} ${t.actionBtnHoverBg} ${t.actionBtnHoverBorder} transition-[transform,background-color,border-color] duration-150 hover:scale-[1.02] active:scale-[0.98] shadow-sm`}
                    style={{ height: 'clamp(3.5rem, 18vh, 6rem)' }}
                    disabled={isVerifyingStatus || (isOnline ? (currentStatus !== "break-start" || actionMutation.isPending) : actionMutation.isPending)}
                    onClick={() => handleAction("break-end")}
                    data-testid="button-break-end"
                  >
                    <Timer className="w-6 h-6" />
                    End Break
                  </Button>
                </div>
              </div>
            )}

            {isShiftActive && currentShiftEntries.some(e => (e as any).source !== "manager" && e.type !== "shift-reopened") && (
              <div className={`${t.shiftBg} rounded-2xl p-6 border ${t.shiftBorder} shadow-sm`}>
                <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: t.shiftLabel }} data-testid="heading-current-shift">Current Shift</h3>
                <div className="space-y-3">
                  {currentShiftEntries.filter(e => e.type !== "shift-reopened" && (e as any).source !== "manager").map((entry) => {
                    const typeLabels: Record<string, { label: string; color: string }> = {
                      "clock-in": { label: "Clock In", color: "#10B981" },
                      "clock-out": { label: "Clock Out", color: "#EF4444" },
                      "break-start": { label: "Break Start", color: "#F59E0B" },
                      "break-end": { label: "Break End", color: "#3B82F6" },
                    };
                    const info = typeLabels[entry.type] || { label: entry.type, color: "#6B7280" };
                    return (
                      <div key={entry.id} className="flex items-center justify-between text-sm" data-testid={`time-entry-${entry.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: info.color }} />
                          <span className="font-medium" style={{ color: t.entryName }}>{info.label}</span>
                        </div>
                        <span className="font-mono" style={{ color: t.entryTime }}>
                          {format(new Date(entry.timestamp), "HH:mm")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {managerEdits.length > 0 && (
              <div className={`${t.managerBg} rounded-2xl p-6 border ${t.managerBorder} shadow-sm`}>
                <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: t.managerLabel }} data-testid="heading-manager-edits">Live Manager Edits</h3>
                <div className="space-y-3">
                  {managerEdits.map((entry) => {
                    const typeLabels: Record<string, { label: string; color: string }> = {
                      "clock-in": { label: "Shift Start Edited", color: "#10B981" },
                      "clock-out": { label: "Shift End Added", color: "#EF4444" },
                      "break-start": { label: "Break Added", color: "#F59E0B" },
                      "break-end": { label: "Break Ended", color: "#3B82F6" },
                      "shift-reopened": { label: "Shift Reopened", color: "#8B5CF6" },
                    };
                    const info = typeLabels[entry.type] || { label: entry.type, color: "#6B7280" };
                    return (
                      <div key={entry.id} className="flex items-center justify-between text-sm" data-testid={`manager-edit-${entry.id}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: info.color }} />
                          <span className="font-medium" style={{ color: t.entryName }}>{info.label}</span>
                        </div>
                        <span className="font-mono" style={{ color: t.entryTime }}>
                          {format(new Date(entry.timestamp), "HH:mm")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <Dialog open={passcodeDialogOpen} onOpenChange={(open) => {
          if (!actionMutation.isPending) {
            setPasscodeDialogOpen(open);
            if (!open) setPasscode("");
          }
        }}>
          <DialogContent className={`sm:max-w-md font-serif ${t.dialogBg}`}>
            <DialogHeader>
              <DialogTitle className="text-2xl font-medium" style={{ color: t.dialogTitle }}>Enter Passcode</DialogTitle>
              <DialogDescription className="italic" style={{ color: t.dialogDesc }}>
                Please enter your 4-6 digit passcode to confirm this action.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitPasscode} className="space-y-6">
              <PinPad value={passcode} onChange={setPasscode} maxLength={6} isDark={isDark} />
              <div className="space-y-2 px-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest" style={{ color: t.noteLabelColor }}>
                    <StickyNote className="w-3.5 h-3.5" />
                    <span>Add a note</span>
                  </div>
                  <span className="text-[10px]" style={{ color: t.dialogDesc }}>{noteText.length}/200</span>
                </div>
                <div className="relative group">
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="e.g. covering for Alex..."
                    className={`h-24 text-sm resize-none ${t.noteInputBg} ${t.noteInputBorder} focus:border-[#4A5D45]/50 focus:ring-1 focus:ring-[#4A5D45]/20 rounded-xl placeholder:text-[#8C8C8C]/50 italic`}
                    style={{ color: t.dialogTitle }}
                    maxLength={200}
                    data-testid="input-steepin-note"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-4 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setPasscodeDialogOpen(false); setNoteText(""); }}
                  className="font-light" style={{ color: t.dialogDesc }}
                  disabled={actionMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className={`${t.confirmBtnBg} ${t.confirmBtnHover} text-white px-8 rounded-full font-light text-lg`}
                  disabled={passcode.length < 4 || actionMutation.isPending}
                >
                  {actionMutation.isPending ? "Verifying..." : "Confirm"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

      </div>
    );
  }

  return (
    <div className={`h-screen flex flex-col font-serif relative overflow-hidden${initialPaintClass}`} style={{ backgroundColor: t.bg }}>
      <BackgroundVector isDark={isDark} />
      
      {((!isOnline || pendingCount > 0) || !deviceLocked) && (
        <header className="flex items-center gap-3 pt-3 pb-2 px-6 relative z-10 shrink-0">
          {(!isOnline || pendingCount > 0) && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                !isOnline
                  ? `${t.offlineAmberBg} ${t.offlineAmberText} border ${t.offlineAmberBorder}`
                  : `${t.offlineSyncBg} ${t.offlineSyncText} border ${t.offlineSyncBorder}`
              }`}
              data-testid="status-offline-indicator"
            >
              {!isOnline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </>
              ) : (
                <>
                  <CloudUpload className="w-3.5 h-3.5 animate-pulse" />
                  <span>Syncing {pendingCount}</span>
                </>
              )}
            </div>
          )}
          {!deviceLocked && (
            <Button
              variant="ghost"
              size="sm"
              className={`${t.exitText} ${t.exitHoverBg} ${t.exitHoverText} text-xl font-light border ${t.exitBorder} ${t.exitBg} px-6 rounded-xl transition-[background-color,color] duration-150`}
              onClick={() => setExitDialogOpen(true)}
              data-testid="button-exit-steepin-list"
            >
              Exit
            </Button>
          )}
        </header>
      )}

      <Dialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <DialogContent className={`sm:max-w-md font-serif ${t.dialogBg}`}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-medium" style={{ color: t.dialogTitle }}>Exit SteepIn</DialogTitle>
            <DialogDescription className="italic" style={{ color: t.dialogDesc }}>
              Manager credentials are required to deactivate SteepIn mode.
            </DialogDescription>
          </DialogHeader>
          <form 
            onSubmit={handleExitSteepIn} 
            className="space-y-6" 
            autoComplete="off" 
            data-form-type="other"
            noValidate
          >
            <div className="sr-only" aria-hidden="true">
              <input type="text" name="user_name_login" tabIndex={-1} autoComplete="username" />
              <input type="password" name="password_login" tabIndex={-1} autoComplete="current-password" />
              <input type="email" name="email_address" tabIndex={-1} autoComplete="email" />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70" style={{ color: t.noteLabelColor }}>
                {"U S E R N A M E".split("").map((char, i) => <span key={i}>{char}</span>)}
              </label>
              <Input
                name={`u_${Math.random().toString(36).substring(7)}`}
                value={exitUsername}
                onChange={(e) => setExitUsername(e.target.value)}
                placeholder="Enter manager id"
                required
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore=""
                data-bwignore=""
                spellCheck={false}
                className={`${t.noteInputBg} ${t.noteInputBorder} focus:border-[#4A5D45]/50 focus:ring-1 focus:ring-[#4A5D45]/20 rounded-xl h-12`}
                style={{ color: t.dialogTitle }}
                onFocus={(e) => { 
                  e.target.removeAttribute("readonly");
                  e.target.setAttribute("autocomplete", "off");
                }}
                readOnly
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-70" style={{ color: t.noteLabelColor }}>
                {"P A S S W O R D".split("").map((char, i) => <span key={i}>{char}</span>)}
              </label>
              <Input
                type="password"
                name={`p_${Math.random().toString(36).substring(7)}`}
                value={exitPassword}
                onChange={(e) => setExitPassword(e.target.value)}
                placeholder="Enter manager key"
                required
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore=""
                data-bwignore=""
                spellCheck={false}
                className={`${t.noteInputBg} ${t.noteInputBorder} focus:border-[#4A5D45]/50 focus:ring-1 focus:ring-[#4A5D45]/20 rounded-xl h-12`}
                style={{ color: t.dialogTitle }}
                onFocus={(e) => { 
                  e.target.removeAttribute("readonly");
                  e.target.setAttribute("autocomplete", "new-password");
                }}
                readOnly
              />
            </div>
            <div className="flex justify-end gap-4 pt-2">
              <Button
                type="button"
                variant="ghost"
                className="font-light" style={{ color: t.dialogDesc }}
                onClick={() => setExitDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className={`${t.confirmBtnBg} ${t.confirmBtnHover} text-white px-8 rounded-full font-light text-lg`}
                disabled={exitMutation.isPending}
              >
                {exitMutation.isPending ? "Exiting..." : "Exit SteepIn"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={introDialogOpen} onOpenChange={setIntroDialogOpen}>
        <DialogContent className={`sm:max-w-md font-serif ${t.dialogBg}`}>
          <DialogHeader>
            <DialogTitle className="text-xl font-medium flex items-center gap-2" style={{ color: t.dialogTitle }}>
              <Info className="w-5 h-5" style={{ color: t.noteLabelColor }} />
              Welcome to SteepIn
            </DialogTitle>
            <DialogDescription className="italic" style={{ color: t.dialogDesc }}>
              A few tips to get started
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isDark ? "#2A2220" : "#F0F0E8" }}>
                <span className="text-sm font-bold" style={{ color: t.noteLabelColor }}>1</span>
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: t.leafNameDisplay }}>Lock this device</p>
                <p className="text-xs mt-0.5" style={{ color: t.dialogDesc }}>In Settings, go to Location Management and lock this device to prevent employees from exiting SteepIn mode.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isDark ? "#2A2220" : "#F0F0E8" }}>
                <span className="text-sm font-bold" style={{ color: t.noteLabelColor }}>2</span>
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: t.leafNameDisplay }}>Theme settings</p>
                <p className="text-xs mt-0.5" style={{ color: t.dialogDesc }}>Choose between light, dark, or auto-schedule themes from Settings to match your venue's ambiance.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isDark ? "#2A2220" : "#F0F0E8" }}>
                <span className="text-sm font-bold" style={{ color: t.noteLabelColor }}>3</span>
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: t.leafNameDisplay }}>Works offline</p>
                <p className="text-xs mt-0.5" style={{ color: t.dialogDesc }}>Employees can clock in/out even without internet. Actions queue up and sync automatically when reconnected.</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              onClick={() => setIntroDialogOpen(false)}
              className={`${t.confirmBtnBg} ${t.confirmBtnHover} text-white px-8 rounded-full font-light text-lg`}
              data-testid="button-dismiss-intro"
            >
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-y-auto pt-5 px-6 sm:px-12 pb-12 relative z-10" style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain", touchAction: "pan-y" } as React.CSSProperties}>
        <div className="relative max-w-2xl mx-auto mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: isDark ? "#7B6B5B" : "#6B6B6B" }} />
          <Input
            placeholder="Search by name or role..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`pl-12 h-14 ${t.searchBg} ${t.searchBorder} rounded-full text-lg font-light ${t.searchPlaceholder} shadow-sm ${t.searchFocusBg} transition-[background-color] duration-150`}
            style={{ color: t.leafNameDisplay }}
            data-testid="input-steepin-search"
          />
        </div>
        {empsLoading ? (
          <div className="min-h-[35vh] flex items-center justify-center">
            <SteepInLoadingMark isDark={isDark} />
          </div>
        ) : (
          <>
            <div className="hidden sm:grid grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {filteredEmployees.map((emp) => (
                <EmployeeCard key={emp.id} emp={emp} onClick={handleSelectEmployee} isDark={isDark} />
              ))}
            </div>
            <div className="sm:hidden space-y-3 max-w-lg mx-auto">
              {filteredEmployees.map((emp) => (
                <EmployeeCard key={emp.id} emp={emp} onClick={handleSelectEmployee} isDark={isDark} isMobile />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

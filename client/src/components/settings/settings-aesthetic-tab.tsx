import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Clock as ClockIcon, Moon, Palette, Sun } from "lucide-react";

type ThemeMutation = {
  mutate: (data: { mode?: string; dayStartHour?: number; nightStartHour?: number }) => void;
};

interface SettingsAestheticTabProps {
  managerTheme: string;
  setManagerTheme: (theme: "light" | "dark") => void;
  themeMode: string;
  setThemeMode: (mode: string) => void;
  updateThemeMutation: ThemeMutation;
  dayStartHour: number;
  setDayStartHour: (hour: number) => void;
  nightStartHour: number;
  setNightStartHour: (hour: number) => void;
}

export function SettingsAestheticTab({
  managerTheme,
  setManagerTheme,
  themeMode,
  setThemeMode,
  updateThemeMutation,
  dayStartHour,
  setDayStartHour,
  nightStartHour,
  setNightStartHour,
}: SettingsAestheticTabProps) {
  return (
    <TabsContent value="aesthetic" className="space-y-6 mt-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-violet-600" />
            <div>
              <CardTitle className="text-base">Manager Theme</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Choose the appearance for the manager dashboard
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: "light", label: "Spring", icon: Sun, desc: "Bright & fresh" },
              { value: "dark", label: "Autumn", icon: Moon, desc: "Warm & earthy" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setManagerTheme(opt.value as "light" | "dark")}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-colors ${
                  managerTheme === opt.value
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                    : "border-muted hover:border-violet-300"
                }`}
                data-testid={`button-manager-theme-${opt.value}`}
              >
                <opt.icon className={`w-5 h-5 ${managerTheme === opt.value ? "text-violet-600" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${managerTheme === opt.value ? "text-violet-700 dark:text-violet-300" : ""}`}>{opt.label}</span>
                <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-violet-600" />
            <div>
              <CardTitle className="text-base">SteepIn Theme</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Control the kiosk appearance for all devices
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "light", label: "Spring", icon: Sun, desc: "Bright & fresh" },
              { value: "dark", label: "Autumn", icon: Moon, desc: "Warm & earthy" },
              { value: "auto", label: "Auto", icon: ClockIcon, desc: "Time-based" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setThemeMode(opt.value);
                  updateThemeMutation.mutate({ mode: opt.value, dayStartHour, nightStartHour });
                }}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-colors ${
                  themeMode === opt.value
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
                    : "border-muted hover:border-violet-300"
                }`}
                data-testid={`button-theme-${opt.value}`}
              >
                <opt.icon className={`w-5 h-5 ${themeMode === opt.value ? "text-violet-600" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${themeMode === opt.value ? "text-violet-700 dark:text-violet-300" : ""}`}>{opt.label}</span>
                <span className="text-[10px] text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>

          {themeMode === "auto" && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 p-3 space-y-3">
              <p className="text-xs text-violet-700 dark:text-violet-300 font-medium">Schedule hours (device local time)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Sun className="w-3 h-3 text-amber-500" /> Spring starts at
                  </Label>
                  <Select
                    value={String(dayStartHour)}
                    onValueChange={(v) => {
                      const h = Number(v);
                      setDayStartHour(h);
                      updateThemeMutation.mutate({ mode: "auto", dayStartHour: h, nightStartHour });
                    }}
                  >
                    <SelectTrigger className="h-8" data-testid="select-day-start">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 4).map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {String(h).padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    <Moon className="w-3 h-3 text-indigo-500" /> Autumn starts at
                  </Label>
                  <Select
                    value={String(nightStartHour)}
                    onValueChange={(v) => {
                      const h = Number(v);
                      setNightStartHour(h);
                      updateThemeMutation.mutate({ mode: "auto", dayStartHour, nightStartHour: h });
                    }}
                  >
                    <SelectTrigger className="h-8" data-testid="select-night-start">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 15).map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {String(h).padStart(2, "0")}:00
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Spring theme from {String(dayStartHour).padStart(2, "0")}:00 to {String(nightStartHour).padStart(2, "0")}:00, Autumn theme otherwise
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

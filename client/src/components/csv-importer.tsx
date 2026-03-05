import { useState, useCallback, useRef } from "react";
import { format, parse, isValid, addDays, parseISO } from "date-fns";
import { Upload, FileText, ChevronLeft, Check, Users, ShieldCheck, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Employee } from "@shared/schema";

interface ColumnMapping {
  employeeName: number | null;
  firstName: number | null;
  lastName: number | null;
  date: number | null;
  clockIn: number | null;
  clockOut: number | null;
  breakDetail: number | null;
  breakStart: number | null;
  breakEnd: number | null;
  breakMinutes: number | null;
  role: number | null;
  notes: number | null;
}

interface BreakEntry {
  start: string;
  end: string;
  isUnpaid: boolean;
}

interface ParsedRow {
  employeeName: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  breaks: BreakEntry[];
  role: string | null;
  notes: string | null;
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 2000);
  const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  for (const ch of sample) {
    if (ch in counts) counts[ch as keyof typeof counts]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCSV(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = clean.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    if (fields.length > 1 || (fields.length === 1 && fields[0])) rows.push(fields);
  }
  return rows;
}

type FieldKey = keyof ColumnMapping;

const fieldPatterns: Record<FieldKey, RegExp[]> = {
  employeeName: [/^(employee[\s._-]?)?name$/i, /^(full[\s._-]?)?name$/i, /^employee$/i, /^worker$/i, /^staff$/i, /^person$/i, /^team[\s._-]?member$/i],
  firstName: [/^(first[\s._-]?name|first|nome|forename|given[\s._-]?name)$/i],
  lastName: [/^(last[\s._-]?name|last|surname|cognome|family[\s._-]?name)$/i],
  date: [/^date$/i, /^work[\s._-]?date$/i, /^shift[\s._-]?date$/i, /^datum$/i, /^data$/i],
  clockIn: [/^in$/i, /clock[\s._-]?in/i, /^time[\s._-]?in$/i, /^in[\s._-]?time$/i, /^start[\s._-]?time$/i, /^start$/i, /^check[\s._-]?in$/i, /^arrival$/i, /^begin$/i, /^clocked[\s._-]?in/i, /^from$/i, /^entrata$/i, /^ingresso$/i],
  clockOut: [/^out$/i, /clock[\s._-]?out/i, /^time[\s._-]?out$/i, /^out[\s._-]?time$/i, /^end[\s._-]?time$/i, /^end$/i, /^check[\s._-]?out$/i, /^departure$/i, /^finish(ed)?$/i, /^clocked[\s._-]?out/i, /^to$/i, /^uscita$/i],
  breakDetail: [/^break[\s._-]?detail/i, /^break[\s._-]?info/i, /^pause[\s._-]?detail/i, /^pausa/i, /^breaks?$/i],
  breakStart: [/break[\s._-]?start/i, /break[\s._-]?in/i, /break[\s._-]?begin/i, /break[\s._-]?from/i],
  breakEnd: [/break[\s._-]?end/i, /break[\s._-]?out/i, /break[\s._-]?finish/i, /break[\s._-]?stop/i, /break[\s._-]?to/i],
  breakMinutes: [/^break[\s._-]?(min(utes?)?|hrs?|hours?|dur(ation)?|len(gth)?|time)$/i, /^unpaid[\s._-]?break$/i],
  role: [/^role$/i, /^position$/i, /^job[\s._-]?title$/i, /^title$/i, /^mansione$/i, /^ruolo$/i],
  notes: [/^notes?$/i, /^comment(s)?$/i, /^remark(s)?$/i, /^memo$/i, /^note$/i],
};

function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    employeeName: null, firstName: null, lastName: null,
    date: null, clockIn: null, clockOut: null,
    breakDetail: null, breakStart: null, breakEnd: null, breakMinutes: null,
    role: null, notes: null,
  };
  const usedCols = new Set<number>();

  for (const [field, patterns] of Object.entries(fieldPatterns) as [FieldKey, RegExp[]][]) {
    for (const pattern of patterns) {
      const idx = headers.findIndex((h, i) => !usedCols.has(i) && pattern.test(h.trim()));
      if (idx !== -1) {
        mapping[field] = idx;
        usedCols.add(idx);
        break;
      }
    }
  }
  return mapping;
}

const DATE_FORMATS = [
  "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "d/M/yyyy", "M/d/yyyy",
  "dd-MM-yyyy", "MM-dd-yyyy", "d.M.yyyy", "dd.MM.yyyy",
  "yyyy/MM/dd", "d MMM yyyy", "dd MMM yyyy", "MMM d, yyyy", "MMMM d, yyyy",
  "d MMMM yyyy", "EEE, MMM d, yyyy", "EEE dd/MM/yyyy",
];

function parseDate(str: string): string | null {
  if (!str?.trim()) return null;
  const s = str.trim();
  for (const fmt of DATE_FORMATS) {
    try {
      const d = parse(s, fmt, new Date());
      if (isValid(d) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) {
        return format(d, "yyyy-MM-dd");
      }
    } catch {}
  }
  const iso = new Date(s);
  if (isValid(iso) && iso.getFullYear() >= 2000) return format(iso, "yyyy-MM-dd");
  return null;
}

function parseTime(str: string): string | null {
  if (!str?.trim()) return null;
  const s = str.trim();
  const ampm = s.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)$/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2] || "0");
    const isPm = /pm/i.test(ampm[3]);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }
  const hhmm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hhmm) return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
  const compact = s.match(/^(\d{3,4})$/);
  if (compact) {
    const padded = s.padStart(4, "0");
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }
  return null;
}

function parseBreakMinutes(str: string): number | null {
  if (!str?.trim()) return null;
  const s = str.trim();
  const mins = parseFloat(s);
  if (!isNaN(mins) && mins >= 0 && mins <= 480) return Math.round(mins);
  const hhmm = s.match(/^(\d+):(\d{2})$/);
  if (hhmm) return parseInt(hhmm[1]) * 60 + parseInt(hhmm[2]);
  const hrMatch = s.match(/^([\d.]+)\s*h(ours?)?$/i);
  if (hrMatch) return Math.round(parseFloat(hrMatch[1]) * 60);
  return null;
}

function parseBreakDetail(text: string): BreakEntry[] {
  if (!text?.trim()) return [];
  const results: BreakEntry[] = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const timeMatch = trimmed.match(/\((\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\)/);
    if (!timeMatch) continue;
    const startTime = parseTime(timeMatch[1]);
    const endTime = parseTime(timeMatch[2]);
    if (!startTime || !endTime) continue;
    const minsMatch = trimmed.match(/([-\d]+)\s*min/i);
    const mins = minsMatch ? parseInt(minsMatch[1]) : 1;
    if (mins <= 0) continue;
    const isUnpaid = /non\s*pagat|unpaid|staccato|deduct/i.test(trimmed);
    results.push({ start: startTime, end: endTime, isUnpaid });
  }
  return results;
}

interface Props {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
}

export default function CsvImporter({ open, onClose, employees }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; replaced: number; newEmployees: string[]; newRoles: string[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  const resetState = () => {
    setStep(1); setParsedRows([]);
    setImportResult(null); setImporting(false); setParseError(null);
  };

  const buildParsedRows = (m: ColumnMapping, rows: string[][]): ParsedRow[] => {
    const result: ParsedRow[] = [];
    for (const row of rows) {
      const get = (idx: number | null) => (idx != null && idx < row.length ? row[idx] : "");

      let name = get(m.employeeName).trim();
      if (!name) {
        const fn = get(m.firstName).trim();
        const ln = get(m.lastName).trim();
        name = [fn, ln].filter(Boolean).join(" ");
      }

      const date = parseDate(get(m.date));
      const clockIn = parseTime(get(m.clockIn));
      if (!name || !date || !clockIn) continue;

      const clockOut = parseTime(get(m.clockOut));

      let breaks: BreakEntry[] = [];
      if (m.breakDetail !== null) {
        breaks = parseBreakDetail(get(m.breakDetail));
      }
      if (breaks.length === 0 && m.breakStart !== null && m.breakEnd !== null) {
        const bs = parseTime(get(m.breakStart));
        const be = parseTime(get(m.breakEnd));
        if (bs && be) breaks = [{ start: bs, end: be, isUnpaid: false }];
      }
      if (breaks.length === 0 && m.breakMinutes !== null && clockOut) {
        const mins = parseBreakMinutes(get(m.breakMinutes));
        if (mins && mins > 0) {
          const cinMs = new Date(`${date}T${clockIn}:00`).getTime();
          const coutDate = clockOut < clockIn ? format(addDays(parseISO(date), 1), "yyyy-MM-dd") : date;
          const coutMs = new Date(`${coutDate}T${clockOut}:00`).getTime();
          const midMs = cinMs + (coutMs - cinMs) / 2;
          const bStartMs = midMs - (mins * 60000) / 2;
          const bEndMs = bStartMs + mins * 60000;
          breaks = [{
            start: format(new Date(bStartMs), "HH:mm"),
            end: format(new Date(bEndMs), "HH:mm"),
            isUnpaid: true,
          }];
        }
      }

      result.push({
        employeeName: name,
        date,
        clockIn,
        clockOut: clockOut ?? null,
        breaks,
        role: m.role != null ? get(m.role).trim() || null : null,
        notes: m.notes != null ? get(m.notes).trim() || null : null,
      });
    }
    return result;
  };

  const handleFile = (file: File) => {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const delim = detectDelimiter(text);
      const rows = parseCSV(text, delim);
      if (rows.length < 2) {
        toast({ title: "Invalid CSV", description: "File appears to be empty or has only one row.", variant: "destructive" });
        return;
      }
      const headers = rows[0];
      const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));
      const detected = detectColumns(headers);

      const hasName = detected.employeeName !== null || detected.firstName !== null;
      if (!hasName || detected.date === null || detected.clockIn === null) {
        setParseError(
          `Could not auto-detect required columns from headers: ${headers.join(", ")}. ` +
          `Need at least Employee Name (or First Name), Date, and Clock In (In).`
        );
        return;
      }

      const parsed = buildParsedRows(detected, dataRows);
      if (parsed.length === 0) {
        setParseError("No valid rows could be parsed from this file. Check the date and time formats.");
        return;
      }
      setParsedRows(parsed);
      setStep(2);
    };
    reader.readAsText(file, "utf-8");
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await apiRequest("POST", "/api/timesheets/import-csv", {
        rows: parsedRows,
        timezoneOffset: new Date().getTimezoneOffset(),
      });
      const data = await res.json();
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/steepin/entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const newEmployeeNames = [...new Set(parsedRows
    .map(r => r.employeeName.toLowerCase())
    .filter(n => !employees.some(e => e.name.toLowerCase() === n))
  )];

  const handleClose = () => { resetState(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> Import Timesheets from CSV
            <span className="text-[9px] font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded px-1.5 py-0.5 leading-none flex items-center gap-1"><FlaskConical className="w-2.5 h-2.5" /> Experimental</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {step > s ? <Check className="w-3 h-3" /> : s}
              </div>
              <span className={step === s ? "text-foreground font-medium" : ""}>{s === 1 ? "Upload" : "Preview & Import"}</span>
              {s < 2 && <span className="text-muted-foreground">›</span>}
            </div>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 pr-1">

          {step === 1 && (
            <div className="space-y-3">
              <div
                className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
              >
                <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium mb-1">Drop your CSV file here, or click to browse</p>
                <p className="text-xs text-muted-foreground">Works with exports from Planday, Deputy, When I Work, Sling, Homebase, and more — including multi-employee files</p>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              </div>
              {parseError && (
                <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                  {parseError}
                </div>
              )}
            </div>
          )}

          {step === 2 && !importResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-400">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>A backup is created automatically before import. Existing entries for these dates will be replaced. You can restore from <strong>Settings → Backups</strong>.</span>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm">
                  <Check className="w-4 h-4 text-green-500" />
                  <span><strong>{parsedRows.length}</strong> rows ready to import</span>
                </div>
                {newEmployeeNames.length > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                    <Users className="w-4 h-4" />
                    <span><strong>{newEmployeeNames.length}</strong> new employee{newEmployeeNames.length > 1 ? "s" : ""} will be created</span>
                  </div>
                )}
              </div>

              {newEmployeeNames.length > 0 && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-2.5">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">New employees to be created:</p>
                  <div className="flex flex-wrap gap-1">
                    {newEmployeeNames.map(n => (
                      <span key={n} className="text-xs capitalize border border-amber-300 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Employee</th>
                      <th className="px-2 py-1.5 text-left font-medium">Date</th>
                      <th className="px-2 py-1.5 text-left font-medium">In</th>
                      <th className="px-2 py-1.5 text-left font-medium">Out</th>
                      <th className="px-2 py-1.5 text-left font-medium">Breaks</th>
                      {parsedRows.some(r => r.role) && <th className="px-2 py-1.5 text-left font-medium">Role</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 25).map((row, i) => {
                      const exists = employees.some(e => e.name.toLowerCase() === row.employeeName.toLowerCase());
                      const breakLabel = row.breaks.length === 0 ? "—"
                        : row.breaks.map(b => `${b.start}–${b.end}${b.isUnpaid ? " (unpaid)" : ""}`).join(", ");
                      return (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1 font-medium">
                            <span className={exists ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}>
                              {row.employeeName}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{row.date}</td>
                          <td className="px-2 py-1">{row.clockIn}</td>
                          <td className="px-2 py-1 text-muted-foreground">{row.clockOut || "—"}</td>
                          <td className="px-2 py-1 text-muted-foreground max-w-[180px] truncate" title={breakLabel}>{breakLabel}</td>
                          {parsedRows.some(r => r.role) && <td className="px-2 py-1 text-muted-foreground">{row.role || "—"}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {parsedRows.length > 25 && (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t">
                    … and {parsedRows.length - 25} more rows
                  </div>
                )}
              </div>
            </div>
          )}

          {importResult && (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="font-semibold text-lg" data-testid="text-import-complete">Import complete!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {importResult.created} timesheet{importResult.created !== 1 ? "s" : ""} imported
                  {importResult.replaced > 0 && ` (${importResult.replaced} existing entries replaced)`}
                </p>
              </div>
              {importResult.newEmployees.length > 0 && (
                <div className="rounded-md bg-muted/40 p-3 text-sm text-left inline-block mx-auto">
                  <p className="font-medium mb-1.5 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> New employees created:</p>
                  <div className="flex flex-wrap gap-1">
                    {importResult.newEmployees.map(n => <span key={n} className="text-xs bg-muted px-1.5 py-0.5 rounded border">{n}</span>)}
                  </div>
                </div>
              )}
              {importResult.newRoles.length > 0 && (
                <div className="rounded-md bg-muted/40 p-3 text-sm text-left inline-block mx-auto">
                  <p className="font-medium mb-1.5">New roles created:</p>
                  <div className="flex flex-wrap gap-1">
                    {importResult.newRoles.map(n => <span key={n} className="text-xs bg-muted px-1.5 py-0.5 rounded border">{n}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t flex-shrink-0">
          {importResult ? (
            <Button onClick={handleClose} data-testid="button-import-done">Done</Button>
          ) : (
            <div className="flex items-center gap-2 w-full">
              {step === 2 && !importing && (
                <Button variant="outline" onClick={() => { setStep(1); setParsedRows([]); setParseError(null); }} className="mr-auto" data-testid="button-import-back">
                  <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Back
                </Button>
              )}
              <Button variant="ghost" onClick={handleClose} className="ml-auto" disabled={importing} data-testid="button-import-cancel">Cancel</Button>
              {step === 2 && !importResult && (
                <Button onClick={handleImport} disabled={importing} data-testid="button-import-confirm">
                  {importing ? "Importing…" : `Import ${parsedRows.length} rows`}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

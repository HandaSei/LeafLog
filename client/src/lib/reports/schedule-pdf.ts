import { eachDayOfInterval, format } from "date-fns";
import type { CustomRole, Employee, Shift } from "@shared/schema";
import { formatTime } from "@/lib/constants";

function calcShiftDurationMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  return mins;
}

function formatDurationFromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export async function exportSchedulePDF(
  rangeStart: Date,
  rangeEnd: Date,
  allShifts: Shift[],
  allEmployees: Employee[],
  targetEmployeeIds: number[],
  customRoles: CustomRole[]
) {
  const jspdf = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const jsPDF = jspdf.jsPDF;

  const INK: [number, number, number] = [35, 35, 35];
  const MUTED: [number, number, number] = [105, 105, 105];
  const LINE: [number, number, number] = [215, 229, 215];
  const HEADER_BG: [number, number, number] = [239, 246, 239];
  const TEA: [number, number, number] = [111, 143, 111];

  const doc = new jsPDF({ orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.width;
  const pageMargin = 8;

  const rangeLabel = `${format(rangeStart, "MMM d, yyyy")} – ${format(rangeEnd, "MMM d, yyyy")}`;
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
  const empMap = new Map<number, Employee>();
  allEmployees.forEach(e => empMap.set(e.id, e));

  const selectedEmps = allEmployees
    .filter(e => targetEmployeeIds.includes(e.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const shiftsByDateAndEmp = new Map<string, Shift[]>();
  allShifts.forEach(s => {
    if (!targetEmployeeIds.includes(s.employeeId)) return;
    const key = `${s.date}_${s.employeeId}`;
    if (!shiftsByDateAndEmp.has(key)) shiftsByDateAndEmp.set(key, []);
    shiftsByDateAndEmp.get(key)!.push(s);
  });

  type EmpSummary = { name: string; totalShifts: number; totalMinutes: number };
  const summaries: EmpSummary[] = [];

  selectedEmps.forEach((emp, empIndex) => {
    if (empIndex > 0) doc.addPage("a4", "portrait");

    const empLabel = `${emp.name}${emp.role && emp.role !== "No Role" ? ` - ${emp.role}` : ""}`;

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEA);
    doc.text("Schedule", pageMargin, 10);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(rangeLabel, pageWidth - pageMargin, 10, { align: "right" });
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(empLabel, pageMargin, 16);

    const rows: any[][] = [];
    let empTotalMinutes = 0;
    let empTotalShifts = 0;

    days.forEach(day => {
      const dateStr = format(day, "yyyy-MM-dd");
      const key = `${dateStr}_${emp.id}`;
      const dayShifts = (shiftsByDateAndEmp.get(key) || [])
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      if (dayShifts.length === 0) return;

      dayShifts.forEach((shift, idx) => {
        const isFirst = idx === 0;
        const durationMins = calcShiftDurationMinutes(shift.startTime, shift.endTime);
        const roleName = shift.role || "-";
        const notes = shift.notes || "-";
        empTotalMinutes += durationMins;
        empTotalShifts++;

        const row: any[] = [];

        if (isFirst) {
          row.push({
            content: format(day, "EEE, MMM d"),
            rowSpan: dayShifts.length,
            styles: { fontStyle: "bold", lineWidth: { top: 0.2, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: LINE },
          });
        }

        const borderStyle = { lineWidth: { top: isFirst ? 0.2 : 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: LINE };

        row.push({ content: `${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`, styles: { ...borderStyle, halign: "center" } });
        row.push({ content: formatDurationFromMinutes(durationMins), styles: borderStyle });
        row.push({ content: roleName, styles: borderStyle });
        row.push({ content: notes, styles: { ...borderStyle, cellWidth: 'auto' } });

        rows.push(row);
      });
    });

    if (rows.length === 0) {
      rows.push(["No scheduled shifts in this period.", "", "", "", ""]);
    }

    const head: string[][] = [["Date", "Time", "Duration", "Role", "Notes"]];

    const totalHoursStr = (empTotalMinutes / 60).toFixed(2) + " h";
    const reportTableWidth = pageWidth - pageMargin * 2;
    const scheduleColumns = [
      { weight: 1.35 },
      { weight: 1.75, halign: "center" },
      { weight: 1.05, halign: "center" },
      { weight: 1.45 },
      { weight: 2.9 },
    ];
    const scheduleWeight = scheduleColumns.reduce((sum, col) => sum + col.weight, 0);
    const scheduleColumnStyles: Record<number, any> = Object.fromEntries(
      scheduleColumns.map((col, index) => [
        index,
        {
          cellWidth: (reportTableWidth * col.weight) / scheduleWeight,
          ...(col.halign ? { halign: col.halign } : {}),
        },
      ])
    );
    const footerCells: any[] = [
      { content: `Total: ${empTotalShifts} shift${empTotalShifts !== 1 ? "s" : ""}`, colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
      { content: totalHoursStr, styles: { fontStyle: "bold" } },
      { content: "", colSpan: 2 },
    ];

    const empRenderedPages: number[] = [];
    let empSheetCount = 0;

    autoTable(doc, {
      startY: 26,
      margin: { top: 22, right: pageMargin, bottom: 8, left: pageMargin },
      head,
      body: rows,
      foot: [footerCells],
      showFoot: "lastPage",
      headStyles: { fillColor: TEA, textColor: 255, fontStyle: "bold", fontSize: 10, lineWidth: 0.1, lineColor: [135, 162, 135] },
      footStyles: { fillColor: HEADER_BG, textColor: INK, fontStyle: "bold", fontSize: 10, lineWidth: 0.1, lineColor: LINE },
      styles: { fontSize: 10, cellPadding: { top: 1.7, right: 1.8, bottom: 1.7, left: 1.8 }, lineWidth: 0.1, lineColor: LINE, valign: "middle", overflow: "linebreak" },
      columnStyles: scheduleColumnStyles,
      tableWidth: reportTableWidth,
      didDrawPage: () => {
        empSheetCount++;
        const curPage = (doc.internal as any).getCurrentPageInfo().pageNumber;
        empRenderedPages.push(curPage);
        if (empSheetCount > 1) {
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(...MUTED);
          doc.text(`Schedule - ${rangeLabel}`, pageMargin, 8);
          doc.setFontSize(11);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(...INK);
          doc.text(`${empLabel} - continued`, pageMargin, 13);
        }
      },
    });

    if (empSheetCount > 1) {
      empRenderedPages.forEach((pageNum, idx) => {
        doc.setPage(pageNum);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...MUTED);
        doc.text(`Sheet ${idx + 1} of ${empSheetCount}`, pageWidth - pageMargin, 8, { align: "right" });
      });
      doc.setPage(empRenderedPages[empRenderedPages.length - 1]);
    }

    summaries.push({
      name: emp.name,
      totalShifts: empTotalShifts,
      totalMinutes: empTotalMinutes,
    });
  });

  if (selectedEmps.length > 1) {
    doc.addPage("a4", "portrait");

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEA);
    doc.text("Schedule Summary", pageMargin, 10);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(rangeLabel, pageWidth - pageMargin, 10, { align: "right" });
    doc.text(`${selectedEmps.length} employees - ${summaries.reduce((s, e) => s + e.totalShifts, 0)} total shifts`, pageMargin, 15);

    const grandMinutes = summaries.reduce((s, e) => s + e.totalMinutes, 0);
    const grandHours = grandMinutes / 60;

    const summaryHead: string[][] = [["Employee", "Shifts", "Total Hours"]];
    const summaryRows = summaries.map(s => [
      s.name,
      String(s.totalShifts),
      (s.totalMinutes / 60).toFixed(2) + " h",
    ]);
    const summaryFooter: any[] = [
      { content: "Grand Total", styles: { fontStyle: "bold", halign: "right" } },
      { content: String(summaries.reduce((s, e) => s + e.totalShifts, 0)), styles: { fontStyle: "bold" } },
      { content: grandHours.toFixed(2) + " h", styles: { fontStyle: "bold" } },
    ];
    const summaryTableWidth = pageWidth - pageMargin * 2;
    const summaryColumns = [
      { weight: 2.8, fontStyle: "bold" },
      { weight: 0.9, halign: "center" },
      { weight: 1.1, halign: "right" },
    ];
    const summaryWeight = summaryColumns.reduce((sum, col) => sum + col.weight, 0);
    const summaryColumnStyles: Record<number, any> = Object.fromEntries(
      summaryColumns.map((col, index) => [
        index,
        {
          cellWidth: (summaryTableWidth * col.weight) / summaryWeight,
          ...(col.halign ? { halign: col.halign } : {}),
          ...(col.fontStyle ? { fontStyle: col.fontStyle } : {}),
        },
      ])
    );

    autoTable(doc, {
      startY: 20,
      margin: { top: 14, right: pageMargin, bottom: 8, left: pageMargin },
      head: summaryHead,
      body: summaryRows,
      foot: [summaryFooter],
      headStyles: { fillColor: TEA, textColor: 255, fontStyle: "bold", fontSize: 9.8, lineWidth: 0.1, lineColor: [135, 162, 135] },
      footStyles: { fillColor: HEADER_BG, textColor: INK, fontStyle: "bold", fontSize: 9.8, lineWidth: 0.1, lineColor: LINE },
      styles: { fontSize: 9.8, cellPadding: { top: 1.6, right: 1.8, bottom: 1.6, left: 1.8 }, lineWidth: 0.1, lineColor: LINE },
      columnStyles: summaryColumnStyles,
      tableWidth: summaryTableWidth,
    });
  }

  const fileName = `Schedule_${format(rangeStart, "MMM_d")}-${format(rangeEnd, "MMM_d_yyyy")}_${Date.now()}.pdf`;
  doc.save(fileName);
}

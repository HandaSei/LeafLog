import { format } from "date-fns";
import type { Employee, TimeEntry, Shift } from "@shared/schema";
import {
  buildWorkdaysForRange,
  formatHoursDecimal,
  formatMinutes,
  shiftMinutes,
  type EmployeeWorkday,
} from "@/lib/timesheets/session-engine";

export async function exportTimesheetPDF(
  rangeStart: Date,
  rangeEnd: Date,
  rangeLabel: string,
  entries: TimeEntry[],
  employees: Employee[],
  targetEmployeeIds: number[],
  paidBreakMinutes?: number | null,
  options?: {
    showScheduledComparison?: boolean;
    shifts?: Shift[];
  }
) {
  const jspdf = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const jsPDF = jspdf.jsPDF;

  const INK: [number, number, number] = [35, 35, 35];
  const MUTED: [number, number, number] = [105, 105, 105];
  const LINE: [number, number, number] = [215, 229, 215];
  const HEADER_BG: [number, number, number] = [239, 246, 239];
  const TEA: [number, number, number] = [111, 143, 111];
  const RED: [number, number, number] = [200, 60, 60];
  const POSITIVE: [number, number, number] = [52, 120, 72];

  const showScheduled = !!(options?.showScheduledComparison && options?.shifts?.length);
  const allShifts = options?.shifts ?? [];

  const doc = new jsPDF({ orientation: "portrait" });

  const grouped = buildWorkdaysForRange(entries, employees, rangeStart, rangeEnd, "all", "", targetEmployeeIds, paidBreakMinutes);
  const hasUnpaid = grouped.some(({ workdays }) => workdays.some(wd => wd.unpaidBreakMinutes > 0));

  const selectedEmps = employees.filter(e => targetEmployeeIds.includes(e.id));

  type EmpSummary = {
    name: string;
    daysWorked: number;
    netMinutes: number;
    unpaidMinutes: number;
    totalLateMinutes: number;
    totalDiffMinutes: number;
    scheduledDays: number;
    netHoursDisplay: number;
  };
  const summaries: EmpSummary[] = [];

  const pageWidth = doc.internal.pageSize.width;
  const pageMargin = 8;

  const drawEmpHeader = (empName: string, effectivePaidBreak: number | null | undefined) => {
    const hasPaidBreakNote = effectivePaidBreak != null && effectivePaidBreak > 0;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEA);
    doc.text("Timesheet", pageMargin, 10);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(rangeLabel, pageWidth - pageMargin, 10, { align: "right" });
    if (hasPaidBreakNote) {
      doc.setFontSize(8.5);
      doc.text(`Break policy: ${effectivePaidBreak} min paid; excess is unpaid.`, pageMargin, 15);
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(empName, pageMargin, hasPaidBreakNote ? 21 : 16);
    return hasPaidBreakNote;
  };

  const drawContinuationHeader = (empName: string) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(`Timesheet - ${rangeLabel}`, pageMargin, 8);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(`${empName} - continued`, pageMargin, 13);
  };

  selectedEmps.forEach((emp, empIndex) => {
    if (empIndex > 0) doc.addPage("a4", "portrait");

    const empEffectivePaidBreak = emp.paidBreakMinutes != null ? emp.paidBreakMinutes : paidBreakMinutes;
    const empLabel = `${emp.name}${emp.role && emp.role !== "No Role" ? ` - ${emp.role}` : ""}`;
    const hasPaidBreakNote = drawEmpHeader(empLabel, empEffectivePaidBreak);

    const empWorkdaysByDate: { date: Date; sessions: EmployeeWorkday[] }[] = [];
    grouped.forEach(({ date, workdays }) => {
      const sessions = workdays.filter(wd => wd.employee.id === emp.id && wd.status === "completed");
      if (sessions.length > 0) empWorkdaysByDate.push({ date, sessions });
    });

    // Accumulate 2dp-rounded hour values so totals match what's visible in each row
    let empNetHoursDisplay = 0;
    let empUnpaidHoursDisplay = 0;
    let empLateMinutes = 0;
    let empDiffMinutes = 0;
    let empScheduledDays = 0;

    const rows: any[][] = [];

    empWorkdaysByDate.forEach(({ date, sessions }) => {
      const dateStr = format(date, "yyyy-MM-dd");
      const matchedShift = allShifts.find(s => s.employeeId === emp.id && s.date === dateStr);

      const dayNet = sessions.reduce((s, w) => s + w.netWorkedMinutes, 0);
      const dayUnpaid = sessions.reduce((s, w) => s + w.unpaidBreakMinutes, 0);
      const dayNetDisplay = parseFloat(formatHoursDecimal(dayNet));
      const dayUnpaidDisplay = parseFloat(formatHoursDecimal(dayUnpaid));
      empNetHoursDisplay += dayNetDisplay;
      empUnpaidHoursDisplay += dayUnpaidDisplay;

      let lateMins: number | null = null;
      let diffMins: number | null = null;

      if (showScheduled && matchedShift) {
        empScheduledDays++;
        const schedStart = shiftMinutes(matchedShift.startTime);
        const schedEnd = shiftMinutes(matchedShift.endTime);
        const schedDuration = schedEnd > schedStart ? schedEnd - schedStart : (1440 - schedStart) + schedEnd;

        const firstSession = sessions[0];
        if (firstSession.clockIn) {
          const actualStart = firstSession.clockIn.getHours() * 60 + firstSession.clockIn.getMinutes();
          let late = actualStart - schedStart;
          if (late > 720) late -= 1440;
          if (late < -720) late += 1440;
          lateMins = Math.max(0, late);
          empLateMinutes += lateMins;
        }

        diffMins = dayNet - schedDuration;
        empDiffMinutes += diffMins;
      }

      sessions.forEach((wd, idx) => {
        const isFirst = idx === 0;
        const row: any[] = [];

        if (isFirst) {
          row.push({
            content: format(date, "EEE, MMM d"),
            rowSpan: sessions.length,
            styles: { fontStyle: "bold", lineWidth: { top: 0.2, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: LINE },
          });
        }

        const borderStyle = { lineWidth: { top: isFirst ? 0.2 : 0.1, right: 0.1, bottom: 0.1, left: 0.1 }, lineColor: LINE };
        const timeRange = `${wd.clockIn ? format(wd.clockIn, "HH:mm") : "-"} - ${wd.clockOut ? format(wd.clockOut, "HH:mm") : "-"}`;
        row.push({ content: timeRange, styles: { ...borderStyle, halign: "center" } });
        row.push({ content: wd.totalBreakMinutes > 0 ? formatMinutes(wd.totalBreakMinutes) : "-", styles: borderStyle });

        if (hasUnpaid) {
          row.push({
            content: wd.unpaidBreakMinutes > 0 ? `-${formatMinutes(wd.unpaidBreakMinutes)}` : "-",
            styles: { ...borderStyle, textColor: wd.unpaidBreakMinutes > 0 ? RED : MUTED },
          });
        }

        if (showScheduled && isFirst) {
          row.push({
            content: lateMins != null ? (lateMins > 0 ? `+${formatMinutes(lateMins)}` : "On time") : "-",
            rowSpan: sessions.length,
            styles: { ...borderStyle, textColor: lateMins != null && lateMins > 0 ? RED : POSITIVE, halign: "center" },
          });
          row.push({
            content: diffMins != null ? (diffMins >= 0 ? `+${formatMinutes(diffMins)}` : `-${formatMinutes(Math.abs(diffMins))}`) : "-",
            rowSpan: sessions.length,
            styles: { ...borderStyle, textColor: diffMins != null ? (diffMins >= 0 ? POSITIVE : RED) : MUTED, halign: "center" },
          });
        }

        if (isFirst) {
          row.push({
            content: formatHoursDecimal(dayNet) + " h",
            rowSpan: sessions.length,
            styles: { ...borderStyle, fontStyle: "bold", halign: "right" },
          });
        }

        rows.push(row);
      });
    });

    if (rows.length === 0) {
      rows.push(["No completed shifts in this period.", "", "", ...(hasUnpaid ? [""] : []), ...(showScheduled ? ["", ""] : []), ""]);
    }

    const head: string[][] = [[
      "Date",
      "Time", "Break",
      ...(hasUnpaid ? ["Unpaid"] : []),
      ...(showScheduled ? ["Arrived Late", "Over / Under"] : []),
      "Hours",
    ]];

    const totalHoursStr = empNetHoursDisplay.toFixed(2) + " h";
    const reportTableWidth = pageWidth - pageMargin * 2;
    const timesheetColumns = [
      { weight: 1.45 },
      { weight: 1.7, halign: "center" },
      { weight: 1.05, halign: "center" },
      ...(hasUnpaid ? [{ weight: 1.05, halign: "center" }] : []),
      ...(showScheduled ? [{ weight: 1.25, halign: "center" }, { weight: 1.25, halign: "center" }] : []),
      { weight: 1.1, halign: "right" },
    ];
    const timesheetWeight = timesheetColumns.reduce((sum, col) => sum + col.weight, 0);
    const timesheetColumnStyles: Record<number, any> = Object.fromEntries(
      timesheetColumns.map((col, index) => [
        index,
        {
          cellWidth: (reportTableWidth * col.weight) / timesheetWeight,
          ...(col.halign ? { halign: col.halign } : {}),
        },
      ])
    );
    const footerCells: any[] = [
      { content: `Total: ${empWorkdaysByDate.length} shift${empWorkdaysByDate.length !== 1 ? "s" : ""}`, colSpan: 3 + (hasUnpaid ? 1 : 0) + (showScheduled ? 2 : 0), styles: { halign: "right", fontStyle: "bold" } },
      { content: totalHoursStr, styles: { halign: "right", fontStyle: "bold" } },
    ];

    // Track which PDF pages this employee's table spans, for sheet numbering
    const empRenderedPages: number[] = [];
    let empSheetCount = 0;

    autoTable(doc, {
      startY: hasPaidBreakNote ? 32 : 26,
      margin: { top: 22, right: pageMargin, bottom: 8, left: pageMargin },
      head,
      body: rows,
      foot: [footerCells],
      showFoot: "lastPage",
      headStyles: { fillColor: TEA, textColor: 255, fontStyle: "bold", fontSize: 10, lineWidth: 0.1, lineColor: [135, 162, 135] },
      footStyles: { fillColor: HEADER_BG, textColor: INK, fontStyle: "bold", fontSize: 10, lineWidth: 0.1, lineColor: LINE },
      styles: { fontSize: 10, cellPadding: { top: 1.7, right: 1.8, bottom: 1.7, left: 1.8 }, lineWidth: 0.1, lineColor: LINE, valign: "middle", overflow: "linebreak" },
      columnStyles: timesheetColumnStyles,
      tableWidth: reportTableWidth,
      didDrawPage: () => {
        empSheetCount++;
        const curPage = (doc.internal as any).getCurrentPageInfo().pageNumber;
        empRenderedPages.push(curPage);
        if (empSheetCount > 1) {
          drawContinuationHeader(empLabel);
        }
      },
    });

    // Go back and stamp "Sheet X of N" on every page for this employee (only if multi-page)
    if (empSheetCount > 1) {
      empRenderedPages.forEach((pageNum, idx) => {
        doc.setPage(pageNum);
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...MUTED);
        doc.text(`Sheet ${idx + 1} of ${empSheetCount}`, pageWidth - pageMargin, 8, { align: "right" });
      });
      // return to the last page of this employee
      doc.setPage(empRenderedPages[empRenderedPages.length - 1]);
    }

    summaries.push({
      name: emp.name,
      daysWorked: empWorkdaysByDate.length,
      netMinutes: Math.round(empNetHoursDisplay * 60),
      unpaidMinutes: Math.round(empUnpaidHoursDisplay * 60),
      totalLateMinutes: empLateMinutes,
      totalDiffMinutes: empDiffMinutes,
      scheduledDays: empScheduledDays,
      netHoursDisplay: empNetHoursDisplay,
    });
  });

  if (selectedEmps.length > 1) {
    doc.addPage("a4", "portrait");

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEA);
    doc.text("Timesheet Summary", pageMargin, 10);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(rangeLabel, pageWidth - pageMargin, 10, { align: "right" });
    doc.text(`${selectedEmps.length} employees - ${summaries.reduce((s, e) => s + e.daysWorked, 0)} total shifts`, pageMargin, 15);

    const grandHours = parseFloat(summaries.reduce((s, e) => s + e.netHoursDisplay, 0).toFixed(2));
    const grandUnpaid = summaries.reduce((s, e) => s + e.unpaidMinutes, 0);

    const summaryRows = summaries.map(s => [
      s.name,
      String(s.daysWorked),
      s.netHoursDisplay.toFixed(2) + " h",
      ...(hasUnpaid ? [s.unpaidMinutes > 0 ? `-${formatMinutes(s.unpaidMinutes)}` : "-"] : []),
      ...(showScheduled ? [
        s.scheduledDays > 0 && s.totalLateMinutes > 0 ? `+${formatMinutes(s.totalLateMinutes)}` : s.scheduledDays > 0 ? "On time" : "-",
        s.scheduledDays > 0 ? (s.totalDiffMinutes >= 0 ? `+${formatMinutes(s.totalDiffMinutes)}` : `-${formatMinutes(Math.abs(s.totalDiffMinutes))}`) : "-",
      ] : []),
    ]);

    const summaryHead = [["Employee", "Shifts", "Total Hours", ...(hasUnpaid ? ["Unpaid Break"] : []), ...(showScheduled ? ["Total Late", "Over / Under"] : [])]];

    const summaryFootColSpan = 2 + (hasUnpaid ? 1 : 0) + (showScheduled ? 2 : 0);
    const summaryFoot: any[][] = [[
      { content: "Grand Total", colSpan: summaryFootColSpan, styles: { halign: "right", fontStyle: "bold" } },
      { content: grandHours.toFixed(2) + " h", styles: { fontStyle: "bold" } },
    ]];
    const summaryTableWidth = pageWidth - pageMargin * 2;
    const summaryColumns = [
      { weight: 2.6, fontStyle: "bold" },
      { weight: 0.8, halign: "center" },
      { weight: 1.1, halign: "right" },
      ...(hasUnpaid ? [{ weight: 1.1, halign: "center", textColor: RED }] : []),
      ...(showScheduled ? [{ weight: 1.1, halign: "center" }, { weight: 1.2, halign: "center" }] : []),
    ];
    const summaryWeight = summaryColumns.reduce((sum, col) => sum + col.weight, 0);
    const summaryColumnStyles: Record<number, any> = Object.fromEntries(
      summaryColumns.map((col, index) => [
        index,
        {
          cellWidth: (summaryTableWidth * col.weight) / summaryWeight,
          ...(col.halign ? { halign: col.halign } : {}),
          ...(col.fontStyle ? { fontStyle: col.fontStyle } : {}),
          ...(col.textColor ? { textColor: col.textColor } : {}),
        },
      ])
    );

    autoTable(doc, {
      startY: 20,
      margin: { top: 14, right: pageMargin, bottom: 8, left: pageMargin },
      head: summaryHead,
      body: summaryRows,
      foot: summaryFoot,
      headStyles: { fillColor: TEA, textColor: 255, fontStyle: "bold", fontSize: 9.8, lineWidth: 0.1, lineColor: [135, 162, 135] },
      footStyles: { fillColor: HEADER_BG, textColor: INK, fontStyle: "bold", fontSize: 9.8, lineWidth: 0.1, lineColor: LINE },
      styles: { fontSize: 9.8, cellPadding: { top: 1.6, right: 1.8, bottom: 1.6, left: 1.8 }, lineWidth: 0.1, lineColor: LINE, valign: "middle" },
      columnStyles: summaryColumnStyles,
      tableWidth: summaryTableWidth,
    });

    if (grandUnpaid > 0) {
      const finalY = (doc as any).lastAutoTable.finalY + 6;
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 120);
      doc.text(`Total unpaid break time across all employees: ${formatMinutes(grandUnpaid)}`, pageMargin, finalY);
    }
  }

  const safeLabel = rangeLabel.replace(/[^a-zA-Z0-9-]/g, "_");
  const ts = Date.now();
  doc.save(`timesheets_${safeLabel}_${ts}.pdf`);
}

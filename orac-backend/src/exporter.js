import { countedTimesheets } from "./timesheetReview.js";
import { formatBusinessDate } from "./businessTimezone.js";
import { BusinessRuleError } from "./shared/errors/BusinessRuleError.js";

// A review-export date cell must come from a calendar date or from a timestamp that
// carries an explicit zone. Anything else (missing, impossible, unparseable or
// zone-less) is refused instead of being exported as a blank or host-zone-guessed date.
const STRICT_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STRICT_ZONED_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:[Zz]|[+-](\d{2}):?(\d{2}))$/;

function isRealCalendarDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isAcceptedStoredDate(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  let match = STRICT_ISO_DATE.exec(value);
  if (match) return isRealCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
  match = STRICT_ZONED_DATETIME.exec(value);
  if (!match) return false;
  const [, y, mo, d, hh, mi, ss, oh, om] = match;
  if (!isRealCalendarDay(Number(y), Number(mo), Number(d))) return false;
  if (Number(hh) > 23 || Number(mi) > 59 || (ss !== undefined && Number(ss) > 59)) return false;
  if (oh !== undefined && (Number(oh) > 23 || Number(om) > 59)) return false;
  return true;
}

// Same source-field fallback the exporter always used (primary, else fallback). Returns the
// business date, or "" with the name of the field that was read, for safe correction info.
function resolveExportDate(record, primaryField, fallbackField, timezone) {
  const usesFallback = !record[primaryField] && Boolean(record[fallbackField]);
  const field = usesFallback ? fallbackField : primaryField;
  const raw = record[field];
  if (!raw || !isAcceptedStoredDate(raw)) return { date: "", field, ok: false };
  const date = formatBusinessDate(raw, timezone);
  return { date, field, ok: date !== "" };
}

function csvEscape(value) {
  let text = String(value ?? "");
  // Neutralise spreadsheet formulas in text cells (client names, PO references
  // and descriptions are user-entered). Real numbers are left untouched.
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportInvoicesCsv(db, { timezone } = {}) {
  const headers = [
    "transaction_type",
    "transaction_id",
    "date",
    "client_id",
    "client_name",
    "po_reference",
    "asset_tag_id",
    "cost_center",
    "gl_account_code",
    "description",
    "labor_hours",
    "material_cost",
    "total_invoiced_amount"
  ];

  const rows = [headers];
  const dateIssues = [];
  for (const invoice of db.invoices || []) {
    // Exclude voided invoices from current billable review output
    if (invoice.status === "voided") continue;

    const po = (db.purchase_orders || []).find((item) => item.id === invoice.purchase_order_id);
    const quote = (db.quotes || []).find((item) => item.id === po?.quotation_id);
    const client = (db.clients || []).find((item) => item.id === quote?.client_id);
    const job = (db.dispatch_cards || []).find((item) => item.id === invoice.dispatch_card_id);
    const equipment = (db.equipment_tags || []).find((item) => item.id === job?.equipment_tag_id);
    const lines = (db.invoice_lines || []).filter((item) => item.invoice_id === invoice.id);
    const laborHours = countedTimesheets(db, job?.id)
      .reduce((sum, item) => sum + Number(item.hours_logged || 0), 0);
    const materialCost = (db.material_usage || [])
      .filter((item) => item.dispatch_card_id === job?.id)
      .reduce((sum, item) => sum + Number(item.total_cost || 0), 0);

    const invoiceDate = resolveExportDate(invoice, "generated_at", "created_at", timezone);
    if (!invoiceDate.ok) {
      dateIssues.push({ record_type: "invoice", record_id: invoice.invoice_number || invoice.id || null, field: invoiceDate.field });
    }
    const invDate = invoiceDate.date;

    if (lines.length === 0) {
      rows.push([
        "invoice",
        invoice.invoice_number,
        invDate,
        client?.id || "",
        client?.name || "",
        po?.po_reference || "",
        equipment?.tag_code || "",
        "",
        "",
        "Field service invoice",
        laborHours,
        materialCost,
        invoice.total_amount
      ]);
    } else if (lines.length === 1) {
      const line = lines[0];
      rows.push([
        "invoice",
        invoice.invoice_number,
        invDate,
        client?.id || "",
        client?.name || "",
        po?.po_reference || "",
        equipment?.tag_code || "",
        line.cost_center || "",
        line.gl_account_code || "",
        line.description || "",
        laborHours,
        materialCost,
        Number(line.line_total ?? invoice.total_amount)
      ]);
    } else {
      // Multiple lines: allocate hours and material costs to respective lines to avoid
      // multiplying totals and costs when summed across the export
      for (const line of lines) {
        const isLabour = line.gl_account_code === "SALES-SERVICE" || /labou?r/i.test(line.description || "");
        const isMaterial = line.gl_account_code === "SALES-MATERIALS" || /material/i.test(line.description || "");
        const lineHours = isLabour ? (Number(line.quantity) || laborHours) : 0;
        const lineMatCost = isMaterial ? Number(line.line_total || materialCost) : 0;
        const lineAmount = Number(line.line_total ?? line.amount ?? 0);

        rows.push([
          "invoice",
          invoice.invoice_number,
          invDate,
          client?.id || "",
          client?.name || "",
          po?.po_reference || "",
          equipment?.tag_code || "",
          line.cost_center || "",
          line.gl_account_code || "",
          line.description || "",
          lineHours,
          lineMatCost,
          lineAmount
        ]);
      }
    }

    for (const creditNote of (db.invoice_credit_notes || []).filter((item) => item.invoice_id === invoice.id && item.status === "issued")) {
      const creditDate = resolveExportDate(creditNote, "issued_at", "prepared_at", timezone);
      if (!creditDate.ok) {
        dateIssues.push({ record_type: "credit_note", record_id: creditNote.id || null, field: creditDate.field });
      }
      rows.push([
        "credit_note",
        creditNote.id,
        creditDate.date,
        client?.id || "",
        client?.name || "",
        po?.po_reference || "",
        equipment?.tag_code || "",
        "",
        "",
        `Credit note: ${creditNote.reason}`,
        0,
        0,
        -Math.abs(Number(creditNote.amount || 0))
      ]);
    }
  }

  if (dateIssues.length > 0) {
    // Refuse the whole review export. Only record type, identifier and field name are
    // reported; the stored date value itself is never echoed.
    throw new BusinessRuleError(
      `Review export refused: ${dateIssues.length} issued record(s) have a missing or invalid date. Correct the listed field on each record and export again.`,
      { records: dateIssues }
    );
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

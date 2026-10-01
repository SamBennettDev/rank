/** Minimal RFC 4180 CSV reader/writer. Always LF line endings, always a trailing newline. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Parses CSV with a header row into objects keyed by header name. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const [header, ...rest] = parseCsv(text);
  if (!header) return [];
  return rest.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function escapeField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: string[], rows: (string | number | boolean | null)[][]): string {
  const lines = [header, ...rows.map((r) => r.map((v) => (v === null ? "" : String(v))))];
  return lines.map((r) => r.map(escapeField).join(",")).join("\n") + "\n";
}

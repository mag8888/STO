import { google } from "googleapis";
import type { ParsedOrder } from "./ai.js";

// ─── Pricelist (read-only, public CSV) ────────────────────────────────────────

export interface PriceItem {
    code: string;
    name: string;
    price: number;
    unit: string;
}

let cachedPricelist: PriceItem[] | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchPricelist(): Promise<PriceItem[]> {
    if (cachedPricelist && Date.now() < cacheExpiry) return cachedPricelist;
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    if (!sheetId) throw new Error("GOOGLE_SHEETS_ID not set");

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch pricelist: ${response.status} ${response.statusText}.\n` +
            `Make sure the sheet is shared as "Anyone with the link can view".`
        );
    }

    const csv = await response.text();
    const items = parseCsv(csv);
    cachedPricelist = items;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return items;
}

function parseCsv(csv: string): PriceItem[] {
    const lines = csv.trim().split("\n");
    const items: PriceItem[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = parseCsvLine(line);
        if (cols.length < 2) continue;
        const code = (cols[0] ?? "").trim();
        const name = (cols[1] ?? "").trim();
        const price = parseFloat((cols[2] ?? "0").trim().replace(",", ".").replace(/[^\d.]/g, ""));
        const unit = (cols[3] ?? "шт").trim();
        if (name) items.push({ code, name, price: isNaN(price) ? 0 : price, unit });
    }
    return items;
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
        else { current += ch; }
    }
    result.push(current);
    return result;
}

export function findPriceItem(workName: string, pricelist: PriceItem[]): PriceItem | undefined {
    const needle = workName.toLowerCase().trim();
    let match = pricelist.find(p => p.name.toLowerCase() === needle || p.code.toLowerCase() === needle);
    if (!match) match = pricelist.find(p => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()));
    return match;
}

// ─── Google Sheets write (service account) ────────────────────────────────────

/**
 * Append a digitized ZN (заказ-наряд) to the Google Sheet as a new block of rows.
 *
 * Requires env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — full JSON of the service account key file
 *   GOOGLE_SHEETS_ZN_ID          — spreadsheet ID to write to (may equal GOOGLE_SHEETS_ID)
 *   GOOGLE_SHEETS_ZN_TAB         — sheet tab name, e.g. "ЗН" (defaults to first sheet)
 */
export async function appendZnToSheet(
    parsed: ParsedOrder,
    fileName: string,
    stationName: string,
): Promise<void> {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!saJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set. See /admin for setup instructions.");

    const sheetId = process.env.GOOGLE_SHEETS_ZN_ID || process.env.GOOGLE_SHEETS_ID;
    if (!sheetId) throw new Error("GOOGLE_SHEETS_ZN_ID not set.");

    const tabName = process.env.GOOGLE_SHEETS_ZN_TAB || "ЗН";

    const credentials = JSON.parse(saJson);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const now = new Date().toLocaleDateString("ru-RU");
    const plate = parsed.plateNumber || parsed.vin || "—";
    const mileage = parsed.mileage ? String(parsed.mileage) : "—";

    // Build rows: header row + one row per item
    const rows: string[][] = [];

    // Separator / header row
    rows.push([
        `=== ${stationName} | ${fileName} | ${now} ===`,
        "", "", "", "", "", ""
    ]);

    // Column headers
    rows.push(["Дата", "Автосервис", "Госномер", "Пробег", "Наименование работы/запчасти", "Кол-во", "Цена", "Сумма"]);

    // Data rows
    for (const item of parsed.items) {
        rows.push([
            now,
            stationName,
            plate,
            mileage,
            item.workName,
            String(item.quantity),
            String(item.price),
            String(item.total),
        ]);
    }

    // Total row
    const grandTotal = parsed.items.reduce((s, i) => s + i.total, 0);
    rows.push(["", "", "", "", "ИТОГО:", "", "", String(grandTotal)]);

    // Empty separator
    rows.push(["", "", "", "", "", "", "", ""]);

    // Append to end of sheet
    await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${tabName}!A:H`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
    });
}

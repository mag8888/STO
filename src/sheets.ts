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
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchPricelist(): Promise<PriceItem[]> {
    if (cachedPricelist && Date.now() < cacheExpiry) return cachedPricelist;
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    if (!sheetId) throw new Error("GOOGLE_SHEETS_ID not set");
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch pricelist: ${response.status}`);
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
    const result: string[] = []; let current = ""; let inQuotes = false;
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
    return (
        pricelist.find(p => p.name.toLowerCase() === needle || p.code.toLowerCase() === needle) ||
        pricelist.find(p => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase()))
    );
}

// ─── Google Sheets write (Service Account) ────────────────────────────────────
//
// Required Railway env vars:
//   GOOGLE_SERVICE_ACCOUNT_JSON  — full contents of the service account .json key file
//   GOOGLE_SHEETS_ZN_ID          — spreadsheet ID to write to
//   GOOGLE_SHEETS_ZN_TAB         — sheet tab name, e.g. "ЗН" (default: "ЗН")

export async function appendZnToSheet(
    parsed: ParsedOrder,
    fileName: string,
    stationName: string,
): Promise<void> {
    const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const sheetId = process.env.GOOGLE_SHEETS_ZN_ID || process.env.GOOGLE_SHEETS_ID;
    const tabName = process.env.GOOGLE_SHEETS_ZN_TAB || "ЗН";

    if (!saJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
    if (!sheetId) throw new Error("GOOGLE_SHEETS_ZN_ID not set");

    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(saJson),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const now = parsed.date || new Date().toLocaleDateString("ru-RU");
    const plate = parsed.plateNumber || parsed.vin || "—";
    const mileage = parsed.mileage ? String(parsed.mileage) : "—";

    const rows: (string | number)[][] = [
        // Separator header
        [`=== ${stationName} | ${fileName} | ${now} ===`, "", "", "", "", "", "", ""],
        // Column headers
        ["Дата", "Автосервис", "Госномер", "Пробег", "Наименование работы/запчасти", "Кол-во", "Цена", "Сумма"],
        // Data rows
        ...parsed.items.map(i => [now, stationName, plate, mileage, i.workName, i.quantity, i.price, i.total]),
        // Total
        ["", "", "", "", "ИТОГО:", "", "", parsed.items.reduce((s, i) => s + i.total, 0)],
        // Empty separator row
        ["", "", "", "", "", "", "", ""],
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${tabName}!A:H`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
    });

    console.log(`✅ Appended ${parsed.items.length} rows to Sheets tab "${tabName}"`);
}

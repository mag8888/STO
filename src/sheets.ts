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

// ─── Google Sheets write via Apps Script Web App ──────────────────────────────
//
// Setup (one-time):
//   1. Open your Google Sheet → Extensions → Apps Script
//   2. Paste the script from https://github.com/mag8888/STO (see docs)
//   3. Deploy → New deployment → Web app → Anyone → Copy URL
//   4. Add to Railway Variables: GOOGLE_SCRIPT_URL = <that URL>
//              (optionally)      GOOGLE_SHEETS_ZN_TAB = "ЗН"
//
// No keys, no service accounts — just a URL!

export async function appendZnToSheet(
    parsed: ParsedOrder,
    fileName: string,
    stationName: string,
): Promise<void> {
    const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!scriptUrl) throw new Error("GOOGLE_SCRIPT_URL not set");

    const payload = {
        tab: process.env.GOOGLE_SHEETS_ZN_TAB || "ЗН",
        station: stationName,
        fileName,
        plate: parsed.plateNumber || parsed.vin || "",
        mileage: parsed.mileage ? String(parsed.mileage) : "",
        date: parsed.date || new Date().toLocaleDateString("ru-RU"),
        items: parsed.items.map(i => ({
            workName: i.workName,
            quantity: i.quantity,
            price: i.price,
            total: i.total,
        })),
    };

    // Google Apps Script redirects POST → GET when deployed as web app,
    // so we must follow redirects and use the right content type.
    const response = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        redirect: "follow",
    });

    const text = await response.text();
    if (!response.ok && !text.includes("OK")) {
        throw new Error(`Script error ${response.status}: ${text.slice(0, 200)}`);
    }
}

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
    // Return cache if still valid
    if (cachedPricelist && Date.now() < cacheExpiry) {
        return cachedPricelist;
    }

    const sheetId = process.env.GOOGLE_SHEETS_ID;
    if (!sheetId) throw new Error("GOOGLE_SHEETS_ID not set");

    // Public CSV export URL (works when sheet is shared as "Anyone with the link can view")
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

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Handle quoted CSV values
        const cols = parseCsvLine(line);
        if (cols.length < 2) continue;

        const code = (cols[0] ?? "").trim();
        const name = (cols[1] ?? "").trim();
        const price = parseFloat((cols[2] ?? "0").trim().replace(",", ".").replace(/[^\d.]/g, ""));
        const unit = (cols[3] ?? "шт").trim();

        if (name) {
            items.push({ code, name, price: isNaN(price) ? 0 : price, unit });
        }
    }

    return items;
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
            result.push(current);
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

/**
 * Find a matching price item by work name using simple fuzzy matching
 */
export function findPriceItem(workName: string, pricelist: PriceItem[]): PriceItem | undefined {
    const needle = workName.toLowerCase().trim();

    // Exact match first
    let match = pricelist.find(
        (p) => p.name.toLowerCase() === needle || p.code.toLowerCase() === needle
    );

    // Partial match fallback
    if (!match) {
        match = pricelist.find(
            (p) => p.name.toLowerCase().includes(needle) || needle.includes(p.name.toLowerCase())
        );
    }

    return match;
}

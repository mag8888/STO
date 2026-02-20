import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const TEMP_DIR = "./temp/downloads";

export function ensureTempDir(dir = TEMP_DIR) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/** Download any URL to a local file, following redirects */
export async function downloadFile(fileUrl: string, filename: string): Promise<string> {
    ensureTempDir();
    const filePath = path.join(TEMP_DIR, filename);
    return new Promise((resolve, reject) => {
        const download = (url: string, redirects = 10) => {
            if (redirects === 0) return reject(new Error("Too many redirects"));
            const lib = url.startsWith("https") ? https : http;
            lib.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "*/*",
                }
            }, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
                    return download(res.headers.location, redirects - 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                }
                const file = fs.createWriteStream(filePath);
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(filePath); });
                file.on("error", (e) => { fs.unlinkSync(filePath); reject(e); });
            }).on("error", reject);
        };
        download(fileUrl);
    });
}

export function cleanupFile(filePath: string) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { }
}

export function isImageFile(f: string) { return /\.(jpg|jpeg|png|webp|gif)$/i.test(f); }
export function isPdfFile(f: string) { return /\.pdf$/i.test(f); }
export function isExcelFile(f: string) { return /\.(xlsx|xls)$/i.test(f); }
export function isArchiveFile(f: string) { return /\.(rar|zip|7z)$/i.test(f); }

// ──────────────────────────────────────────────────────
// Google Drive helpers — no API key required
// ──────────────────────────────────────────────────────

export type DriveItem = { id: string; name: string; mimeType: string };

/** Extract Google Drive file/folder ID from any share URL */
export function parseDriveUrl(url: string): { type: "file" | "folder"; id: string } | null {
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
    if (folderMatch) return { type: "folder", id: folderMatch[1]! };

    const fileMatch =
        url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/) ||
        url.match(/\/d\/([a-zA-Z0-9_-]{10,})\//) ||
        url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (fileMatch) return { type: "file", id: fileMatch[1]! };

    return null;
}

/** List files in a public Google Drive folder by scraping the embedded JSON data */
export async function listDriveFolder(folderId: string): Promise<DriveItem[]> {
    // Fetch the folder page — Google embeds all file metadata as JSON in the HTML
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    });

    if (!res.ok) throw new Error(`Cannot access folder: ${res.status}`);
    const html = await res.text();

    const items: DriveItem[] = [];
    const seen = new Set<string>();

    // Strategy 1: Extract from JSON blobs embedded in the page
    // Google Drive embeds file data arrays in various wiz_jd / AF_initDataCallback calls
    // Pattern: ["ID", "NAME", null, null, [...], null, null, null, "MIME_TYPE"]
    // File IDs are 25-33 chars, alphanumeric + _ + -

    const idPattern = /["']([a-zA-Z0-9_-]{25,})['"]/g;
    const nameAfterIdPattern = /["']([a-zA-Z0-9_-]{25,})['"]\s*,\s*["']([^"']{2,200})['"]/g;

    let match;

    // Look for MIME type arrays with names
    const jsonBlocks = html.match(/\[\[["'][a-zA-Z0-9_-]{25,}["'],[^\]]{10,500}\]\]/g) || [];
    for (const block of jsonBlocks) {
        try {
            // Try to extract id + name from the block
            const idM = block.match(/["']([a-zA-Z0-9_-]{25,})['"]/);
            const nameM = block.match(/["']([^\\"']{3,100}\.[a-zA-Z]{2,5})['"]/);
            if (idM && nameM && !seen.has(idM[1]!)) {
                const mimeType = guessType(nameM[1]!);
                items.push({ id: idM[1]!, name: nameM[1]!, mimeType });
                seen.add(idM[1]!);
            }
        } catch { }
    }

    // Strategy 2: Find filenames with extensions near IDs
    // Scan for patterns like: "1abc...xyz","Заказ-наряд № 123.pdf"
    const nameAndId = /["']([a-zA-Z0-9_-]{25,})['"]\s*,\s*["']([^"'\\]{2,150}\.[a-zA-Z]{2,5})['"]/g;
    while ((match = nameAndId.exec(html)) !== null) {
        const [, id, name] = match;
        if (id && name && !seen.has(id)) {
            seen.add(id);
            items.push({ id, name, mimeType: guessType(name) });
        }
    }

    // Strategy 3: Reversed order — filename then ID (also common in Drive HTML)
    const nameAndIdReverse = /["']([^"'\\]{2,150}\.[a-zA-Z]{2,5})['"]\s*,\s*["']([a-zA-Z0-9_-]{25,})['"]/g;
    while ((match = nameAndIdReverse.exec(html)) !== null) {
        const [, name, id] = match;
        if (id && name && !seen.has(id)) {
            seen.add(id);
            items.push({ id, name, mimeType: guessType(name) });
        }
    }

    console.log(`[Drive] Found ${items.length} files in folder ${folderId}`);
    return items;
}

function guessType(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop() || "";
    const map: Record<string, string> = {
        pdf: "application/pdf",
        jpg: "image/jpeg", jpeg: "image/jpeg",
        png: "image/png", webp: "image/webp",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        doc: "application/msword",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        zip: "application/zip",
        rar: "application/x-rar-compressed",
    };
    return map[ext] || "application/octet-stream";
}

/** Download a file from Google Drive (handles both small files and large files with virus scan confirmation) */
export async function downloadDriveFile(fileId: string, fileName: string): Promise<string> {
    ensureTempDir();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._\-а-яёА-ЯЁ]/g, "_");
    const filePath = path.join(TEMP_DIR, safeFileName);

    // Use the usercontent URL which handles auth/redirects automatically
    const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;

    return new Promise((resolve, reject) => {
        const download = (url: string, redirects = 10) => {
            if (redirects === 0) return reject(new Error("Too many redirects"));
            const lib = url.startsWith("https") ? https : http;
            const req = lib.get(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "*/*",
                    "Cookie": "download_warning=t",
                }
            }, (res) => {
                // Follow redirects
                if ([301, 302, 303, 307, 308].includes(res.statusCode!) && res.headers.location) {
                    return download(res.headers.location, redirects - 1);
                }

                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode} downloading file ${fileId}`));
                }

                // Check content type — if it's HTML, it's probably a confirm page
                const contentType = res.headers["content-type"] || "";
                if (contentType.includes("text/html")) {
                    // Read the HTML and look for the confirm download link
                    let html = "";
                    res.on("data", (chunk: Buffer) => { html += chunk.toString(); });
                    res.on("end", () => {
                        const confirmMatch = html.match(/href="(\/uc\?[^"]*confirm=[^"]+)"/i)
                            || html.match(/action="(https:\/\/drive\.usercontent[^"]+)"/i);
                        if (confirmMatch) {
                            const confirmUrl = confirmMatch[1]!.startsWith("http")
                                ? confirmMatch[1]!
                                : `https://drive.google.com${confirmMatch[1]!}`;
                            download(confirmUrl.replace(/&amp;/g, "&"), redirects - 1);
                        } else {
                            // Try alternative download URL
                            const altUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
                            download(altUrl, redirects - 1);
                        }
                    });
                    return;
                }

                const file = fs.createWriteStream(filePath);
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(filePath); });
                file.on("error", (e) => { try { fs.unlinkSync(filePath); } catch { } reject(e); });
            });
            req.on("error", reject);
        };
        download(downloadUrl);
    });
}

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

export async function downloadFile(fileUrl: string, filename: string): Promise<string> {
    ensureTempDir();
    const filePath = path.join(TEMP_DIR, filename);
    return new Promise((resolve, reject) => {
        const download = (url: string, redirects = 5) => {
            if (redirects === 0) return reject(new Error("Too many redirects"));
            const lib = url.startsWith("https") ? https : http;
            lib.get(url, (res) => {
                if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                    return download(res.headers.location, redirects - 1);
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                const file = fs.createWriteStream(filePath);
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(filePath); });
                file.on("error", reject);
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

// ──────────────────────────────────────
// Google Drive helpers (public files, no API key needed)
// ──────────────────────────────────────

export type DriveItem = { id: string; name: string; mimeType: string };

/** Extract Google Drive file/folder ID from any share URL */
export function parseDriveUrl(url: string): { type: "file" | "folder"; id: string } | null {
    // Folder: /folders/ID
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]{25,})/);
    if (folderMatch) return { type: "folder", id: folderMatch[1]! };

    // File: /file/d/ID or /d/ID or id=ID
    const fileMatch = url.match(/\/(?:file\/d|d)\/([a-zA-Z0-9_-]{25,})/)
        || url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
    if (fileMatch) return { type: "file", id: fileMatch[1]! };

    return null;
}

/** List files in a public Google Drive folder using the export URL trick */
export async function listDriveFolder(folderId: string): Promise<DriveItem[]> {
    // Use the "embedded" folder view that returns JSON-like data
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html",
        },
    });

    if (!res.ok) throw new Error(`Cannot access folder: ${res.status}`);
    const html = await res.text();

    // Extract file metadata from the page's embedded JSON
    const items: DriveItem[] = [];
    // Google Drive embeds file data in window['_DRIVE_ivd'] or similar JSON blobs
    // Pattern: ["FILE_ID","NAME",...,"mimeType",...]
    const regex = /\["(1[a-zA-Z0-9_-]{24,}[a-zA-Z0-9])","([^"]+)",[^\]]+?"(application\/pdf|image\/jpeg|image\/png|application\/vnd\.openxmlformats|application\/zip|application\/x-rar)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const [, id, name, mimeType] = match;
        if (id && name && mimeType) {
            items.push({ id, name, mimeType });
        }
    }

    return items;
}

/** Direct download URL for a Google Drive file */
export function getDriveDownloadUrl(fileId: string): string {
    return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
}

/** Download a Google Drive file to temp directory */
export async function downloadDriveFile(fileId: string, fileName: string): Promise<string> {
    const url = getDriveDownloadUrl(fileId);
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return downloadFile(url, safeFileName);
}

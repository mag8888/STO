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
                if ([301, 302, 307].includes(res.statusCode!) && res.headers.location) {
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

/**
 * List files in a public Google Drive folder.
 * Uses the verified pattern found in Drive's embedded HTML:
 * "FILE_ID"],null,null,null,"MIME_TYPE" ... within 700 chars ... "FILENAME.ext"
 */
export async function listDriveFolder(folderId: string): Promise<DriveItem[]> {
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    });

    if (!res.ok) throw new Error(`Cannot access Google Drive folder: ${res.status}`);
    const html = await res.text();

    // Decode HTML entities — Drive embeds JSON with &quot; etc.
    const decoded = html
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'");

    const items: DriveItem[] = [];
    const seen = new Set<string>();

    // Verified pattern: file ID appears immediately before its MIME type in the embedded JSON blob
    const MIMES = [
        "application\\/pdf",
        "image\\/jpeg", "image\\/png", "image\\/webp",
        "application\\/vnd\\.openxmlformats-officedocument\\.wordprocessingml\\.document",
        "application\\/msword",
    ].join("|");

    const idAndMimeRe = new RegExp(
        `"([a-zA-Z0-9_-]{25,})"[^\\]]*\\],null,null,null,"(${MIMES})"`,
        "g"
    );

    let m: RegExpExecArray | null;
    while ((m = idAndMimeRe.exec(decoded)) !== null) {
        const id = m[1]!;
        const mimeType = m[2]!;
        if (seen.has(id)) continue;

        // Filename appears within 700 chars of the ID, identified by having an extension
        const chunk = decoded.substring(m.index, m.index + 700);
        const fnMatch = chunk.match(/"([^"]{2,200}\.(?:pdf|PDF|docx|doc|jpg|jpeg|png|webp|xlsx|zip|rar))"/i);
        if (fnMatch) {
            seen.add(id);
            items.push({ id, name: fnMatch[1]!.replace(/\n/g, " ").trim(), mimeType });
        }
    }

    console.log(`[Drive] Found ${items.length} files in folder ${folderId}`);
    return items;
}

/** Download a file from Google Drive, handling the virus-scan confirmation redirect */
export async function downloadDriveFile(fileId: string, fileName: string): Promise<string> {
    ensureTempDir();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._\-а-яёА-ЯЁ]/g, "_");
    const filePath = path.join(TEMP_DIR, safeFileName);

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
                if ([301, 302, 303, 307, 308].includes(res.statusCode!) && res.headers.location) {
                    return download(res.headers.location, redirects - 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode} downloading file ${fileId}`));
                }

                // If Google returns HTML (confirmation page), extract the real download link
                const contentType = res.headers["content-type"] || "";
                if (contentType.includes("text/html")) {
                    let body = "";
                    res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                    res.on("end", () => {
                        const confirmMatch =
                            body.match(/href="(\/uc\?[^"]*confirm=[^"]+)"/i) ||
                            body.match(/action="(https:\/\/drive\.usercontent[^"]+)"/i);
                        if (confirmMatch) {
                            const confirmUrl = confirmMatch[1]!.startsWith("http")
                                ? confirmMatch[1]!
                                : `https://drive.google.com${confirmMatch[1]!}`;
                            download(confirmUrl.replace(/&amp;/g, "&"), redirects - 1);
                        } else {
                            // Fallback: legacy uc endpoint
                            download(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`, redirects - 1);
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

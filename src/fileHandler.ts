import * as fs from "fs";
import * as path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";

const TEMP_DIR = "./temp/downloads";

export function ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
}

export async function downloadFile(
    fileUrl: string,
    filename: string
): Promise<string> {
    ensureTempDir();
    const filePath = path.join(TEMP_DIR, filename);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
    const fileStream = createWriteStream(filePath);
    await pipeline(response.body as any, fileStream);
    return filePath;
}

export function cleanupFile(filePath: string) {
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { }
}

export function isImageFile(filename: string): boolean {
    return /\.(jpg|jpeg|png|webp|gif)$/i.test(filename);
}

export function isPdfFile(filename: string): boolean {
    return /\.pdf$/i.test(filename);
}

export function isExcelFile(filename: string): boolean {
    return /\.(xlsx|xls)$/i.test(filename);
}

export function isArchiveFile(filename: string): boolean {
    return /\.(rar|zip|7z)$/i.test(filename);
}

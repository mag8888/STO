import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { extractOrderFromImage } from "./ai.js";
import { fetchPricelist, findPriceItem } from "./sheets.js";

// Google Drive folder ID
const FOLDER_ID = "1uEqnGKQAY0EjZKWQZhwjdWjeBOj9TIj9";
const TEMP_DIR = "./temp/test_files";

function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function downloadGoogleDriveFile(fileId: string, dest: string): Promise<void> {
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            if (res.statusCode === 302 && res.headers.location) {
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file);
                    file.on("finish", () => { file.close(); resolve(); });
                }).on("error", reject);
            } else {
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(); });
            }
        }).on("error", reject);
    });
}

async function listGoogleDriveFolder(folderId: string): Promise<Array<{ id: string, name: string, mimeType: string }>> {
    // Use Google Drive public API (no auth needed for public folders)
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&key=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY&fields=files(id,name,mimeType)&pageSize=20`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Drive API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json() as any;
    return data.files || [];
}

interface OrderResult {
    fileName: string;
    plateNumber?: string;
    vin?: string;
    mileage?: number;
    city?: string;
    items: Array<{ workName: string; quantity: number; price: number; total: number }>;
    needsOperatorReview: boolean;
    reviewReason?: string;
    priceWarnings: string[];
    error?: string;
}

async function processFile(filePath: string, fileName: string): Promise<OrderResult> {
    try {
        const parsed = await extractOrderFromImage(filePath);

        // Price validation
        const priceWarnings: string[] = [];
        try {
            const pricelist = await fetchPricelist();
            for (const item of parsed.items) {
                const priceItem = findPriceItem(item.workName, pricelist);
                if (priceItem && priceItem.price > 0 && item.price > priceItem.price) {
                    priceWarnings.push(
                        `"${item.workName}": факт ${item.price} руб., прайс ${priceItem.price} руб. (+${(item.price - priceItem.price).toFixed(0)} руб.)`
                    );
                }
            }
        } catch (e: any) {
            console.warn("Price check skipped:", e.message);
        }

        return {
            fileName,
            plateNumber: parsed.plateNumber,
            vin: parsed.vin,
            mileage: parsed.mileage,
            city: parsed.city,
            items: parsed.items,
            needsOperatorReview: parsed.needsOperatorReview || priceWarnings.length > 0,
            reviewReason: parsed.reviewReason,
            priceWarnings,
        };
    } catch (err: any) {
        return {
            fileName,
            items: [],
            needsOperatorReview: true,
            reviewReason: `Error: ${err.message}`,
            priceWarnings: [],
            error: err.message,
        };
    }
}

function printResult(result: OrderResult) {
    console.log("\n" + "=".repeat(60));
    console.log(`📄 Файл: ${result.fileName}`);
    console.log(`🚗 Госномер: ${result.plateNumber || "❓ Не найден"}`);
    console.log(`📍 Город: ${result.city || "❓ Не указан"}`);
    console.log(`🛣  Пробег: ${result.mileage ? result.mileage + " км" : "❓ Не указан"}`);
    console.log(`📦 Позиций: ${result.items.length}`);

    if (result.items.length > 0) {
        console.log("\n  Позиции:");
        result.items.forEach((item, i) => {
            console.log(`  ${i + 1}. ${item.workName}`);
            console.log(`     Qty: ${item.quantity}, Цена: ${item.price} руб., Итого: ${item.total} руб.`);
        });
    }

    const total = result.items.reduce((s, i) => s + i.total, 0);
    console.log(`\n💰 Общая сумма: ${total.toLocaleString("ru-RU")} руб.`);

    if (result.priceWarnings.length > 0) {
        console.log("\n⚠️  ПРЕВЫШЕНИЯ ПО ПРАЙСУ:");
        result.priceWarnings.forEach(w => console.log(`   • ${w}`));
    }

    if (result.needsOperatorReview) {
        console.log(`\n🔴 ТРЕБУЕТ ПРОВЕРКИ ОПЕРАТОРОМ`);
        if (result.reviewReason) console.log(`   Причина: ${result.reviewReason}`);
    } else {
        console.log(`\n✅ ОК — готов к загрузке в 1С`);
    }
}

async function main() {
    ensureDir(TEMP_DIR);
    console.log("🔍 Получаю список файлов из Google Drive...");

    let files: Array<{ id: string; name: string; mimeType: string }> = [];

    try {
        files = await listGoogleDriveFolder(FOLDER_ID);
        console.log(`📁 Найдено файлов: ${files.length}`);
    } catch (e: any) {
        console.error("❌ Ошибка получения списка файлов:", e.message);
        console.log("Попробую скачать напрямую по ссылке...");
        process.exit(1);
    }

    // Process first 5 PDF/image files for testing
    const testFiles = files
        .filter(f => f.mimeType.includes("pdf") || f.mimeType.includes("image"))
        .slice(0, 5);

    if (testFiles.length === 0) {
        console.log("❌ Подходящих файлов не найдено (PDF или изображения)");
        process.exit(1);
    }

    console.log(`\n🚀 Обрабатываю ${testFiles.length} файлов...\n`);

    const results: OrderResult[] = [];
    for (const file of testFiles) {
        console.log(`⏳ Скачиваю: ${file.name}...`);
        const ext = file.mimeType.includes("pdf") ? ".pdf" : ".jpg";
        const localPath = path.join(TEMP_DIR, `${file.id}${ext}`);

        try {
            await downloadGoogleDriveFile(file.id, localPath);
            console.log(`   ✅ Скачан. Распознаю через GPT-4o...`);
            const result = await processFile(localPath, file.name);
            results.push(result);
            printResult(result);
        } catch (e: any) {
            console.error(`   ❌ Ошибка: ${e.message}`);
        } finally {
            if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        }
    }

    // Summary
    console.log("\n\n" + "=".repeat(60));
    console.log("📊 ИТОГОВАЯ СВОДКА:");
    console.log(`   Всего обработано: ${results.length}`);
    console.log(`   Требуют проверки: ${results.filter(r => r.needsOperatorReview).length}`);
    console.log(`   Готовы для 1С:    ${results.filter(r => !r.needsOperatorReview).length}`);

    // Save JSON report
    const reportPath = "./temp/test_report.json";
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Детальный отчёт сохранён: ${reportPath}`);
}

main().catch(console.error);

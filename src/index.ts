import { Bot, InputFile } from "grammy";
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import prisma from "./db.js";
import {
    downloadFile, isImageFile, isPdfFile, isArchiveFile, cleanupFile,
    parseDriveUrl, listDriveFolder, downloadDriveFile, type DriveItem
} from "./fileHandler.js";
import { extractOrderFromImage } from "./ai.js";
import { fetchPricelist, findPriceItem } from "./sheets.js";
import { extractArchive } from "./archiver.js";
import { generateExcelReport, type ExportItem } from "./exporter.js";
import { registerAdminCommands } from "./admin.js";
import { startWebServer } from "./webServer.js";


const bot = new Bot(process.env.BOT_TOKEN!);

// ===== HELPERS =====

async function getOrCreateStation(chatId: bigint, chatName: string) {
    return prisma.serviceStation.upsert({
        where: { chatId },
        update: { name: chatName },
        create: { chatId, name: chatName },
    });
}

function getWeekLabel(date: Date): string {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatSummary(
    fileName: string,
    parsed: any,
    priceWarnings: string[]
): string {
    let msg = `📋 *Результат распознавания*\n`;
    msg += `📄 Файл: \`${fileName}\`\n\n`;
    msg += `🚗 Госномер: *${parsed.plateNumber || "❓ Не найден"}*\n`;
    if (parsed.vin) msg += `🔢 VIN: \`${parsed.vin}\`\n`;
    msg += `📍 Город: ${parsed.city || "❓"}\n`;
    msg += `🛣 Пробег: ${parsed.mileage ? parsed.mileage + " км" : "❓"}\n`;
    msg += `📦 Позиций: ${parsed.items?.length || 0}\n\n`;

    if (parsed.items?.length > 0) {
        msg += `*Позиции:*\n`;
        const MAX_ITEMS = 10;
        parsed.items.slice(0, MAX_ITEMS).forEach((item: any, i: number) => {
            msg += `${i + 1}. ${item.workName}\n`;
            msg += `   ${item.quantity} × ${item.price} = *${item.total} руб.*\n`;
        });
        if (parsed.items.length > MAX_ITEMS) {
            msg += `_...и ещё ${parsed.items.length - MAX_ITEMS} позиций_\n`;
        }
    }

    const total = parsed.items?.reduce((s: number, i: any) => s + (i.total || 0), 0) || 0;
    msg += `\n💰 *Итого: ${total.toLocaleString("ru-RU")} руб.*\n`;

    if (priceWarnings.length > 0) {
        msg += `\n⚠️ *Превышения по прайсу (${priceWarnings.length}):*\n`;
        priceWarnings.forEach(w => { msg += `• ${w}\n`; });
    }

    if (parsed.needsOperatorReview) {
        msg += `\n🔴 *ТРЕБУЕТ ПРОВЕРКИ ОПЕРАТОРОМ*\n`;
        if (parsed.reviewReason) msg += `Причина: _${parsed.reviewReason}_\n`;
    } else if (priceWarnings.length === 0) {
        msg += `\n✅ *Готов к загрузке в 1С*\n`;
    }

    return msg;
}

async function processSingleFile(
    ctx: any,
    filePath: string,
    fileName: string,
    batchId: number,
    stationId: number
): Promise<void> {
    if (!isImageFile(fileName) && !isPdfFile(fileName)) return;

    const parsed = await extractOrderFromImage(filePath);

    // Price validation
    const priceWarnings: string[] = [];
    try {
        const pricelist = await fetchPricelist();
        for (const item of parsed.items) {
            const priceItem = findPriceItem(item.workName, pricelist);
            if (priceItem && priceItem.price > 0 && item.price > priceItem.price) {
                priceWarnings.push(
                    `"${item.workName}": ${item.price} руб. → прайс ${priceItem.price} руб.`
                );
            }
        }
    } catch { }

    // Save items to DB
    for (const item of parsed.items) {
        await prisma.orderItem.create({
            data: {
                batchId,
                workName: item.workName,
                quantity: item.quantity,
                price: item.price,
                total: item.total,
                vin: parsed.vin,
                mileage: parsed.mileage,
                validationError: priceWarnings.length > 0 ? priceWarnings.join("; ") : null,
            },
        });
    }

    const summary = formatSummary(fileName, parsed, priceWarnings);
    await ctx.reply(summary, { parse_mode: "Markdown" });
}

// ===== COMMANDS =====

bot.command("start", async (ctx) => {
    const chat = await ctx.getChat();
    const station = await getOrCreateStation(
        BigInt(chat.id),
        chat.title || (chat as any).first_name || "Автосервис"
    );
    await ctx.reply(
        `✅ *STO Automation Bot* запущен!\n\n` +
        `📌 Автосервис: *${station.name}*\n` +
        `🆔 Chat ID: \`${chat.id}\`\n\n` +
        `Отправьте файл заказ-наряда (PDF, фото, ZIP, RAR) для обработки.\n` +
        `Напишите *ПРИНЯТО* для финального подтверждения.`,
        { parse_mode: "Markdown" }
    );
});

bot.command("export", async (ctx) => {
    const chat = await ctx.getChat();
    const station = await prisma.serviceStation.findUnique({
        where: { chatId: BigInt(chat.id) },
        include: {
            Batches: {
                where: { status: "APPROVED" },
                include: { Items: true },
                orderBy: { createdAt: "desc" },
                take: 10,
            },
        },
    });

    if (!station || station.Batches.length === 0) {
        await ctx.reply("❌ Нет подтверждённых пакетов для выгрузки.");
        return;
    }

    const exportItems: ExportItem[] = [];
    for (const batch of station.Batches) {
        for (const item of batch.Items) {
            exportItems.push({
                serviceStation: station.name || "Неизвестно",
                weekDate: getWeekLabel(batch.weekStartDate),
                plateNumber: item.vin || "—",
                vin: item.vin || undefined,
                mileage: item.mileage || undefined,
                city: undefined,
                workName: item.workName,
                quantity: item.quantity,
                price: item.price,
                total: item.total,
            });
        }
    }

    if (exportItems.length === 0) {
        await ctx.reply("❌ Нет данных для выгрузки.");
        return;
    }

    const reportPath = `./temp/export_${Date.now()}.xlsx`;
    await generateExcelReport(exportItems, reportPath);

    await ctx.replyWithDocument(new InputFile(reportPath, `1C_Заказ-наряды_${getWeekLabel(new Date())}.xlsx`), {
        caption: `📊 Выгрузка для 1С\n${exportItems.length} позиций из ${station.Batches.length} пакетов`,
    });

    cleanupFile(reportPath);
});

// ===== FILE HANDLING =====

bot.on(["message:photo", "message:document"], async (ctx) => {
    const chat = await ctx.getChat();
    const chatName = chat.title || (chat as any).first_name || "Автосервис";
    const station = await getOrCreateStation(BigInt(chat.id), chatName);

    let fileId: string | undefined;
    let fileName: string | undefined;

    if (ctx.message.photo) {
        const photo = ctx.message.photo.at(-1)!;
        fileId = photo.file_id;
        fileName = `photo_${Date.now()}.jpg`;
    } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileName = ctx.message.document.file_name || `doc_${Date.now()}`;
    }

    if (!fileId || !fileName) {
        await ctx.reply("❌ Не удалось получить файл.");
        return;
    }

    const processingMsg = await ctx.reply(`⏳ Обрабатываю: *${fileName}*...`, { parse_mode: "Markdown" });

    let filePath: string | undefined;
    try {
        const file = await ctx.api.getFile(fileId);
        const telegramFileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        filePath = await downloadFile(telegramFileUrl, fileName);

        // Create batch
        const batch = await prisma.orderBatch.create({
            data: {
                serviceStationId: station.id,
                weekStartDate: new Date(),
                status: "PROCESSING",
                rawFiles: JSON.stringify([fileName]),
            },
        });

        if (isArchiveFile(fileName)) {
            // Extract archive and process each file
            const extractDir = `./temp/extracted_${Date.now()}`;
            const extracted = await extractArchive(filePath, extractDir);

            await ctx.api.editMessageText(chat.id, processingMsg.message_id,
                `📦 Архив распакован. Найдено файлов: *${extracted.length}*\nОбрабатываю...`,
                { parse_mode: "Markdown" }
            );

            let processed = 0;
            for (const extractedFile of extracted) {
                const baseName = path.basename(extractedFile);
                if (isImageFile(baseName) || isPdfFile(baseName)) {
                    await processSingleFile(ctx, extractedFile, baseName, batch.id, station.id);
                    processed++;
                }
                cleanupFile(extractedFile);
            }

            fs.rmSync(extractDir, { recursive: true, force: true });
            await ctx.reply(`✅ Из архива обработано файлов: *${processed}*\n\nЕсли всё верно, напишите *ПРИНЯТО*`, { parse_mode: "Markdown" });
        } else if (isImageFile(fileName) || isPdfFile(fileName)) {
            await processSingleFile(ctx, filePath, fileName, batch.id, station.id);
            await ctx.reply(`\nЕсли всё верно, напишите *ПРИНЯТО*. Иначе пришлите исправленный файл.`, { parse_mode: "Markdown" });
        } else {
            await ctx.api.editMessageText(chat.id, processingMsg.message_id,
                "⚠️ Формат не поддерживается. Поддерживаются: JPG, PNG, PDF, ZIP, RAR.");
        }

        // Delete processing message
        try { await ctx.api.deleteMessage(chat.id, processingMsg.message_id); } catch { }

    } catch (err: any) {
        console.error("Processing error:", err);
        await ctx.api.editMessageText(chat.id, processingMsg.message_id,
            `❌ Ошибка обработки: ${err.message}`);
    } finally {
        if (filePath) cleanupFile(filePath);
    }
});

// === ПРИНЯТО command ===
bot.hears(/^ПРИНЯТО$/i, async (ctx) => {
    const chat = await ctx.getChat();
    const station = await prisma.serviceStation.findUnique({
        where: { chatId: BigInt(chat.id) },
        include: {
            Batches: {
                where: { status: { in: ["PROCESSING", "NEEDS_REVIEW"] } },
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { Items: true },
            },
        },
    });

    if (!station || station.Batches.length === 0) {
        await ctx.reply("✅ Нет активных пакетов для подтверждения.");
        return;
    }

    const batch = station.Batches[0]!;
    await prisma.orderBatch.update({ where: { id: batch.id }, data: { status: "APPROVED" } });

    const total = batch.Items.reduce((s, i) => s + i.total, 0);
    await ctx.reply(
        `✅ *Пакет подтверждён!*\n\n` +
        `📦 Позиций: ${batch.Items.length}\n` +
        `💰 Сумма: ${total.toLocaleString("ru-RU")} руб.\n\n` +
        `Для выгрузки Excel файла для 1С — напишите /export`,
        { parse_mode: "Markdown" }
    );
});


// ===== GOOGLE DRIVE LINK HANDLER =====
// Usage: send a message like:
//   https://drive.google.com/drive/folders/XXX          → process all files
//   https://drive.google.com/drive/folders/XXX обработай 5  → process first 5
//   https://drive.google.com/file/d/XXX                → process single file

bot.on("message:text", async (ctx) => {
    const text = ctx.message.text || "";

    // Check if message contains a Google Drive URL
    const driveUrlMatch = text.match(/https:\/\/drive\.google\.com\/[^\s]+/);
    if (!driveUrlMatch) return;

    const driveUrl = driveUrlMatch[0]!;
    const parsed = parseDriveUrl(driveUrl);
    if (!parsed) {
        await ctx.reply("❌ Не удалось распознать ссылку на Google Drive.");
        return;
    }

    // Parse optional limit: "обработай 5" or just number "5"
    const limitMatch = text.match(/(\d+)/);
    const limit = limitMatch ? parseInt(limitMatch[1]!) : null;

    const chat = await ctx.getChat();
    const chatName = chat.title || (chat as any).first_name || "Автосервис";
    const station = await getOrCreateStation(BigInt(chat.id), chatName);

    const statusMsg = await ctx.reply(
        `🔗 Обрабатываю ссылку Google Drive...\n` +
        (limit ? `📊 Лимит: ${limit} файлов` : `📊 Обработаю все файлы`),
    );

    try {
        let filesToProcess: DriveItem[] = [];

        if (parsed.type === "folder") {
            await ctx.api.editMessageText(chat.id, statusMsg.message_id,
                "🔍 Получаю список файлов из папки...");

            const allFiles = await listDriveFolder(parsed.id);
            const supportedFiles = allFiles.filter(f =>
                f.mimeType.includes("pdf") ||
                f.mimeType.includes("image") ||
                f.mimeType.includes("jpeg") ||
                f.mimeType.includes("png")
            );

            if (supportedFiles.length === 0) {
                await ctx.api.editMessageText(chat.id, statusMsg.message_id,
                    "❌ В папке не найдено поддерживаемых файлов (PDF, JPG, PNG).");
                return;
            }

            filesToProcess = limit ? supportedFiles.slice(0, limit) : supportedFiles;

            await ctx.api.editMessageText(chat.id, statusMsg.message_id,
                `📁 Найдено файлов: ${supportedFiles.length}\n⏳ Обрабатываю: ${filesToProcess.length}...`);
        } else {
            // Single file
            filesToProcess = [{ id: parsed.id, name: `file_${parsed.id}.pdf`, mimeType: "application/pdf" }];
        }

        // Create a batch for this session
        const batch = await prisma.orderBatch.create({
            data: {
                serviceStationId: station.id,
                weekStartDate: new Date(),
                status: "PROCESSING",
                rawFiles: JSON.stringify(filesToProcess.map(f => f.name)),
            },
        });

        let processed = 0;
        let failed = 0;

        for (const driveFile of filesToProcess) {
            let localPath: string | undefined;
            try {
                await ctx.api.editMessageText(chat.id, statusMsg.message_id,
                    `⏳ Обрабатываю ${processed + 1}/${filesToProcess.length}: _${driveFile.name}_`,
                    { parse_mode: "Markdown" }
                );

                localPath = await downloadDriveFile(driveFile.id, driveFile.name);
                await processSingleFile(ctx, localPath, driveFile.name, batch.id, station.id);
                processed++;
            } catch (e: any) {
                console.error(`Failed to process ${driveFile.name}:`, e.message);
                failed++;
            } finally {
                if (localPath) cleanupFile(localPath);
            }
        }

        await ctx.api.editMessageText(chat.id, statusMsg.message_id,
            `✅ *Готово!*\n✔ Обработано: ${processed}\n❌ Ошибок: ${failed}\n\n` +
            `Если всё верно — напишите *ПРИНЯТО*`,
            { parse_mode: "Markdown" }
        );

    } catch (err: any) {
        console.error("Drive link error:", err);
        await ctx.api.editMessageText(chat.id, statusMsg.message_id,
            `❌ Ошибка: ${err.message}`);
    }
});

bot.catch((err) => {
    console.error("Bot error:", err.message);
});

// Register admin bot commands
registerAdminCommands(bot);

// Start web admin panel
const PORT = parseInt(process.env.PORT || "3000");
startWebServer(PORT).catch(console.error);

console.log("🚀 STO Automation Bot запущен...");
bot.start();

import { Bot, Context } from "grammy";
import "dotenv/config";
import prisma from "./db.js";
import { downloadFile, isImageFile, isPdfFile, cleanupFile } from "./fileHandler.js";
import { extractOrderFromImage } from "./ai.js";

const bot = new Bot(process.env.BOT_TOKEN!);

// ===== HELPERS =====

async function getOrCreateStation(chatId: bigint, chatName: string) {
    return prisma.serviceStation.upsert({
        where: { chatId },
        update: { name: chatName },
        create: { chatId, name: chatName },
    });
}

function formatSummary(orders: any[]): string {
    if (orders.length === 0) return "❌ Заказ-нарядов не обнаружено.";

    let msg = `📋 *Резюме обработки*\n\n`;
    orders.forEach((o, i) => {
        msg += `*Заказ-наряд ${i + 1}*\n`;
        msg += `🚗 Госномер: ${o.plateNumber || "❓ Не указан"}\n`;
        msg += `📍 Город: ${o.city || "❓ Не указан"}\n`;
        msg += `🛣 Пробег: ${o.mileage || "❓ Не указан"} км\n`;
        msg += `📦 Позиций: ${o.items?.length || 0}\n`;

        if (o.needsOperatorReview) {
            msg += `⚠️ *Требует проверки оператором*: ${o.reviewReason}\n`;
        }

        const total = o.items?.reduce((sum: number, i: any) => sum + (i.total || 0), 0) || 0;
        msg += `💰 Итого: ${total.toLocaleString("ru-RU")} руб.\n\n`;
    });

    return msg;
}

// ===== COMMANDS =====

bot.command("start", async (ctx) => {
    const chat = await ctx.getChat();
    const station = await getOrCreateStation(
        BigInt(chat.id),
        chat.title || chat.first_name || "Автосервис"
    );
    await ctx.reply(
        `✅ *STO Automation Bot* запущен!\n\n` +
        `📌 Автосервис: *${station.name}*\n` +
        `🆔 Chat ID: \`${chat.id}\`\n\n` +
        `Отправьте файл заказ-наряда (PDF, фото, Excel, RAR) для обработки.`,
        { parse_mode: "Markdown" }
    );
});

bot.command("help", async (ctx) => {
    await ctx.reply(
        `*Команды бота:*\n\n` +
        `/start — Регистрация автосервиса\n` +
        `/help — Справка\n` +
        `/status — Статус последнего пакета\n\n` +
        `*Отправьте файл* (PDF, JPG, PNG, Excel, RAR) для распознавания заказ-наряда.`,
        { parse_mode: "Markdown" }
    );
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

    const processingMsg = await ctx.reply("⏳ Обрабатываю заказ-наряд...");

    let filePath: string | undefined;
    try {
        const file = await ctx.api.getFile(fileId);
        const telegramFileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        filePath = await downloadFile(telegramFileUrl, fileName);

        let parsed;
        if (isImageFile(fileName) || isPdfFile(fileName)) {
            parsed = await extractOrderFromImage(filePath);
        } else {
            await ctx.reply("⚠️ Формат файла пока не поддерживается полностью. Поддерживаются: JPG, PNG, PDF.");
            return;
        }

        // Save to DB
        const batch = await prisma.orderBatch.create({
            data: {
                serviceStationId: station.id,
                weekStartDate: new Date(),
                status: parsed.needsOperatorReview ? "NEEDS_REVIEW" : "PROCESSING",
                rawFiles: JSON.stringify([fileName]),
            },
        });

        for (const item of parsed.items) {
            await prisma.orderItem.create({
                data: {
                    batchId: batch.id,
                    workName: item.workName,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.total,
                    vin: parsed.vin,
                    mileage: parsed.mileage,
                    validationError: parsed.needsOperatorReview ? parsed.reviewReason : null,
                },
            });
        }

        const summary = formatSummary([parsed]);
        await ctx.api.editMessageText(chat.id, processingMsg.message_id, summary, {
            parse_mode: "Markdown",
        });

        if (parsed.needsOperatorReview) {
            await ctx.reply(
                `⚠️ *Данный заказ-наряд требует ручной проверки.*\n\nПричина: ${parsed.reviewReason}`,
                { parse_mode: "Markdown" }
            );
        }
    } catch (err: any) {
        console.error("Processing error:", err);
        await ctx.api.editMessageText(
            chat.id,
            processingMsg.message_id,
            `❌ Ошибка обработки: ${err.message}`
        );
    } finally {
        if (filePath) cleanupFile(filePath);
    }
});

// Handle operator confirmation
bot.hears(/^ПРИНЯТО$/i, async (ctx) => {
    const chat = await ctx.getChat();
    const station = await prisma.serviceStation.findUnique({
        where: { chatId: BigInt(chat.id) },
        include: {
            Batches: {
                where: { status: { not: "APPROVED" } },
                orderBy: { createdAt: "desc" },
                take: 1,
            },
        },
    });

    if (!station || station.Batches.length === 0) {
        await ctx.reply("✅ Нет активных пакетов для подтверждения.");
        return;
    }

    const batch = station.Batches[0]!;
    await prisma.orderBatch.update({
        where: { id: batch.id },
        data: { status: "APPROVED" },
    });

    await ctx.reply(
        `✅ *Пакет подтверждён!*\n` +
        `Заказ-наряды готовы к загрузке в 1С.`,
        { parse_mode: "Markdown" }
    );
});

bot.catch((err) => {
    console.error("Bot error:", err);
});

console.log("🚀 STO Automation Bot запущен...");
bot.start();

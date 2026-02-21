import type { Bot } from "grammy";
import prisma from "./db.js";
import { generateExcelReport, type ExportItem } from "./exporter.js";
import { InputFile } from "grammy";
import { cleanupFile } from "./fileHandler.js";

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => parseInt(id.trim())).filter(Boolean);

function isAdmin(userId: number): boolean {
    if (ADMIN_IDS.length === 0) return true; // Allow all if not configured
    return ADMIN_IDS.includes(userId);
}

function getWeekLabel(date: Date): string {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function registerAdminCommands(bot: Bot) {

    // Guard middleware
    async function checkAdmin(ctx: any, next: any) {
        if (!isAdmin(ctx.from?.id)) {
            await ctx.reply("⛔ Нет доступа. Только для администраторов.");
            return;
        }
        await next();
    }

    // /admin — main menu
    bot.command("admin", checkAdmin, async (ctx) => {
        const webUrl = process.env.WEB_URL ||
            (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
        await ctx.reply(
            `👤 *Панель администратора*\n\n` +
            `📊 /stats — общая статистика\n` +
            `🏭 /stations — список автосервисов\n` +
            `📋 /batches — все пакеты\n` +
            `📋 /batches\\_review — требуют проверки\n` +
            `✅ /approve\\_<ID> — подтвердить пакет\n` +
            `❌ /reject\\_<ID> — отклонить пакет\n` +
            `📤 /exportall — выгрузить всё в Excel\n\n` +
            (webUrl ? `🌐 Веб-панель: ${webUrl}/admin` : `🌐 Веб-панель: _не настроена_`),
            { parse_mode: "Markdown" }
        );
    });

    // /stats — statistics
    bot.command("stats", checkAdmin, async (ctx) => {
        const [stationCount, batchTotal, batchPending, batchApproved, itemCount] = await Promise.all([
            prisma.serviceStation.count(),
            prisma.orderBatch.count(),
            prisma.orderBatch.count({ where: { status: "NEEDS_REVIEW" } }),
            prisma.orderBatch.count({ where: { status: "APPROVED" } }),
            prisma.orderItem.count(),
        ]);

        const totalAmount = await prisma.orderItem.aggregate({ _sum: { total: true } });
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        const weeklyBatches = await prisma.orderBatch.count({
            where: { createdAt: { gte: weekStart } }
        });

        await ctx.reply(
            `📊 *Статистика системы*\n\n` +
            `🏭 Автосервисов: *${stationCount}*\n` +
            `📦 Всего пакетов: *${batchTotal}*\n` +
            `⚠️ Ожидают проверки: *${batchPending}*\n` +
            `✅ Подтверждено: *${batchApproved}*\n` +
            `📋 Всего позиций: *${itemCount}*\n` +
            `💰 Общая сумма: *${(totalAmount._sum.total || 0).toLocaleString("ru-RU")} руб.*\n` +
            `📅 Пакетов за неделю: *${weeklyBatches}*`,
            { parse_mode: "Markdown" }
        );
    });

    // /stations — list all service stations
    bot.command("stations", checkAdmin, async (ctx) => {
        const stations = await prisma.serviceStation.findMany({
            include: { _count: { select: { Batches: true } } },
            orderBy: { createdAt: "desc" }
        });

        if (stations.length === 0) {
            await ctx.reply("🏭 Нет зарегистрированных автосервисов.");
            return;
        }

        let msg = `🏭 *Автосервисы (${stations.length}):*\n\n`;
        for (const s of stations) {
            msg += `• *${s.name || "Без имени"}*\n`;
            msg += `  ID: \`${s.id}\` | ChatID: \`${s.chatId}\` | Пакетов: ${s._count.Batches}\n`;
        }
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // /batches — list batches
    bot.command("batches", checkAdmin, async (ctx) => {
        const batches = await prisma.orderBatch.findMany({
            include: {
                serviceStation: true,
                _count: { select: { Items: true } }
            },
            orderBy: { createdAt: "desc" },
            take: 15,
        });

        if (batches.length === 0) {
            await ctx.reply("📋 Нет пакетов.");
            return;
        }

        let msg = `📋 *Последние пакеты (${batches.length}):*\n\n`;
        for (const b of batches) {
            const icon = b.status === "APPROVED" ? "✅" : b.status === "NEEDS_REVIEW" ? "⚠️" : "⏳";
            msg += `${icon} *#${b.id}* — ${b.serviceStation?.name || "?"}\n`;
            msg += `  ${getWeekLabel(b.weekStartDate)} | ${b._count.Items} позиций | ${b.status}\n`;
        }
        msg += `\nДля подтверждения: /approve\\_<ID>`;
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // /batches_review — only NEEDS_REVIEW
    bot.command("batches_review", checkAdmin, async (ctx) => {
        const batches = await prisma.orderBatch.findMany({
            where: { status: "NEEDS_REVIEW" },
            include: {
                serviceStation: true,
                Items: { where: { validationError: { not: null } }, take: 3 }
            },
            orderBy: { createdAt: "desc" }
        });

        if (batches.length === 0) {
            await ctx.reply("✅ Нет пакетов, требующих проверки!");
            return;
        }

        let msg = `⚠️ *Требуют проверки (${batches.length}):*\n\n`;
        for (const b of batches) {
            msg += `*#${b.id}* — ${b.serviceStation?.name || "?"} (${getWeekLabel(b.weekStartDate)})\n`;
            if (b.Items.length > 0) {
                for (const item of b.Items) {
                    msg += `  • ${item.workName}: _${item.validationError}_\n`;
                }
            }
            msg += `  ✅ /approve\\_${b.id} | ❌ /reject\\_${b.id}\n\n`;
        }
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // Dynamic /approve_<ID>
    bot.hears(/^\/approve[_\s](\d+)$/i, checkAdmin, async (ctx) => {
        const match = ctx.match;
        const batchId = parseInt(match[1] as string);

        const batch = await prisma.orderBatch.findUnique({
            where: { id: batchId },
            include: { serviceStation: true, _count: { select: { Items: true } } }
        });

        if (!batch) {
            await ctx.reply(`❌ Пакет #${batchId} не найден.`);
            return;
        }

        await prisma.orderBatch.update({ where: { id: batchId }, data: { status: "APPROVED" } });
        await ctx.reply(
            `✅ *Пакет #${batchId} подтверждён!*\n` +
            `🏭 Сервис: ${batch.serviceStation?.name}\n` +
            `📦 Позиций: ${batch._count.Items}`,
            { parse_mode: "Markdown" }
        );
    });

    // Dynamic /reject_<ID>
    bot.hears(/^\/reject[_\s](\d+)(?:[_\s](.+))?$/i, checkAdmin, async (ctx) => {
        const match = ctx.match;
        const batchId = parseInt(match[1] as string);
        const reason = (match[2] as string) || "Отклонено администратором";

        await prisma.orderBatch.update({
            where: { id: batchId },
            data: { status: "NEEDS_REVIEW", rawFiles: JSON.stringify({ rejectedReason: reason }) }
        });

        await ctx.reply(
            `❌ *Пакет #${batchId} отклонён*\nПричина: ${reason}`,
            { parse_mode: "Markdown" }
        );
    });

    // /exportall — export all approved batches
    bot.command("exportall", checkAdmin, async (ctx) => {
        const batches = await prisma.orderBatch.findMany({
            where: { status: "APPROVED" },
            include: { serviceStation: true, Items: true },
            orderBy: { weekStartDate: "desc" }
        });

        if (batches.length === 0) {
            await ctx.reply("❌ Нет подтверждённых пакетов для выгрузки.");
            return;
        }

        const exportItems: ExportItem[] = [];
        for (const b of batches) {
            for (const item of b.Items) {
                exportItems.push({
                    serviceStation: b.serviceStation?.name || "Неизвестно",
                    weekDate: getWeekLabel(b.weekStartDate),
                    plateNumber: item.vin || "—",
                    vin: item.vin || undefined,
                    mileage: item.mileage || undefined,
                    workName: item.workName,
                    quantity: item.quantity,
                    price: item.price,
                    total: item.total,
                });
            }
        }

        const reportPath = `./temp/admin_export_${Date.now()}.xlsx`;
        await generateExcelReport(exportItems, reportPath);

        await ctx.replyWithDocument(
            new InputFile(reportPath, `1C_Все_Заказ-наряды_${getWeekLabel(new Date())}.xlsx`),
            { caption: `📊 Полная выгрузка: ${exportItems.length} позиций из ${batches.length} пакетов` }
        );

        cleanupFile(reportPath);
    });
}

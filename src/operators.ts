import type { Bot } from "grammy";
import { InputFile, InlineKeyboard } from "grammy";
import cron from "node-cron";
import * as path from "path";
import * as fs from "fs";
import ExcelJS from "exceljs";
import prisma from "./db.js";
import { cleanupFile } from "./fileHandler.js";

const SUPER_ADMIN_IDS = (process.env.ADMIN_IDS || "")
    .split(",").map(id => BigInt(id.trim())).filter(id => id !== 0n);

export function isSuperAdmin(userId: number | bigint): boolean {
    if (SUPER_ADMIN_IDS.length === 0) return true;
    return SUPER_ADMIN_IDS.includes(BigInt(userId));
}

/** Find operator by telegramId (returns null if not registered) */
export async function findOperator(telegramId: bigint) {
    return prisma.operator.findUnique({ where: { telegramId } });
}

/** Notify all super-admins when operator uploads a ZN */
export async function notifySuperAdminsZnUploaded(
    bot: Bot,
    operatorNickname: string,
    operatorUsername: string | null,
    fileName: string,
    batchId: number,
) {
    const usernameStr = operatorUsername ? ` (@${operatorUsername})` : "";
    const msg =
        `📤 *Новый Заказ-Наряд загружен*\n\n` +
        `👤 Оператор: *${operatorNickname}*${usernameStr}\n` +
        `📄 Файл: \`${fileName}\`\n` +
        `🔖 Пакет: #${batchId}`;
    for (const adminId of SUPER_ADMIN_IDS) {
        try { await bot.api.sendMessage(String(adminId), msg, { parse_mode: "Markdown" }); } catch { }
    }
}

// ─── Conversational state machine for adding operators ────────────────────────

type AddOpState =
    | { step: "waiting_id" }
    | { step: "waiting_nickname"; telegramId: bigint; telegramUsername: string | null };

const addOpPending = new Map<number, AddOpState>(); // key = admin chatId

// Returns a fresh InlineKeyboard each call (grammY requires mutable type)
function cancelKb() { return { reply_markup: new InlineKeyboard().text("❌ Отменить", "cancel_addop") }; }

// ─── Excel report helpers ─────────────────────────────────────────────────────

const HEADER_COLOR = "FF1F4E79";
const ROW_COLORS = ["FFF2F7FC", "FFFFFFFF"];

function applyHeaderStyle(row: ExcelJS.Row) {
    row.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    row.height = 28;
}

type BatchRow = {
    createdAt: Date;
    serviceStation: { name: string | null } | null;
    Items: Array<{ vin: string | null; mileage: number | null; workName: string; quantity: number; price: number; total: number }>;
};

function addBatchRowsToSheet(sheet: ExcelJS.Worksheet, batches: BatchRow[]) {
    sheet.columns = [
        { header: "Дата загрузки", key: "date", width: 16 },
        { header: "Автосервис", key: "station", width: 22 },
        { header: "Госномер", key: "plate", width: 14 },
        { header: "VIN", key: "vin", width: 20 },
        { header: "Пробег (км)", key: "mileage", width: 13 },
        { header: "Работа / Запчасть", key: "work", width: 38 },
        { header: "Кол-во", key: "qty", width: 10 },
        { header: "Цена (руб.)", key: "price", width: 14 },
        { header: "Сумма (руб.)", key: "total", width: 14 },
    ];
    applyHeaderStyle(sheet.getRow(1));
    let idx = 0;
    for (const b of batches) {
        for (const item of b.Items) {
            const r = sheet.addRow({
                date: b.createdAt.toLocaleDateString("ru-RU"), station: b.serviceStation?.name || "—",
                plate: item.vin || "—", vin: item.vin || "", mileage: item.mileage || "",
                work: item.workName, qty: item.quantity, price: item.price, total: item.total,
            });
            r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_COLORS[idx % 2] } }; });
            r.getCell("price").numFmt = '#,##0.00 "руб."';
            r.getCell("total").numFmt = '#,##0.00 "руб."';
            idx++;
        }
    }
    const grandTotal = batches.flatMap(b => b.Items).reduce((s, i) => s + i.total, 0);
    const totalRow = sheet.addRow({ work: "ИТОГО", total: grandTotal });
    totalRow.font = { bold: true };
    totalRow.getCell("total").numFmt = '#,##0.00 "руб."';
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };
}

async function generateSingleOperatorReport(operatorId: number, outputPath: string) {
    const op = await prisma.operator.findUnique({
        where: { id: operatorId },
        include: { Batches: { include: { serviceStation: true, Items: true }, orderBy: { createdAt: "desc" } } },
    });
    if (!op) throw new Error(`Оператор #${operatorId} не найден`);
    const wb = new ExcelJS.Workbook(); wb.creator = "STO Bot"; wb.created = new Date();
    addBatchRowsToSheet(wb.addWorksheet(op.nickname.slice(0, 31)), op.Batches);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(outputPath);
    const items = op.Batches.flatMap(b => b.Items);
    return { batchCount: op.Batches.length, itemCount: items.length, totalSum: items.reduce((s, i) => s + i.total, 0) };
}

async function generateAllOperatorsReport(outputPath: string) {
    const operators = await prisma.operator.findMany({
        include: { Batches: { include: { serviceStation: true, Items: true }, orderBy: { createdAt: "desc" } } },
        orderBy: { nickname: "asc" },
    });
    const wb = new ExcelJS.Workbook(); wb.creator = "STO Bot"; wb.created = new Date();
    const summary = wb.addWorksheet("📊 Сводка");
    summary.columns = [
        { header: "Оператор", key: "name", width: 24 }, { header: "Username", key: "user", width: 18 },
        { header: "ЗН (пакетов)", key: "batches", width: 14 }, { header: "Позиций", key: "items", width: 12 },
        { header: "Сумма (руб.)", key: "total", width: 18 },
    ];
    applyHeaderStyle(summary.getRow(1));
    let totalBatches = 0, totalItems = 0, grandTotal = 0;
    for (const op of operators) {
        const items = op.Batches.flatMap(b => b.Items);
        const opTotal = items.reduce((s, i) => s + i.total, 0);
        const r = summary.addRow({ name: op.nickname, user: op.telegramUsername ? `@${op.telegramUsername}` : "—", batches: op.Batches.length, items: items.length, total: opTotal });
        r.getCell("total").numFmt = '#,##0.00 "руб."';
        totalBatches += op.Batches.length; totalItems += items.length; grandTotal += opTotal;
        if (op.Batches.length > 0) addBatchRowsToSheet(wb.addWorksheet(op.nickname.slice(0, 31)), op.Batches);
    }
    const totalsRow = summary.addRow({ name: "ИТОГО", batches: totalBatches, items: totalItems, total: grandTotal });
    totalsRow.font = { bold: true }; totalsRow.getCell("total").numFmt = '#,##0.00 "руб."';
    summary.views = [{ state: "frozen", ySplit: 1 }];
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(outputPath);
    return { operatorCount: operators.length, batchCount: totalBatches, itemCount: totalItems, totalSum: grandTotal };
}

// ─── Weekly stats ─────────────────────────────────────────────────────────────

async function buildWeeklyStats(): Promise<string> {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const operators = await prisma.operator.findMany({
        include: { Batches: { where: { createdAt: { gte: weekAgo } }, select: { id: true } } },
        orderBy: { nickname: "asc" },
    });
    const totalBatches = await prisma.orderBatch.count({ where: { createdAt: { gte: weekAgo } } });
    let msg = `📊 *Статистика ЗН за неделю*\n_(${weekAgo.toLocaleDateString("ru-RU")} — ${new Date().toLocaleDateString("ru-RU")})_\n\n`;
    if (operators.length === 0) { msg += "_Операторов не зарегистрировано_\n"; }
    else {
        for (const op of operators) {
            const count = op.Batches.length;
            msg += `👤 *${op.nickname}*${op.telegramUsername ? ` (@${op.telegramUsername})` : ""}\n`;
            msg += `   ${"▓".repeat(Math.min(count, 10))}${"░".repeat(Math.max(0, 10 - count))} *${count}* ЗН\n`;
        }
    }
    msg += `\n📦 Итого ЗН за неделю: *${totalBatches}*`;
    return msg;
}

// ─── Register all commands ─────────────────────────────────────────────────────

export function registerOperatorCommands(bot: Bot) {

    async function checkSuperAdmin(ctx: any, next: any) {
        if (!isSuperAdmin(ctx.from?.id)) { await ctx.reply("⛔ Только для супер-администраторов."); return; }
        await next();
    }

    // Helper: start the add operator conversation
    async function startAddOpFlow(ctx: any) {
        addOpPending.set(ctx.chat.id as number, { step: "waiting_id" });
        await ctx.reply(
            `👤 *Добавление оператора*\n\n` +
            `Отправьте Telegram ID или @username оператора:\n\n` +
            `• Числовой ID: \`123456789\`\n` +
            `• Username: \`@ivan_mech\`\n\n` +
            `📌 Узнать ID: напишите боту @userinfobot`,
            { parse_mode: "Markdown", link_preview_options: { is_disabled: true }, ...cancelKb() }
        );
    }

    // Helper: upsert operator and send confirmation
    async function doRegisterOperator(ctx: any, telegramId: bigint, telegramUsername: string | null, nickname: string, addedById: number) {
        const op = await prisma.operator.upsert({
            where: { telegramId },
            update: { nickname, telegramUsername, addedBy: BigInt(addedById) },
            create: { telegramId, telegramUsername, nickname, addedBy: BigInt(addedById) },
        });
        try {
            await bot.api.setMyCommands(
                [{ command: "export", description: "📤 Выгрузить мои ЗН в Excel" }],
                { scope: { type: "chat", chat_id: Number(telegramId) } }
            );
        } catch { }
        await ctx.reply(
            `✅ *Оператор зарегистрирован!*\n\n` +
            `👤 Псевдоним: *${op.nickname}*\n` +
            `🆔 Telegram ID: \`${op.telegramId}\`\n` +
            `📛 Username: ${op.telegramUsername ? "@" + op.telegramUsername : "—"}`,
            { parse_mode: "Markdown" }
        );
    }

    // /addoperator → start conversational flow
    bot.command("addoperator", checkSuperAdmin, async (ctx) => { await startAddOpFlow(ctx); });

    // /addoperatorid [id nickname] → direct or conversational
    bot.command("addoperatorid", checkSuperAdmin, async (ctx) => {
        const args = (ctx.message?.text || "").replace("/addoperatorid", "").trim();
        const parts = args.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            // Direct: /addoperatorid 123456 Nickname
            let telegramId: bigint;
            try { telegramId = BigInt(parts[0]); } catch {
                await ctx.reply("❌ Telegram ID должен быть числом."); return;
            }
            await doRegisterOperator(ctx, telegramId, null, parts.slice(1).join(" "), ctx.from!.id);
        } else {
            await startAddOpFlow(ctx);
        }
    });

    // ── Intercept text messages to handle conversation steps ─────────────────
    bot.on("message:text", async (ctx, next) => {
        const chatId = ctx.chat.id as number;
        const state = addOpPending.get(chatId);

        // Only process if we're waiting for this admin AND they're a super admin
        if (!state || !isSuperAdmin(ctx.from?.id)) return next();

        const text = ctx.message.text.trim();

        // Typed cancel
        if (["отмена", "отменить", "cancel"].includes(text.toLowerCase())) {
            addOpPending.delete(chatId);
            await ctx.reply("❌ Отменено.");
            return;
        }

        if (state.step === "waiting_id") {
            let telegramId: bigint | null = null;
            let telegramUsername: string | null = null;

            if (/^\d+$/.test(text)) {
                telegramId = BigInt(text);
            } else if (text.startsWith("@")) {
                telegramUsername = text.slice(1);
                const existing = await prisma.operator.findFirst({
                    where: { telegramUsername: { equals: telegramUsername, mode: "insensitive" } }
                });
                if (existing) {
                    telegramId = existing.telegramId;
                } else {
                    await ctx.reply(
                        `⚠️ Пользователь ${text} ещё не писал боту.\n` +
                        `Попросите его отправить любое сообщение боту, затем повторите.\n\n` +
                        `Или узнайте числовой ID через @userinfobot`,
                        { parse_mode: "Markdown", link_preview_options: { is_disabled: true }, ...cancelKb() }
                    );
                    return;
                }
            } else {
                await ctx.reply(
                    "❌ Неверный формат.\n\nОтправьте числовой ID (`123456789`) или username (`@ivan_mech`)",
                    { parse_mode: "Markdown", ...cancelKb() }
                );
                return;
            }

            addOpPending.set(chatId, { step: "waiting_nickname", telegramId: telegramId!, telegramUsername });
            await ctx.reply(
                `✅ ID принят: \`${telegramId}\`\n\n` +
                `👤 Теперь введите псевдоним оператора:\n_(например: Иван Механик)_`,
                { parse_mode: "Markdown", ...cancelKb() }
            );

        } else if (state.step === "waiting_nickname") {
            if (text.length < 2) {
                await ctx.reply("❌ Псевдоним слишком короткий. Введите имя:", cancelKb());
                return;
            }
            addOpPending.delete(chatId);
            await doRegisterOperator(ctx, state.telegramId, state.telegramUsername, text, ctx.from!.id);
        }
    });

    // Cancel inline button
    bot.callbackQuery("cancel_addop", async (ctx) => {
        const chatId = ctx.chat?.id;
        if (chatId) addOpPending.delete(chatId as number);
        await ctx.editMessageText("❌ Отменено.");
        await ctx.answerCallbackQuery();
    });

    // /operators — list all
    bot.command("operators", checkSuperAdmin, async (ctx) => {
        const ops = await prisma.operator.findMany({
            include: { _count: { select: { Batches: true } } }, orderBy: { createdAt: "asc" },
        });
        if (ops.length === 0) { await ctx.reply("👥 Операторов нет.\n\nДобавьте: /addoperatorid или /addoperator"); return; }
        let msg = `👥 *Операторы (${ops.length}):*\n\n`;
        for (const op of ops) {
            msg += `• №${op.id} *${op.nickname}*`;
            if (op.telegramUsername) msg += ` (@${op.telegramUsername})`;
            msg += `\n  ЗН: *${op._count.Batches}* | ID: \`${op.telegramId}\`\n`;
        }
        msg += `\nОтчёт: /opreport <№> или /opreport all\nУдалить: /removeoperator <№>`;
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // /removeoperator <id>
    bot.command("removeoperator", checkSuperAdmin, async (ctx) => {
        const arg = (ctx.message?.text || "").replace("/removeoperator", "").trim();
        if (!arg) {
            const ops = await prisma.operator.findMany({ select: { id: true, nickname: true }, orderBy: { createdAt: "asc" } });
            let msg = `❌ *Удаление оператора*\n\nУкажите № оператора:\n\`/removeoperator №\`\n\n`;
            msg += ops.length > 0 ? `*Текущие операторы:*\n${ops.map(op => `• №${op.id} — ${op.nickname}`).join("\n")}` : `_Операторов пока нет_`;
            await ctx.reply(msg, { parse_mode: "Markdown" }); return;
        }
        const id = parseInt(arg);
        if (isNaN(id)) { await ctx.reply("❌ Неверный ID."); return; }
        try {
            const op = await prisma.operator.delete({ where: { id } });
            await ctx.reply(`✅ Оператор *${op.nickname}* удалён.`, { parse_mode: "Markdown" });
        } catch { await ctx.reply(`❌ Оператор №${id} не найден.`); }
    });

    // /opstats — weekly stats on demand
    bot.command("opstats", checkSuperAdmin, async (ctx) => {
        await ctx.reply(await buildWeeklyStats(), { parse_mode: "Markdown" });
    });

    // /opreport [<id>|all]
    bot.command("opreport", checkSuperAdmin, async (ctx) => {
        const arg = (ctx.message?.text || "").replace("/opreport", "").trim().toLowerCase();
        if (!arg) {
            const ops = await prisma.operator.findMany({ select: { id: true, nickname: true } });
            let help = `📊 *Отчёты по операторам*\n\n/opreport all — все (Excel со сводкой)\n\n`;
            if (ops.length > 0) { help += `*По одному:*\n`; ops.forEach(op => { help += `• /opreport ${op.id} — ${op.nickname}\n`; }); }
            else help += `_Операторов ещё нет_`;
            await ctx.reply(help, { parse_mode: "Markdown" }); return;
        }
        const processingMsg = await ctx.reply("⏳ Генерирую отчёт...");
        try {
            const tmpDir = "./temp";
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
            const dateStr = new Date().toLocaleDateString("ru-RU").replace(/\./g, "-");
            if (arg === "all") {
                const outPath = `${tmpDir}/report_all_${Date.now()}.xlsx`;
                const result = await generateAllOperatorsReport(outPath);
                await ctx.replyWithDocument(
                    new InputFile(outPath, `Операторы_все_${dateStr}.xlsx`),
                    { caption: `📊 *Все операторы*\n👥 ${result.operatorCount} | 📦 ${result.batchCount} ЗН | 💰 ${result.totalSum.toLocaleString("ru-RU")} руб.`, parse_mode: "Markdown" }
                );
                cleanupFile(outPath);
            } else {
                const opId = parseInt(arg);
                if (isNaN(opId)) { await ctx.reply("❌ Укажите номер или `all`", { parse_mode: "Markdown" }); return; }
                const opInfo = await prisma.operator.findUnique({ where: { id: opId } });
                if (!opInfo) { await ctx.reply(`❌ Оператор №${opId} не найден. Список: /operators`); return; }
                const outPath = `${tmpDir}/report_op${opId}_${Date.now()}.xlsx`;
                const result = await generateSingleOperatorReport(opId, outPath);
                await ctx.replyWithDocument(
                    new InputFile(outPath, `Оператор_${opInfo.nickname}_${dateStr}.xlsx`),
                    { caption: `📊 *${opInfo.nickname}*\n📦 ${result.batchCount} ЗН | 📋 ${result.itemCount} позиций | 💰 ${result.totalSum.toLocaleString("ru-RU")} руб.`, parse_mode: "Markdown" }
                );
                cleanupFile(outPath);
            }
        } catch (err: any) {
            await ctx.reply(`❌ Ошибка: ${err.message}`);
        } finally {
            try { await bot.api.deleteMessage(ctx.chat.id, processingMsg.message_id); } catch { }
        }
    });

    // Cron: Friday 12:00 MSK = 09:00 UTC
    cron.schedule("0 9 * * 5", async () => {
        const msg = await buildWeeklyStats();
        for (const adminId of SUPER_ADMIN_IDS) {
            try { await bot.api.sendMessage(String(adminId), msg, { parse_mode: "Markdown" }); } catch { }
        }
        console.log("📊 Weekly operator stats sent");
    }, { timezone: "UTC" });

    console.log("✅ Operator commands registered. Cron: Friday 12:00 MSK");
}

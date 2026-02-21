import type { Bot } from "grammy";
import cron from "node-cron";
import prisma from "./db.js";

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
        try {
            await bot.api.sendMessage(String(adminId), msg, { parse_mode: "Markdown" });
        } catch { /* admin might not have started the bot */ }
    }
}

/** Weekly stats message (used both for cron and /opstats command) */
async function buildWeeklyStats(): Promise<string> {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const operators = await prisma.operator.findMany({
        include: {
            Batches: {
                where: { createdAt: { gte: weekAgo } },
                select: { id: true },
            },
        },
        orderBy: { nickname: "asc" },
    });

    const totalBatches = await prisma.orderBatch.count({
        where: { createdAt: { gte: weekAgo } },
    });

    let msg = `📊 *Статистика ЗН за неделю*\n`;
    msg += `_(${weekAgo.toLocaleDateString("ru-RU")} — ${new Date().toLocaleDateString("ru-RU")})_\n\n`;

    if (operators.length === 0) {
        msg += "_Операторов не зарегистрировано_\n";
    } else {
        for (const op of operators) {
            const count = op.Batches.length;
            const bar = "▓".repeat(Math.min(count, 10)) + "░".repeat(Math.max(0, 10 - count));
            const usernameStr = op.telegramUsername ? ` (@${op.telegramUsername})` : "";
            msg += `👤 *${op.nickname}*${usernameStr}\n`;
            msg += `   ${bar} *${count}* ЗН\n`;
        }
    }

    msg += `\n📦 Итого ЗН за неделю: *${totalBatches}*`;
    return msg;
}

export function registerOperatorCommands(bot: Bot) {

    // Guard for super admins only
    async function checkSuperAdmin(ctx: any, next: any) {
        if (!isSuperAdmin(ctx.from?.id)) {
            await ctx.reply("⛔ Только для супер-администраторов.");
            return;
        }
        await next();
    }

    // /addoperator @username Псевдоним
    bot.command("addoperator", checkSuperAdmin, async (ctx) => {
        const args = ctx.message?.text?.replace("/addoperator", "").trim() || "";
        // expects: @username Nickname OR telegramId Nickname
        const parts = args.split(/\s+/);

        if (parts.length < 2) {
            await ctx.reply(
                "ℹ️ Использование:\n`/addoperator @username Псевдоним`\n\nПример:\n`/addoperator @ivan_mech Иван Механик`",
                { parse_mode: "Markdown" }
            );
            return;
        }

        const rawTarget = parts[0];          // @username or userId
        const nickname = parts.slice(1).join(" ");

        let telegramId: bigint | null = null;
        let telegramUsername: string | null = null;

        if (rawTarget.startsWith("@")) {
            telegramUsername = rawTarget.slice(1);
            // Check if the bot has seen this user (they must have messaged the bot first)
            const existing = await prisma.operator.findFirst({
                where: { telegramUsername: { equals: telegramUsername, mode: "insensitive" } }
            });
            if (existing) {
                telegramId = existing.telegramId;
            } else {
                // We need the user to send /start to the bot first so we can resolve their ID
                // For now, use a placeholder — the real ID will be filled when they first message
                await ctx.reply(
                    `⚠️ Пользователь @${telegramUsername} ещё не писал боту.\n` +
                    `Попросите *${nickname}* отправить любое сообщение боту, а затем повторите команду.`,
                    { parse_mode: "Markdown" }
                );
                return;
            }
        } else {
            try { telegramId = BigInt(rawTarget); } catch {
                await ctx.reply("❌ Неверный формат. Укажите @username или Telegram ID.");
                return;
            }
        }

        try {
            const op = await prisma.operator.upsert({
                where: { telegramId: telegramId! },
                update: { nickname, telegramUsername, addedBy: BigInt(ctx.from!.id) },
                create: { telegramId: telegramId!, telegramUsername, nickname, addedBy: BigInt(ctx.from!.id) },
            });
            await ctx.reply(
                `✅ *Оператор добавлен!*\n\n` +
                `👤 Псевдоним: *${op.nickname}*\n` +
                `🆔 Telegram ID: \`${op.telegramId}\`\n` +
                `📛 Username: ${op.telegramUsername ? "@" + op.telegramUsername : "—"}`,
                { parse_mode: "Markdown" }
            );
        } catch (err: any) {
            await ctx.reply(`❌ Ошибка: ${err.message}`);
        }
    });

    // /addoperatorid <telegramId> <Nickname> — add by numeric ID (when Forward gives the id)
    bot.command("addoperatorid", checkSuperAdmin, async (ctx) => {
        const args = ctx.message?.text?.replace("/addoperatorid", "").trim() || "";
        const parts = args.split(/\s+/);
        if (parts.length < 2) {
            await ctx.reply(
                "ℹ️ Использование:\n`/addoperatorid 123456789 Псевдоним`",
                { parse_mode: "Markdown" }
            );
            return;
        }
        let telegramId: bigint;
        try { telegramId = BigInt(parts[0]); } catch {
            await ctx.reply("❌ Telegram ID должен быть числом.");
            return;
        }
        const nickname = parts.slice(1).join(" ");
        const op = await prisma.operator.upsert({
            where: { telegramId },
            update: { nickname, addedBy: BigInt(ctx.from!.id) },
            create: { telegramId, nickname, addedBy: BigInt(ctx.from!.id) },
        });
        await ctx.reply(
            `✅ *Оператор зарегистрирован!*\n👤 *${op.nickname}* | ID: \`${op.telegramId}\``,
            { parse_mode: "Markdown" }
        );
    });

    // /operators — list all operators
    bot.command("operators", checkSuperAdmin, async (ctx) => {
        const ops = await prisma.operator.findMany({
            include: { _count: { select: { Batches: true } } },
            orderBy: { createdAt: "asc" },
        });
        if (ops.length === 0) {
            await ctx.reply("👥 Операторов не зарегистрировано.\n\nДобавьте: /addoperatorid 123456789 Имя");
            return;
        }
        let msg = `👥 *Операторы (${ops.length}):*\n\n`;
        for (const op of ops) {
            msg += `• *${op.nickname}*`;
            if (op.telegramUsername) msg += ` (@${op.telegramUsername})`;
            msg += `\n  ID: \`${op.telegramId}\` | ЗН: *${op._count.Batches}*\n`;
        }
        msg += `\nДобавить: /addoperatorid 123456789 Имя\nУдалить: /removeoperator <ID>`;
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // /removeoperator <operatorId>
    bot.command("removeoperator", checkSuperAdmin, async (ctx) => {
        const arg = ctx.message?.text?.replace("/removeoperator", "").trim();
        if (!arg) {
            await ctx.reply("ℹ️ Укажите ID оператора: `/removeoperator 42`", { parse_mode: "Markdown" });
            return;
        }
        const id = parseInt(arg);
        if (isNaN(id)) { await ctx.reply("❌ Неверный ID."); return; }
        try {
            const op = await prisma.operator.delete({ where: { id } });
            await ctx.reply(`✅ Оператор *${op.nickname}* удалён.`, { parse_mode: "Markdown" });
        } catch {
            await ctx.reply(`❌ Оператор с ID ${id} не найден.`);
        }
    });

    // /opstats — on-demand weekly stats
    bot.command("opstats", checkSuperAdmin, async (ctx) => {
        await ctx.reply(await buildWeeklyStats(), { parse_mode: "Markdown" });
    });

    // Schedule: Every Friday at 12:00 Moscow time (09:00 UTC = 12:00 MSK)
    cron.schedule("0 9 * * 5", async () => {
        const msg = await buildWeeklyStats();
        for (const adminId of SUPER_ADMIN_IDS) {
            try {
                await bot.api.sendMessage(String(adminId), msg, { parse_mode: "Markdown" });
            } catch { /* ignore */ }
        }
        console.log("📊 Weekly operator stats sent to super admins");
    }, { timezone: "UTC" });

    console.log("✅ Operator commands registered. Weekly stats: Friday 12:00 MSK");
}

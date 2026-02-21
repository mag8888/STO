import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import prisma from "./db.js";
import { generateExcelReport, type ExportItem } from "./exporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public");
const TEMP_DIR = "./temp";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

function getWeekLabel(date: Date): string {
    const d = new Date(date);
    d.setDate(d.getDate() - d.getDay() + 1);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export async function startWebServer(port = 3000) {
    const app = Fastify({ logger: false });

    await app.register(fastifyCors, { origin: true });
    await app.register(fastifyStatic, {
        root: PUBLIC_DIR,
        prefix: "/",
    });

    // ─── AUTH ─────────────────────────────────────────
    app.post("/api/auth/login", async (req, reply) => {
        const body = req.body as any;
        if (body?.password === ADMIN_PASSWORD) {
            return { ok: true, token: Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64") };
        }
        reply.code(401);
        return { ok: false, error: "Неверный пароль" };
    });

    function checkAuth(req: any, reply: any) {
        const auth = req.headers["authorization"] || "";
        const token = auth.replace("Bearer ", "");
        const expected = Buffer.from(`admin:${ADMIN_PASSWORD}`).toString("base64");
        if (token !== expected) {
            reply.code(401).send({ error: "Unauthorized" });
            return false;
        }
        return true;
    }

    // ─── STATS ────────────────────────────────────────
    app.get("/api/stats", async (req, reply) => {
        if (!checkAuth(req, reply)) return;

        const [stations, totalBatches, pendingBatches, approvedBatches, totalItems] = await Promise.all([
            prisma.serviceStation.count(),
            prisma.orderBatch.count(),
            prisma.orderBatch.count({ where: { status: "NEEDS_REVIEW" } }),
            prisma.orderBatch.count({ where: { status: "APPROVED" } }),
            prisma.orderItem.count(),
        ]);
        const totalAmount = await prisma.orderItem.aggregate({ _sum: { total: true } });

        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        const weeklyBatches = await prisma.orderBatch.count({ where: { createdAt: { gte: weekStart } } });

        return {
            stations, totalBatches, pendingBatches, approvedBatches,
            totalItems, weeklyBatches,
            totalAmount: totalAmount._sum.total || 0,
        };
    });

    // ─── STATIONS ─────────────────────────────────────
    app.get("/api/stations", async (req, reply) => {
        if (!checkAuth(req, reply)) return;
        return prisma.serviceStation.findMany({
            include: { _count: { select: { Batches: true } } },
            orderBy: { createdAt: "desc" }
        });
    });

    // ─── BATCHES ──────────────────────────────────────
    app.get("/api/batches", async (req, reply) => {
        if (!checkAuth(req, reply)) return;
        const query = req.query as any;
        const where: any = {};
        if (query.status) where.status = query.status;
        if (query.stationId) where.serviceStationId = parseInt(query.stationId);

        return prisma.orderBatch.findMany({
            where,
            include: {
                serviceStation: true,
                _count: { select: { Items: true } }
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
    });

    // ─── BATCH DETAIL ─────────────────────────────────
    app.get("/api/batches/:id", async (req, reply) => {
        if (!checkAuth(req, reply)) return;
        const id = parseInt((req.params as any).id);
        const batch = await prisma.orderBatch.findUnique({
            where: { id },
            include: { serviceStation: true, Items: true }
        });
        if (!batch) { reply.code(404); return { error: "Not found" }; }
        return batch;
    });

    // ─── APPROVE ──────────────────────────────────────
    app.put("/api/batches/:id/approve", async (req, reply) => {
        if (!checkAuth(req, reply)) return;
        const id = parseInt((req.params as any).id);
        try {
            const updated = await prisma.orderBatch.update({
                where: { id }, data: { status: "APPROVED" }
            });
            return { ok: true, batch: updated };
        } catch {
            reply.code(404); return { error: "Not found" };
        }
    });

    // ─── REJECT ───────────────────────────────────────
    app.put("/api/batches/:id/reject", async (req, reply) => {
        if (!checkAuth(req, reply)) return;
        const id = parseInt((req.params as any).id);
        const body = req.body as any;
        try {
            const updated = await prisma.orderBatch.update({
                where: { id },
                data: { status: "NEEDS_REVIEW" }
            });
            return { ok: true, batch: updated, reason: body?.reason };
        } catch {
            reply.code(404); return { error: "Not found" };
        }
    });

    // ─── EXPORT BATCH ────────────────────────────────
    app.get("/api/batches/:id/export", async (req, reply) => {
        if (!checkAuth(req, reply)) return;
        const id = parseInt((req.params as any).id);
        const batch = await prisma.orderBatch.findUnique({
            where: { id },
            include: { serviceStation: true, Items: true }
        });
        if (!batch) { reply.code(404); return { error: "Not found" }; }

        const exportItems: ExportItem[] = batch.Items.map(item => ({
            serviceStation: batch.serviceStation?.name || "Неизвестно",
            weekDate: getWeekLabel(batch.weekStartDate),
            plateNumber: item.vin || "—",
            vin: item.vin || undefined,
            mileage: item.mileage || undefined,
            workName: item.workName,
            quantity: item.quantity,
            price: item.price,
            total: item.total,
        }));

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
        const filePath = `${TEMP_DIR}/export_batch_${id}_${Date.now()}.xlsx`;
        await generateExcelReport(exportItems, filePath);

        const fileName = `1C_batch_${id}_${getWeekLabel(batch.weekStartDate).replace(/\./g, "-")}.xlsx`;
        const fileBuffer = fs.readFileSync(filePath);
        fs.unlinkSync(filePath);

        reply
            .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header("Content-Disposition", `attachment; filename="${fileName}"`)
            .send(fileBuffer);
    });

    // ─── EXPORT ALL APPROVED ──────────────────────────
    app.get("/api/export/all", async (req, reply) => {
        if (!checkAuth(req, reply)) return;

        const batches = await prisma.orderBatch.findMany({
            where: { status: "APPROVED" },
            include: { serviceStation: true, Items: true },
            orderBy: { weekStartDate: "desc" }
        });

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

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
        const filePath = `${TEMP_DIR}/export_all_${Date.now()}.xlsx`;
        await generateExcelReport(exportItems, filePath);

        const fileBuffer = fs.readFileSync(filePath);
        fs.unlinkSync(filePath);

        reply
            .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header("Content-Disposition", `attachment; filename="1C_All_Approved.xlsx"`)
            .send(fileBuffer);
    });

    await app.listen({ port, host: "0.0.0.0" });
    const publicUrl = process.env.WEB_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);
    console.log(`🌐 Web admin panel: ${publicUrl}/admin`);
    return app;
}

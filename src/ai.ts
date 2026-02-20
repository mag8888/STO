import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ParsedOrderItem {
    workName: string;
    quantity: number;
    price: number;
    total: number;
}

export interface ParsedOrder {
    plateNumber?: string;
    vin?: string;
    mileage?: number;
    city?: string;
    date?: string;
    items: ParsedOrderItem[];
    rawText: string;
    needsOperatorReview: boolean;
    reviewReason?: string;
}

const ORDER_PROMPT = `You are analyzing a car repair order (заказ-наряд) from a Russian auto service center.
Extract the following information and return ONLY valid JSON (no markdown, no explanation):
{
  "plateNumber": "car license plate number (госномер) or null",
  "vin": "VIN number or null",
  "mileage": number or null,
  "city": "city name or null",
  "date": "date string or null",
  "items": [
    {
      "workName": "name of work or part",
      "quantity": number,
      "price": number (price per unit in rubles),
      "total": number (quantity * price)
    }
  ],
  "needsOperatorReview": boolean (true if data is unclear or incomplete),
  "reviewReason": "reason why operator review is needed or null"
}
If you cannot clearly identify the plate number or VIN, set needsOperatorReview to true.
If items array is empty, set needsOperatorReview to true with reason "No items found".`;

/** Convert first page of a PDF to a PNG file, returns path to PNG */
async function pdfToImage(pdfPath: string): Promise<string> {
    // Dynamic import to avoid loading canvas at startup
    const { createCanvas } = await import("canvas");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.js");

    const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = (pdfjsLib as any).getDocument({ data: pdfData, useSystemFonts: true });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);

    const scale = 2.0; // High-res render
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    await page.render({ canvasContext: context as any, viewport }).promise;

    const pngPath = pdfPath.replace(/\.pdf$/i, "_page1.png");
    fs.writeFileSync(pngPath, canvas.toBuffer("image/png"));
    return pngPath;
}

function parseJsonResponse(content: string, rawText: string): ParsedOrder {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```(?:json)?\n?/g, "").trim();
    try {
        const parsed = JSON.parse(cleaned);
        return { ...parsed, rawText };
    } catch {
        // Try to extract JSON from mixed content
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]!);
                return { ...parsed, rawText };
            } catch { }
        }
        return {
            items: [],
            rawText: content,
            needsOperatorReview: true,
            reviewReason: "Не удалось разобрать ответ AI",
        };
    }
}

/** Main entry point: handles image files AND PDF files */
export async function extractOrderFromImage(filePath: string): Promise<ParsedOrder> {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";

    // For DOCX files — extract text and use text-based prompt
    if (ext === "docx" || ext === "doc") {
        return extractOrderFromDocx(filePath);
    }

    // For PDFs — convert to image first
    if (ext === "pdf") {
        let pngPath: string | undefined;
        try {
            pngPath = await pdfToImage(filePath);
            return await extractOrderFromImageFile(pngPath);
        } catch (pdfErr: any) {
            console.error("PDF→image conversion failed:", pdfErr.message);
            // Fallback: try to extract text from PDF
            return {
                items: [],
                rawText: "",
                needsOperatorReview: true,
                reviewReason: `Ошибка конвертации PDF: ${pdfErr.message}`,
            };
        } finally {
            if (pngPath) {
                try { fs.unlinkSync(pngPath); } catch { }
            }
        }
    }

    // For images (JPG, PNG etc.) — send directly
    return extractOrderFromImageFile(filePath);
}

async function extractOrderFromImageFile(imagePath: string): Promise<ParsedOrder> {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");
    const ext = imagePath.split(".").pop()?.toLowerCase() || "jpeg";
    const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: ORDER_PROMPT },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${mimeType};base64,${base64Image}`,
                            detail: "high",
                        },
                    },
                ],
            },
        ],
        max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    return parseJsonResponse(content, content);
}

async function extractOrderFromDocx(filePath: string): Promise<ParsedOrder> {
    try {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ path: filePath });
        return extractOrderFromText(result.value);
    } catch {
        return {
            items: [],
            rawText: "",
            needsOperatorReview: true,
            reviewReason: "Не удалось прочитать DOCX файл",
        };
    }
}

export async function extractOrderFromText(text: string): Promise<ParsedOrder> {
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: `${ORDER_PROMPT}\n\nТекст для анализа:\n${text.slice(0, 8000)}`,
            },
        ],
        max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    return parseJsonResponse(content, text);
}

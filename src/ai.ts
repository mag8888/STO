import OpenAI from "openai";
import * as fs from "fs";

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

export async function extractOrderFromImage(
    imagePath: string
): Promise<ParsedOrder> {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");
    const ext = imagePath.split(".").pop()?.toLowerCase() || "jpeg";
    const mediaType =
        ext === "png" ? "image/png" : ext === "pdf" ? "application/pdf" : "image/jpeg";

    const prompt = `You are analyzing a car repair order (заказ-наряд) from a Russian auto service center.
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
      "price": number (price per unit),
      "total": number (quantity * price)
    }
  ],
  "needsOperatorReview": boolean (true if data is unclear or incomplete),
  "reviewReason": "reason why operator review is needed or null"
}
If you cannot clearly identify the plate number or VIN, set needsOperatorReview to true.`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${mediaType};base64,${base64Image}`,
                            detail: "high",
                        },
                    },
                ],
            },
        ],
        max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    try {
        const parsed = JSON.parse(content);
        return { ...parsed, rawText: content };
    } catch {
        return {
            items: [],
            rawText: content,
            needsOperatorReview: true,
            reviewReason: "Failed to parse AI response",
        };
    }
}

export async function extractOrderFromPdfText(
    text: string
): Promise<ParsedOrder> {
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: `You are analyzing a car repair order text (заказ-наряд).
Extract data and return ONLY valid JSON:
{
  "plateNumber": string or null,
  "vin": string or null,
  "mileage": number or null,
  "city": string or null,
  "date": string or null,
  "items": [{ "workName": string, "quantity": number, "price": number, "total": number }],
  "needsOperatorReview": boolean,
  "reviewReason": string or null
}

Text to analyze:
${text}`,
            },
        ],
        max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || "{}";
    try {
        const parsed = JSON.parse(content);
        return { ...parsed, rawText: text };
    } catch {
        return {
            items: [],
            rawText: text,
            needsOperatorReview: true,
            reviewReason: "Failed to parse AI response",
        };
    }
}

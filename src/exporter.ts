import ExcelJS from "exceljs";
import * as path from "path";
import * as fs from "fs";

export interface ExportItem {
    serviceStation: string;
    weekDate: string;
    plateNumber: string;
    vin?: string;
    mileage?: number;
    city?: string;
    workName: string;
    quantity: number;
    price: number;
    total: number;
}

export async function generateExcelReport(items: ExportItem[], outputPath: string): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "STO Automation Bot";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Заказ-наряды", {
        pageSetup: { fitToPage: true, fitToWidth: 1 }
    });

    // Header styling
    const headerFill: ExcelJS.Fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F4E79" }
    };
    const headerFont: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

    // Columns matching 1C import format
    sheet.columns = [
        { header: "Автосервис", key: "serviceStation", width: 22 },
        { header: "Неделя", key: "weekDate", width: 14 },
        { header: "Госномер", key: "plateNumber", width: 14 },
        { header: "VIN", key: "vin", width: 20 },
        { header: "Пробег (км)", key: "mileage", width: 14 },
        { header: "Город", key: "city", width: 16 },
        { header: "Наименование работы/запчасти", key: "workName", width: 40 },
        { header: "Кол-во", key: "quantity", width: 10 },
        { header: "Цена (руб.)", key: "price", width: 14 },
        { header: "Сумма (руб.)", key: "total", width: 14 },
    ];

    // Style header row
    sheet.getRow(1).eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
            bottom: { style: "medium", color: { argb: "FFFFFFFF" } }
        };
    });
    sheet.getRow(1).height = 30;

    // Add data rows
    items.forEach((item, idx) => {
        const row = sheet.addRow({
            serviceStation: item.serviceStation,
            weekDate: item.weekDate,
            plateNumber: item.plateNumber,
            vin: item.vin || "",
            mileage: item.mileage || "",
            city: item.city || "",
            workName: item.workName,
            quantity: item.quantity,
            price: item.price,
            total: item.total,
        });

        // Alternate row colors
        const rowFill: ExcelJS.Fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: idx % 2 === 0 ? "FFF2F7FC" : "FFFFFFFF" }
        };
        row.eachCell((cell) => {
            cell.fill = rowFill;
            cell.border = {
                top: { style: "thin", color: { argb: "FFDDDDDD" } },
                bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
            };
        });

        // Number formatting
        row.getCell("price").numFmt = '#,##0.00 "руб."';
        row.getCell("total").numFmt = '#,##0.00 "руб."';
    });

    // Total row
    const totalRow = sheet.addRow({
        workName: "ИТОГО",
        quantity: items.reduce((s, i) => s + i.quantity, 0),
        total: items.reduce((s, i) => s + i.total, 0),
    });
    totalRow.font = { bold: true };
    totalRow.getCell("total").numFmt = '#,##0.00 "руб."';

    // Freeze header
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    // Auto-filter
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 10 }
    };

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
}

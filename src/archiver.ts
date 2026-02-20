import * as fs from "fs";
import * as path from "path";
import * as unzipper from "unzipper";

export async function extractArchive(archivePath: string, outputDir: string): Promise<string[]> {
    const ext = path.extname(archivePath).toLowerCase();
    const extractedFiles: string[] = [];

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (ext === ".zip") {
        await fs.createReadStream(archivePath)
            .pipe(unzipper.Extract({ path: outputDir }))
            .promise();

        // Collect extracted files
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir)) {
                const full = path.join(dir, entry);
                if (fs.statSync(full).isDirectory()) {
                    walk(full);
                } else {
                    extractedFiles.push(full);
                }
            }
        };
        walk(outputDir);
    } else if (ext === ".rar") {
        // For RAR: use system unrar if available, otherwise skip
        try {
            const { execSync } = await import("child_process");
            execSync(`unrar e -y "${archivePath}" "${outputDir}/"`, { stdio: "ignore" });
            for (const entry of fs.readdirSync(outputDir)) {
                extractedFiles.push(path.join(outputDir, entry));
            }
        } catch {
            console.warn("unrar not available on system. RAR files will be skipped.");
        }
    }

    return extractedFiles;
}

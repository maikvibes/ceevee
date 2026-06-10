import fs from "fs";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { createWorker, createScheduler, Scheduler } from "tesseract.js";

export class FileParsingService {
  private static scheduler: Scheduler | null = null;
  private static workerN = 4;

  private static async initScheduler() {
    if (this.scheduler) return;
    this.scheduler = createScheduler();

    const workerGen = async () => {
      const worker = await createWorker("eng+vie", 1, { cachePath: "." });
      this.scheduler!.addWorker(worker);
    };

    const resArr = Array(this.workerN);
    for (let i = 0; i < this.workerN; i++) {
      resArr[i] = workerGen();
    }
    await Promise.all(resArr);
  }

  /**
   * Routes the file to the appropriate parser based on extension or mime type.
   */
  static async parseFile(filePath: string, onProgress?: (status: string) => void): Promise<string> {
    const ext = filePath.split('.').pop()?.toLowerCase();

    try {
      if (ext === 'pdf') {
        return await this.parsePdf(filePath, onProgress)
      } else if (ext === 'docx') {
        return await this.parseDocx(filePath);
      } else {
        throw new Error(`Unsupported file type: ${ext}`);
      }
    } catch (error: unknown) {
      throw new Error(
        `Failed to parse file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private static async parsePdf(filePath: string, onProgress?: (status: string) => void): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();

    const textStr =
      typeof result === "string"
        ? result
        : typeof result === "object" && result !== null && "text" in result
          ? String((result as { text: unknown }).text)
          : "";

    // Fallback to OCR if text is suspiciously short (e.g. less than 100 characters)
    // which usually means it's an image-based/scanned PDF.
    if (textStr.trim().length < 100) {
      console.log(`[FileParsingService] Text length is ${textStr.trim().length}. Falling back to OCR.`)
      const ocrText = await this.runOCR(filePath, parser, onProgress)
      await parser.destroy()
      return ocrText
    }

    await parser.destroy();
    return textStr;
  }

  private static async parseDocx(filePath: string): Promise<string> {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  private static async runOCR(filePath: string, existingParser?: PDFParse, onProgress?: (status: string) => void): Promise<string> {
    console.log(`[FileParsingService] Starting OCR for ${filePath}...`)
    try {
      await this.initScheduler()

      const ext = filePath.split('.').pop()?.toLowerCase();
      let extractedText = '';

      if (ext === 'pdf') {
        console.log('[FileParsingService] Extracting all images from PDF for OCR...');
        let parser = existingParser;
        if (!parser) {
           const buffer = fs.readFileSync(filePath);
           parser = new PDFParse({ data: buffer });
        }
        
        const result = await parser.getImage();
        const images: any[] = [];
        if (result && result.pages) {
          result.pages.forEach((page: any) => {
            if (page.images) {
              images.push(...page.images);
            }
          });
        }

        if (images.length === 0) {
           throw new Error('No embedded images found in the PDF for OCR.');
        }

        if (onProgress) onProgress('OCR:0');
        
        const ocrPromises = images.map(async (img, index) => {
           const ocrInput = Buffer.from(img.data);
           const { data: { text } } = await this.scheduler!.addJob('recognize', ocrInput);
           return { index, text };
        });

        let completed = 0;
        const results = await Promise.all(ocrPromises.map(p => p.then(res => {
           completed++;
           if (onProgress) onProgress(`OCR:${Math.round((completed / images.length) * 100)}`);
           return res;
        })));

        results.sort((a, b) => a.index - b.index);
        extractedText = results.map(r => r.text).join('\n\n');
        
        if (!existingParser) {
           await parser.destroy();
        }
      } else {
        if (onProgress) onProgress('OCR:0');
        const { data: { text } } = await this.scheduler!.addJob('recognize', filePath);
        extractedText = text;
        if (onProgress) onProgress('OCR:100');
      }

      return extractedText;
    } catch (e: unknown) {
      console.error(
        "[FileParsingService] OCR Failed: ",
        e instanceof Error ? e.message : String(e),
      );
      throw new Error(
        "OCR Failed. File might not be a valid image or supported format.",
      );
    }
  }
}

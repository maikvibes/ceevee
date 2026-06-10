import { IFileValidatorStrategy } from './IFileValidatorStrategy'

export class PdfValidatorStrategy implements IFileValidatorStrategy {
  accepts(item: File | string): boolean {
    return item instanceof File && item.type === 'application/pdf'
  }

  async validate(_item: File | string): Promise<{ valid: boolean; metadata?: any; error?: string }> {
    // Stub implementation
    return new Promise(resolve => setTimeout(() => resolve({ valid: true, metadata: { type: 'pdf' } }), 1000))
  }
}

export class DocxValidatorStrategy implements IFileValidatorStrategy {
  accepts(item: File | string): boolean {
    return item instanceof File && (item.name.endsWith('.docx') || item.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  }

  async validate(_item: File | string): Promise<{ valid: boolean; metadata?: any; error?: string }> {
    // Stub implementation
    return new Promise(resolve => setTimeout(() => resolve({ valid: true, metadata: { type: 'docx' } }), 1000))
  }
}

export class UrlValidatorStrategy implements IFileValidatorStrategy {
  accepts(item: File | string): boolean {
    return typeof item === 'string' && (item.startsWith('http://') || item.startsWith('https://'))
  }

  async validate(_item: File | string): Promise<{ valid: boolean; metadata?: any; error?: string }> {
    // Stub implementation
    return new Promise(resolve => setTimeout(() => resolve({ valid: true, metadata: { type: 'url' } }), 1000))
  }
}

export class FileValidatorContext {
  private strategies: IFileValidatorStrategy[] = [
    new PdfValidatorStrategy(),
    new DocxValidatorStrategy(),
    new UrlValidatorStrategy()
  ]

  async executeValidation(item: File | string) {
    const strategy = this.strategies.find(s => s.accepts(item))
    if (!strategy) {
      return { valid: false, error: 'Unsupported file type or URL format.' }
    }
    return strategy.validate(item)
  }
}

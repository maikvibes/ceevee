export interface IFileValidatorStrategy {
  accepts(item: File | string): boolean;
  validate(item: File | string): Promise<{ valid: boolean; metadata?: any; error?: string }>;
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export const pipelineStatus = ["Queued", "Extracting", "Analyzing", "Syncing to Notion", "Uploading CV to Notion", "Attaching CV to Notion Page", "Complete", "Failed", "Warning"] as const;

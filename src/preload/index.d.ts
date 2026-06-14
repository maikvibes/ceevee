import { ElectronAPI } from "@electron-toolkit/preload";
export const pipelineStatus = ["Queued", "Extracting", "Analyzing", "Syncing to Notion", "Uploading CV to Notion", "Attaching CV to Notion Page", "Complete", "Failed"] as const;

type EmbeddingProviderName = "local" | "openai" | "gemini" | "openrouter";

interface CandidateSearchFilter {
  id: string;
  value: string | number | boolean | null;
}

interface VectorSearchSettings {
  vector_search_enabled: boolean;
  vector_db_provider: "chromadb";
  chroma_host: string;
  chroma_port: number;
  chroma_ssl: boolean;
  embedding_provider: EmbeddingProviderName;
  embedding_model: string;
  embedding_dimension: number;
  embedding_index_status: "disabled" | "not_indexed" | "indexing" | "indexed" | "stale" | "error";
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      getUsers: () => Promise<any[]>;
      addUser: (name: string) => Promise<number | bigint>;
      enqueueDocument: (
        filePath: string,
        provider: string,
      ) => Promise<{ success: boolean; error?: string }>;
      getDocumentTasks: () => Promise<any[]>;
      clearDocumentQueue: () => Promise<{ success: boolean; error?: string }>;
      removeDocumentTask: (taskId: number) => Promise<{ success: boolean; error?: string }>;
      selectFiles: () => Promise<{ success: boolean; filePaths?: string[]; error?: string }>;

      // Window Controls
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;

      readLocalPdf: (
        filePath: string,
      ) => Promise<{ success: boolean; base64?: ArrayBuffer; error?: string }>;
      onDocumentProgress: (
        callback: (data: {
          taskId: number;
          status: typeof pipelineStatus[number];
          context?: string;
          errorMessage?: string;
        }) => void,
      ) => () => void;
      getCandidates: (params: {
        search?: string;
        filters?: { id: string; value: any }[];
        sorting?: { id: string; desc: boolean }[];
        offset: number;
        limit: number;
      }) => Promise<any>;
      getCandidate: (id: number) => Promise<any>;
      getCandidateByFilepath: (
        filePath: string,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
      updateCandidate: (
        id: number,
        updates: Record<string, any>,
      ) => Promise<any>;
      deleteCandidate: (id: number) => Promise<any>;
      searchCandidatesForJobDescription: (params: {
        jobDescription: string;
        filters?: CandidateSearchFilter[];
        limit?: number;
      }) => Promise<{
        success: boolean;
        data?: {
          results: Array<{
            candidate: Record<string, unknown>;
            tagScore: number;
            semanticScore: number | null;
            score: number;
            exactReasons: string[];
            semanticReasons: string[];
            matchingTags: string[];
          }>;
          semantic: { available: boolean; reason: string | null };
        };
        error?: string;
      }>;
      getJobSearchHistory: (limit?: number) => Promise<{
        success: boolean;
        data?: Array<{
          id: number;
          job_description: string;
          filters: CandidateSearchFilter[];
          result_count: number;
          semantic_available: boolean;
          created_at: string;
        }>;
        error?: string;
      }>;
      getCustomTags: () => Promise<{
        success: boolean;
        data?: any[];
        error?: string;
      }>;
      addCustomTag: (params: {
        name: string;
        category: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      deleteCustomTag: (
        id: number,
      ) => Promise<{ success: boolean; error?: string }>;
      getPathForFile: (file: File) => string;
      isKeystoreLocked: () => Promise<boolean>;
      hasSavedKeys: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
      unlockKeystore: (password: string) => Promise<any>;
      lockKeystore: () => Promise<any>;
      resetKeystore: () => Promise<any>;
      saveApiKey: (
        provider: string,
        key: string,
        model: string,
      ) => Promise<{ success: boolean; error?: string }>;
      getApiKey: (provider: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      getSavedProviderSettings: (
        provider: string,
      ) => Promise<{ success: boolean; data?: any; error?: string }>;
      getModels: (
        provider: string,
      ) => Promise<{ success: boolean; data?: any[]; error?: string }>;
      fetchModels: (
        provider: string,
      ) => Promise<{ success: boolean; error?: string }>;
      syncCandidateToNotion: (
        id: number,
      ) => Promise<{ success: boolean; url?: string; error?: string }>;
      exportCandidatesCsv: (params: any) => Promise<{
        success: boolean;
        filePath?: string;
        canceled?: boolean;
        error?: string;
      }>;
      getAppSetting: (
        key: string,
      ) => Promise<{ success: boolean; value?: string; error?: string }>;
      setAppSetting: (
        key: string,
        value: string,
      ) => Promise<{ success: boolean; error?: string }>;
      getVectorSearchStatus: () => Promise<{
        success: boolean;
        data?: {
          settings: VectorSearchSettings;
          chromaReachable: boolean;
          indexedChunks: number;
          candidateCount: number;
          message: string;
        };
        error?: string;
      }>;
      testVectorDbConnection: (config: {
        chroma_host?: string;
        chroma_port?: number;
        chroma_ssl?: boolean;
      }) => Promise<{ success: boolean; data?: { version: string }; error?: string }>;
      saveVectorSearchSettings: (
        settings: Partial<VectorSearchSettings>,
      ) => Promise<{ success: boolean; data?: VectorSearchSettings; error?: string }>;
      reindexCandidateVectors: () => Promise<{
        success: boolean;
        data?: { indexedCandidates: number };
        error?: string;
      }>;
      getEmbeddingModels: (
        provider: EmbeddingProviderName,
      ) => Promise<{ success: boolean; data?: Array<{ model_id: string; name: string }>; error?: string }>;
      deleteAllData: () => Promise<{ success: boolean; error?: string }>;
      getDashboardStats: () => Promise<{ success: boolean; data?: any; error?: string }>;
      getAppVersion: () => Promise<string>;
      getAppEnv: () => Promise<string>;

      // Auto-Updater
      updater: {
        installUpdate: () => void;
        onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void;
      };
    };
  }
}

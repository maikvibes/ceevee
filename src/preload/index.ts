import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { pipelineStatus } from '../main/utils/types';

// Custom APIs for renderer
const api = {
  getUsers: () => ipcRenderer.invoke('get-users'),
  addUser: (name: string) => ipcRenderer.invoke('add-user', name),
  enqueueDocument: (filePath: string, provider: string) => ipcRenderer.invoke('enqueue-document', { filePath, provider }),
  getDocumentTasks: () => ipcRenderer.invoke('get-document-tasks'),
  clearDocumentQueue: () => ipcRenderer.invoke('clear-document-queue'),
  removeDocumentTask: (taskId: number) => ipcRenderer.invoke('remove-document-task', taskId),
  selectFiles: () => ipcRenderer.invoke('select-files'),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  readLocalPdf: (filePath: string) => ipcRenderer.invoke('read-local-pdf', filePath),
  onDocumentProgress: (callback: (data: { taskId: number, status: typeof pipelineStatus[number], context?: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('document-progress', listener)
    return () => {
      ipcRenderer.removeListener('document-progress', listener)
    }
  },
  getCandidates: (params: any) => ipcRenderer.invoke('get-candidates', params),
  getCandidate: (id: number) => ipcRenderer.invoke('get-candidate', id),
  getCandidateMergeHistory: (candidateId: number) => ipcRenderer.invoke('get-candidate-merge-history', candidateId),
  getDuplicateCandidates: () => ipcRenderer.invoke('get-duplicate-candidates'),
  mergeCandidates: (targetId: number, sourceId: number) => ipcRenderer.invoke('merge-candidates', targetId, sourceId),
  getCvVersions: (candidateId: number) => ipcRenderer.invoke('get-cv-versions', candidateId),
  readCvVersion: (candidateId: number, versionId: number) => ipcRenderer.invoke('read-cv-version', candidateId, versionId),
  resetProfileToCurrentCv: (candidateId: number) => ipcRenderer.invoke('reset-profile-to-current-cv', candidateId),
  setCurrentCvVersion: (candidateId: number, versionId: number) => ipcRenderer.invoke('set-current-cv-version', candidateId, versionId),
  deleteCvVersion: (candidateId: number, versionId: number) => ipcRenderer.invoke('delete-cv-version', candidateId, versionId),
  getCvStorageUsage: () => ipcRenderer.invoke('get-cv-storage-usage'),
  copyExistingCvs: () => ipcRenderer.invoke('copy-existing-cvs'),
  retryDocumentTask: (taskId: number) => ipcRenderer.invoke('retry-document-task', taskId),
  getCvMatchReview: (taskId: number) => ipcRenderer.invoke('get-cv-match-review', taskId),
  resolveCvMatchReview: (taskId: number, candidateId: number | null) => ipcRenderer.invoke('resolve-cv-match-review', taskId, candidateId),
  getCandidateByFilepath: (filePath: string) => ipcRenderer.invoke('get-candidate-by-filepath', filePath),
  updateCandidate: (id: number, updates: any) => ipcRenderer.invoke('update-candidate', id, updates),
  deleteCandidate: (id: number) => ipcRenderer.invoke('delete-candidate', id),
  searchCandidatesForJobDescription: (params: {
    jobDescription: string
    filters?: { id: string; value: string | number | boolean | null }[]
    limit?: number
    saveToHistory?: boolean
  }) => ipcRenderer.invoke('search-candidates-for-job-description', params),
  getJobSearchHistory: (limit?: number) => ipcRenderer.invoke('get-job-search-history', limit),
  getCustomTags: () => ipcRenderer.invoke('get-custom-tags'),
  addCustomTag: (params: { name: string, category: string }) => ipcRenderer.invoke('add-custom-tag', params),
  deleteCustomTag: (id: number) => ipcRenderer.invoke('delete-custom-tag', id),
  getPathForFile: (file: File) => {
    // webUtils is available in Electron 30+ to securely read File paths
    if (webUtils && webUtils.getPathForFile) {
      return webUtils.getPathForFile(file)
    }
    return (file as any).path
  },
  isKeystoreLocked: () => ipcRenderer.invoke('is-keystore-locked'),
  hasSavedKeys: () => ipcRenderer.invoke('has-saved-keys'),
  unlockKeystore: (password: string) => ipcRenderer.invoke('unlock-keystore', password),
  lockKeystore: () => ipcRenderer.invoke('lock-keystore'),
  resetKeystore: () => ipcRenderer.invoke('reset-keystore'),
  saveApiKey: (provider: string, key: string, model: string, baseUrl?: string) => ipcRenderer.invoke('save-api-key', { provider, key, model, baseUrl }),
  saveProviderConfig: (provider: string, changes: { key?: string; model?: string; baseUrl?: string }) => ipcRenderer.invoke('save-provider-config', { provider, ...changes }),
  getApiKey: (provider: string) => ipcRenderer.invoke('get-api-key', provider),
  getSavedProviderSettings: (provider: string) => ipcRenderer.invoke('get-saved-provider-settings', provider),
  getModels: (provider: string) => ipcRenderer.invoke('get-models', provider),
  fetchModels: (provider: string) => ipcRenderer.invoke('fetch-models', provider),
  syncCandidateToNotion: (id: number) => ipcRenderer.invoke('sync-candidate-to-notion', id),
  exportCandidatesCsv: (params: any) => ipcRenderer.invoke('export-candidates-csv', params),
  getAppSetting: (key: string) => ipcRenderer.invoke('get-app-setting', key),
  setAppSetting: (key: string, value: string) => ipcRenderer.invoke('set-app-setting', { key, value }),
  getVectorSearchStatus: () => ipcRenderer.invoke('get-vector-search-status'),
  saveVectorSearchSettings: (settings: Record<string, string | number | boolean>) => ipcRenderer.invoke('save-vector-search-settings', settings),
  reindexCandidateVectors: () => ipcRenderer.invoke('reindex-candidate-vectors'),
  deleteAllData: () => ipcRenderer.invoke('delete-all-data'),
  deleteDuplicateCandidates: () => ipcRenderer.invoke('delete-duplicate-candidates'),
  getDistinctLocations: () => ipcRenderer.invoke('get-distinct-locations'),
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppEnv: () => ipcRenderer.invoke('get-app-env'),

  // Auto-Updater
  updater: {
    installUpdate: () => ipcRenderer.send('install-update'),
    onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
      const listener = (_event: any, info: any) => callback(info)
      ipcRenderer.on('update-downloaded', listener)
      return () => {
        ipcRenderer.removeListener('update-downloaded', listener)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

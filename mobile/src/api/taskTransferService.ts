import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { apiClient, API_URL } from './apiClient';
import { useAuthStore } from '../store/authStore';

/**
 * Export / import a project's tasks with Excel, the same endpoints as the
 * web's "⇅ Export / Import" (task-transfer component). Import is always
 * preview → confirm: nothing is written until the person has seen the rows.
 */
export interface TaskImportRow {
  row: number; sNo: string; project: string; title: string;
  action: 'CREATE' | 'UPDATE' | 'SKIP'; ok: boolean; errors: string[]; warnings: string[]; taskKey?: string;
}
export interface TaskImportSummary {
  total: number; toCreate: number; toUpdate: number; failed: number; rows: TaskImportRow[]; failedFile?: string | null;
}
export type PickedFile = { uri: string; name: string; type: string };

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Save into the phone's Downloads (Android) and open it in a spreadsheet app. */
async function openFile(path: string, fileName: string) {
  if (Platform.OS === 'android') {
    try {
      await ReactNativeBlobUtil.MediaCollection.copyToMediaStore({ name: fileName, parentFolder: '', mimeType: XLSX }, 'Download', path);
    } catch {
      // Still opens below.
    }
    await ReactNativeBlobUtil.android.actionViewIntent(path, XLSX);
  } else {
    await ReactNativeBlobUtil.ios.openDocument(path);
  }
}

const slug = (s: string) => (s || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

export const taskTransferService = {
  /** kind: 'template' (blank layout) or 'export' (this project's tasks). */
  async download(kind: 'template' | 'export', projectId: number, projectName: string, includeDone = false) {
    const fileName = kind === 'template' ? `task-template-${slug(projectName)}.xlsx` : `tasks-${slug(projectName)}.xlsx`;
    const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;
    const qs = `projectIds=${projectId}${kind === 'export' && includeDone ? '&includeDone=1' : ''}`;
    const res = await ReactNativeBlobUtil.config({ path, overwrite: true }).fetch(
      'GET',
      `${API_URL}/project-tasks/${kind}?${qs}`,
      { Authorization: `Bearer ${useAuthStore.getState().token ?? ''}`, 'X-Client-Platform': 'mobile' },
    );
    if (res.info().status !== 200) {
      await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
      throw new Error('Could not download the file. Please try again.');
    }
    await openFile(path, fileName);
  },

  async preview(projectId: number, file: PickedFile): Promise<TaskImportSummary> {
    const fd = new FormData();
    fd.append('file', file as any);
    const { data } = await apiClient.post(`/project-tasks/import/preview`, fd, {
      params: { projectId }, headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
    });
    return data;
  },

  async commit(projectId: number, file: PickedFile): Promise<TaskImportSummary> {
    const fd = new FormData();
    fd.append('file', file as any);
    const { data } = await apiClient.post(`/project-tasks/import`, fd, {
      params: { projectId }, headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000,
    });
    return data;
  },

  /** The rows that were not imported, as an Excel file to fix and import again. */
  async openFailed(base64: string, projectName: string) {
    const fileName = `tasks-to-fix-${slug(projectName)}.xlsx`;
    const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${fileName}`;
    await ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64');
    await openFile(path, fileName);
  },
};

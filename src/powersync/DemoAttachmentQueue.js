import { AttachmentQueue } from '@powersync/react-native';
import { TABLES } from './schema';

export function createDemoAttachmentQueue({ db, localStorage, remoteStorage }) {
  return new AttachmentQueue({
    db,
    localStorage,
    remoteStorage,
    syncIntervalMs: 5000,
    downloadAttachments: true,
    archivedCacheLimit: 100,
    async *watchAttachments() {
      for await (const result of db.watch(
        `SELECT attachment_id AS id, file_extension FROM ${TABLES.files} WHERE attachment_id IS NOT NULL`,
        []
      )) {
        const items = (result.rows?._array ?? [])
          .filter((row) => row.id)
          .map((row) => ({ id: row.id, fileExtension: row.file_extension || 'bin' }));
        yield items;
      }
    },
    async onDownloadError(attachment, error) {
      if (String(error).includes('Object not found')) {
        return false;
      }
      return true;
    },
    async onDeleteError(_attachment, _error) {
      return false;
    }
  });
}

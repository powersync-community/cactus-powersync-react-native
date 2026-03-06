import { AppEnv } from '../config/env';

const ensureArrayBuffer = (value) => {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return new Uint8Array(value).buffer;
};

export class SupabaseRemoteStorage {
  constructor(options) {
    this.client = options.client;
    this.bucket = options.bucket ?? AppEnv.supabaseBucket;
  }

  async uploadFile(filename, data) {
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(filename, ensureArrayBuffer(data), {
        upsert: true,
        contentType: 'application/octet-stream'
      });
    if (error) throw error;
  }

  async downloadFile(filename) {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(filename);
    if (error) throw error;
    return data;
  }

  async deleteFile(filename) {
    // Skip storage errors for delete to avoid blocking queue cleanup.
    await this.client.storage
      .from(this.bucket)
      .remove([filename]);
  }
}

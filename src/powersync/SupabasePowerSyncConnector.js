import { UpdateType } from '@powersync/react-native';
import { AppEnv } from '../config/env';

const FATAL_UPLOAD_HTTP_STATUSES = new Set([400, 401, 403, 404, 409, 410, 422]);

const isFatalUploadError = (error) => {
  const status = Number(error?.status);
  if (!Number.isFinite(status)) {
    return false;
  }

  if (status === 408 || status === 429 || status >= 500) {
    return false;
  }

  return FATAL_UPLOAD_HTTP_STATUSES.has(status) || (status >= 400 && status < 500);
};

const throwIfPostgrestError = (result) => {
  if (result.error) {
    const err = new Error(result.error.message);
    err.status = result.status;
    err.code = result.error.code;
    err.details = result.error.details;
    throw err;
  }
};

export class SupabasePowerSyncConnector {
  constructor(options) {
    this.client = options.client;
    this.powersyncUrl = options.powersyncUrl ?? AppEnv.powersyncUrl;
    this.demoOfflineMode = false;
  }

  setDemoOfflineMode(value) {
    this.demoOfflineMode = Boolean(value);
  }

  async login(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }

  async signUp(email, password) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    return { session: data.session };
  }

  async logout() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  async getSession() {
    const { data: { session } } = await this.client.auth.getSession();
    return session;
  }

  async fetchCredentials() {
    if (this.demoOfflineMode) {
      return null;
    }

    const { data: { session } } = await this.client.auth.getSession();

    if (!session || !session.access_token || !this.powersyncUrl) {
      return null;
    }

    return {
      endpoint: this.powersyncUrl,
      token: session.access_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined
    };
  }

  async uploadData(database) {
    if (this.demoOfflineMode) {
      throw new Error('Upload blocked: demo offline mode enabled.');
    }

    const transaction = await database.getNextCrudTransaction();
    if (!transaction) {
      return;
    }

    let currentOp = null;
    try {
      for (const operation of transaction.crud) {
        currentOp = operation;
        await this.uploadOperation(operation);
      }
      await transaction.complete();
    } catch (error) {
      console.error(
        `Upload failed for [${currentOp?.op}] ${currentOp?.table} id=${currentOp?.id}`,
        '\nopData:', JSON.stringify(currentOp?.opData, null, 2),
        '\nstatus:', error?.status,
        '\nerror:', error?.message ?? error
      );
      if (isFatalUploadError(error)) {
        console.error('Discarding non-retryable CRUD transaction (status', error?.status + ')');
        await transaction.complete();
        return;
      }

      throw error;
    }
  }

  async uploadOperation(operation) {
    const { data: { session } } = await this.client.auth.getSession();

    if (!session?.access_token) {
      throw new Error('No Supabase access token available for upload.');
    }

    const table = operation.table;

    switch (operation.op) {
      case UpdateType.PUT: {
        const result = await this.client
          .from(table)
          .upsert({ ...operation.opData, id: operation.id }, { onConflict: 'id' });
        throwIfPostgrestError(result);
        return;
      }

      case UpdateType.PATCH: {
        const result = await this.client
          .from(table)
          .update(operation.opData)
          .eq('id', operation.id);
        throwIfPostgrestError(result);
        return;
      }

      case UpdateType.DELETE: {
        const result = await this.client
          .from(table)
          .delete()
          .eq('id', operation.id);
        throwIfPostgrestError(result);
        return;
      }

      default:
        throw new Error(`Unsupported CRUD operation type: ${String(operation.op)}`);
    }
  }
}

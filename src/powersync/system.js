import { PowerSyncDatabase, SyncStreamConnectionMethod } from '@powersync/react-native';
import { OPSqliteOpenFactory } from '@powersync/op-sqlite';
import { ExpoFileSystemStorageAdapter } from '@powersync/attachments-storage-react-native';
import { AppEnv } from '../config/env';
import { createSupabaseClient } from '../supabase/SupabaseRestClient';
import { SupabaseRemoteStorage } from './SupabaseStorageAdapter';
import { SupabasePowerSyncConnector } from './SupabasePowerSyncConnector';
import { createDemoAttachmentQueue } from './DemoAttachmentQueue';
import { AppSchema } from './schema';

export class DemoSystem {
  constructor() {
    // PowerSync DB and local storage don't need credentials — create them up front.
    this.localStorage = new ExpoFileSystemStorageAdapter();

    const opSqlite = new OPSqliteOpenFactory({
      dbFilename: 'cactus-powersync-demo.db'
    });

    this.powersync = new PowerSyncDatabase({
      schema: AppSchema,
      database: opSqlite
    });

    // Credential-dependent objects start null; populated by _applyEnv().
    this.client = null;
    this.connector = null;
    this.remoteStorage = null;
    this.attachmentQueue = null;
    this.initPromise = null;
    this.initialized = false;
    this.attachmentsInitialized = false;

    // Apply baked-in env vars (silently no-ops if they're empty).
    this._applyEnv(AppEnv);
  }

  /**
   * (Re)create credential-dependent objects from the given env object.
   * Returns true if credentials were valid, false if they were missing.
   */
  _applyEnv(env) {
    const client = createSupabaseClient(env);
    if (!client) return false;

    this.client = client;
    this.connector = new SupabasePowerSyncConnector({
      client: this.client,
      powersyncUrl: env.powersyncUrl
    });
    this.remoteStorage = new SupabaseRemoteStorage({
      client: this.client,
      bucket: env.supabaseBucket || AppEnv.supabaseBucket || 'files'
    });
    return true;
  }

  /** True if Supabase credentials have been configured. */
  get hasCredentials() {
    return Boolean(this.client);
  }

  async init() {
    if (this.initialized) return;

    if (!this.initPromise) {
      this.initPromise = this._initInternal();
    }

    await this.initPromise;
  }

  async _initInternal() {
    await this.powersync.init();

    // Only connect to PowerSync if we have credentials + a valid endpoint.
    if (this.connector?.powersyncUrl) {
      await this.powersync.connect(this.connector, {
        connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET
      });

      if (!this.attachmentsInitialized) {
        this.attachmentQueue = createDemoAttachmentQueue({
          db: this.powersync,
          localStorage: this.localStorage,
          remoteStorage: this.remoteStorage
        });
        await this.attachmentQueue.startSync();
        this.attachmentsInitialized = true;
      }
    }

    this.initialized = true;
  }

  /**
   * Apply new credentials and reconnect.
   * Safe to call at any point — tears down existing sync state first.
   */
  async reconfigure(env) {
    if (this.attachmentQueue) {
      try { this.attachmentQueue.stop?.(); } catch {}
      this.attachmentQueue = null;
      this.attachmentsInitialized = false;
    }

    if (this.initialized) {
      try { await this.powersync.disconnect(); } catch {}
    }

    this.initPromise = null;
    this.initialized = false;

    this._applyEnv(env);

    await this.init();
  }

  async reconnect() {
    await this.powersync.disconnect();
    if (this.connector) {
      await this.powersync.connect(this.connector, {
        connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET
      });
    }
  }
}

export const system = new DemoSystem();

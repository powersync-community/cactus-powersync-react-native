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
    this.client = createSupabaseClient(AppEnv);
    this.connector = new SupabasePowerSyncConnector({
      client: this.client,
      powersyncUrl: AppEnv.powersyncUrl
    });

    this.remoteStorage = new SupabaseRemoteStorage({
      client: this.client,
      bucket: AppEnv.supabaseBucket
    });

    this.localStorage = new ExpoFileSystemStorageAdapter();

    const opSqlite = new OPSqliteOpenFactory({
      dbFilename: 'cactus-powersync-demo.db'
    });

    this.powersync = new PowerSyncDatabase({
      schema: AppSchema,
      database: opSqlite
    });

    this.attachmentQueue = null;
    this.initPromise = null;
    this.initialized = false;
    this.attachmentsInitialized = false;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.initializeInternal();
    }

    await this.initPromise;
  }

  async initializeInternal() {
    await this.powersync.init();
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

    this.initialized = true;
  }

  async reconnect() {
    await this.powersync.disconnect();
    await this.powersync.connect(this.connector, {
      connectionMethod: SyncStreamConnectionMethod.WEB_SOCKET
    });
  }
}

export const system = new DemoSystem();

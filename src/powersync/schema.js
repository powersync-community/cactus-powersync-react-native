import {
  Column,
  ColumnType,
  Index,
  IndexedColumn,
  Schema,
  Table
} from '@powersync/common';

export const TABLES = {
  documents: 'demo_documents',
  queries: 'demo_queries',
  transcripts: 'demo_transcripts',
  files: 'demo_files',
  costEvents: 'demo_cost_events',
  operations: 'demo_operations'
};

export const AppSchema = new Schema([
  new Table({
    name: TABLES.documents,
    columns: [
      new Column({ name: 'created_at', type: ColumnType.TEXT }),
      new Column({ name: 'title', type: ColumnType.TEXT }),
      new Column({ name: 'content', type: ColumnType.TEXT }),
      new Column({ name: 'embedding_json', type: ColumnType.TEXT })
    ],
    indexes: [
      new Index({
        name: 'documents_created_at',
        columns: [new IndexedColumn({ name: 'created_at' })]
      })
    ]
  }),
  new Table({
    name: TABLES.queries,
    columns: [
      new Column({ name: 'created_at', type: ColumnType.TEXT }),
      new Column({ name: 'question', type: ColumnType.TEXT }),
      new Column({ name: 'answer', type: ColumnType.TEXT }),
      new Column({ name: 'context_doc_ids_json', type: ColumnType.TEXT }),
      new Column({ name: 'cloud_handoff', type: ColumnType.INTEGER }),
      new Column({ name: 'total_tokens', type: ColumnType.INTEGER }),
      new Column({ name: 'total_time_ms', type: ColumnType.INTEGER })
    ],
    indexes: [
      new Index({
        name: 'queries_created_at',
        columns: [new IndexedColumn({ name: 'created_at' })]
      })
    ]
  }),
  new Table({
    name: TABLES.transcripts,
    columns: [
      new Column({ name: 'created_at', type: ColumnType.TEXT }),
      new Column({ name: 'audio_path', type: ColumnType.TEXT }),
      new Column({ name: 'transcript', type: ColumnType.TEXT }),
      new Column({ name: 'cloud_handoff', type: ColumnType.INTEGER }),
      new Column({ name: 'total_tokens', type: ColumnType.INTEGER }),
      new Column({ name: 'total_time_ms', type: ColumnType.INTEGER })
    ],
    indexes: [
      new Index({
        name: 'transcripts_created_at',
        columns: [new IndexedColumn({ name: 'created_at' })]
      })
    ]
  }),
  new Table({
    name: TABLES.files,
    columns: [
      new Column({ name: 'created_at', type: ColumnType.TEXT }),
      new Column({ name: 'label', type: ColumnType.TEXT }),
      new Column({ name: 'attachment_id', type: ColumnType.TEXT }),
      new Column({ name: 'mime_type', type: ColumnType.TEXT }),
      new Column({ name: 'size_bytes', type: ColumnType.INTEGER }),
      new Column({ name: 'file_extension', type: ColumnType.TEXT })
    ],
    indexes: [
      new Index({
        name: 'files_attachment_id',
        columns: [new IndexedColumn({ name: 'attachment_id' })]
      })
    ]
  }),
  new Table({
    name: TABLES.costEvents,
    columns: [
      new Column({ name: 'created_at', type: ColumnType.TEXT }),
      new Column({ name: 'feature', type: ColumnType.TEXT }),
      new Column({ name: 'total_tokens', type: ColumnType.INTEGER }),
      new Column({ name: 'total_time_ms', type: ColumnType.INTEGER }),
      new Column({ name: 'cloud_handoff', type: ColumnType.INTEGER }),
      new Column({ name: 'cloud_cost_usd', type: ColumnType.REAL }),
      new Column({ name: 'device_cost_usd', type: ColumnType.REAL }),
      new Column({ name: 'saved_usd', type: ColumnType.REAL })
    ],
    indexes: [
      new Index({
        name: 'cost_events_feature',
        columns: [new IndexedColumn({ name: 'feature' })]
      }),
      new Index({
        name: 'cost_events_created_at',
        columns: [new IndexedColumn({ name: 'created_at' })]
      })
    ]
  }),
  new Table({
    name: TABLES.operations,
    columns: [
      new Column({ name: 'created_at', type: ColumnType.TEXT }),
      new Column({ name: 'note', type: ColumnType.TEXT }),
      new Column({ name: 'offline_mode', type: ColumnType.INTEGER })
    ],
    indexes: [
      new Index({
        name: 'operations_created_at',
        columns: [new IndexedColumn({ name: 'created_at' })]
      })
    ]
  }),
  new Table({
    name: 'attachments',
    localOnly: true,
    columns: [
      new Column({ name: 'filename', type: ColumnType.TEXT }),
      new Column({ name: 'local_uri', type: ColumnType.TEXT }),
      new Column({ name: 'timestamp', type: ColumnType.INTEGER }),
      new Column({ name: 'size', type: ColumnType.INTEGER }),
      new Column({ name: 'media_type', type: ColumnType.TEXT }),
      new Column({ name: 'state', type: ColumnType.INTEGER }),
      new Column({ name: 'has_synced', type: ColumnType.INTEGER }),
      new Column({ name: 'meta_data', type: ColumnType.TEXT })
    ]
  })
]);

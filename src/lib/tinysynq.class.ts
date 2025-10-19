import DB from 'better-sqlite3';
import { TinySynqSync, TinySynqOptions, createHybridAdapter } from '@bspeckco/tinysynq-lib';

/**
 * The main class for managing SQLite3 synchronisation.
 *
 * @remarks
 * Expects SQLite3 version \>=3.45.1
 *
 * @public
 */
export class TinySynq extends TinySynqSync {

  /**
   * Configure new TinySynq instance.
   *
   * @param opts - Configuration options
   */
  constructor(opts: TinySynqOptions) {
    // If adapter not provided, create one from better-sqlite3
    if (!opts.adapter) {
      if (!opts.filePath && !opts.sqlite3) {
        throw new Error('No DB filePath or connection provided');
      }

      const db = opts.sqlite3 || new DB(opts.filePath!);

      // Set WAL mode before creating adapter
      if (opts.wal !== false) {
        db.pragma('journal_mode = WAL');
      }

      const adapter = createHybridAdapter({
        driver: 'better-sqlite3',
        db,
        closeOnDispose: !opts.sqlite3, // Only close if we created it
      });

      opts = { ...opts, adapter };
    }

    super(opts);
  }
}

import DB from 'better-sqlite3'
import { TinySynqSync, TinySynqOptions } from '@bspeckco/tinysynq-lib';

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
    super(opts);
    if (!opts.filePath && !opts.sqlite3) {
      throw new Error('No DB filePath or connection provided');
    }

    if (!this.db) {
      this._db = new DB(this.dbPath);
      this.db.pragma('journal_mode = WAL');
    }
  }
}

export const testCreateTableJournal = `
  CREATE TABLE IF NOT EXISTS journal (
    journal_id TEXT PRIMARY KEY,
    journal_name TEXT NOT NULL,
    journal_description TEXT,
    journal_created TIMESTAMP DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%f','NOW'))
  );
`;

export const testCreateTableEntry = `
  CREATE TABLE IF NOT EXISTS entry (
    entry_id TEXT PRIMARY KEY,
    entry_journal_id INTEGER,
    entry_title TEXT NOT NULL,
    entry_content TEXT NOT NULL,
    entry_date DATE NOT NULL,
    entry_created TIMESTAMP DEFAULT(STRFTIME('%Y-%m-%dT%H:%M:%f','NOW')),
    entry_updated TIMESTAMP NULL,
    FOREIGN KEY (entry_journal_id) REFERENCES journal(journal_id) ON DELETE CASCADE
  );
`;

export const testInsertRowJournal = `
  INSERT INTO journal (journal_id, journal_name, journal_created)
  VALUES (:journal_id, :journal_name, :journal_created)
`;

export const testInsertRowEntry = `
  INSERT INTO entry (entry_id, entry_journal_id, entry_title, entry_content, entry_date)
  VALUES (:entry_id, :entry_journal_id, :entry_title, :entry_content, :entry_date)
`;

export const testJournalData = [
  {
    "journal_id": "HZsaucO6O27QBE7G",
    "journal_name": "Test1",
    "journal_created": "2024-02-08T17:23:14.307"
  },
  {
    "journal_id": "XaNhWkYSKloJ4GJf",
    "journal_name": "Test2",
    "journal_created": "2024-02-08T18:42:14.391"
  },
  {
    "journal_id": "34eDqxl1t0HZV8Xk",
    "journal_name": "Jrn3",
    "journal_created": "2024-02-10T13:21:41.019"
  }
];

export const testEntryData = [
  {
    "entry_id": "Rla1kGc1bWxnUdui",
    "entry_journal_id": "XaNhWkYSKloJ4GJf",
    "entry_title": "First entry",
    "entry_content": "This is an entry.",
    "entry_date": "2024-02-08T19:08:45.000",
    "entry_created": "2024-02-08T19:08:45.495",
    "entry_updated": null
  },
  {
    "entry_id": "ouvE_aqOYl_91Nyh",
    "entry_journal_id": "XaNhWkYSKloJ4GJf",
    "entry_title": "Another entry",
    "entry_content": "This is just another test entry.",
    "entry_date": "2024-02-08T19:20:31.000",
    "entry_created": "2024-02-08T19:20:31.539",
    "entry_updated": null
  },
  {
    "entry_id": "fOo1rrwyz3aAHEns",
    "entry_journal_id": "XaNhWkYSKloJ4GJf",
    "entry_title": "One more...",
    "entry_content": "Testing list refresh.",
    "entry_date": "2024-02-08T19:21:27.000",
    "entry_created": "2024-02-08T19:21:27.407",
    "entry_updated": null
  },
  {
    "entry_id": "LHXkBf_spKXn4SpK",
    "entry_journal_id": "34eDqxl1t0HZV8Xk",
    "entry_title": "Testing Jrn3",
    "entry_content": "Just a test.",
    "entry_date": "2024-02-10T13:22:07.000",
    "entry_created": "2024-02-10T13:22:07.809",
    "entry_updated": null
  }
];
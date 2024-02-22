export const testCreateTableItems = [
  `CREATE TABLE IF NOT EXISTS items (
    item_id TEXT PRIMARY KEY,
    name TEXT
  );`
];

export const testInsertRowItem = [
  `INSERT INTO items (item_id, name) VALUES ('fakeId0', 'Initial Item')`,
  `INSERT INTO items (item_id, name) VALUES ('fakeId1', 'Deleteable Item')`,
];
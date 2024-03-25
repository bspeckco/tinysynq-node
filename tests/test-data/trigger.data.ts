export const testCreateTableUser = `
CREATE TABLE IF NOT EXISTS user (
  user_id TEXT PRIMARY KEY,
  user_uuid TEXT UNIQUE,
  user_admin BOOLEAN,
  user_internal BOOLEAN,
  user_system BOOLEAN,
  user_gnid TEXT
);`

export const testInsertDataUser = [
  `INSERT INTO "user" (user_id, user_uuid, user_admin)
  VALUES ('u001', '0000-0000-0000-0001', 1)`
];

export const testPragmaTableInfo = [
  {
    "cid" : 0,
    "name" : "user_id",
    "type" : "TEXT",
    "notnull" : 0,
    "dflt_value" : null,
    "pk" : 1
  },
  {
    "cid" : 1,
    "name" : "user_uuid",
    "type" : "TEXT",
    "notnull" : 0,
    "dflt_value" : null,
    "pk" : 0
  },
  {
    "cid" : 2,
    "name" : "user_admin",
    "type" : "BOOLEAN",
    "notnull" : 0,
    "dflt_value" : null,
    "pk" : 0
  },
  {
    "cid" : 3,
    "name" : "user_internal",
    "type" : "BOOLEAN",
    "notnull" : 0,
    "dflt_value" : null,
    "pk" : 0
  },
  {
    "cid" : 4,
    "name" : "user_system",
    "type" : "BOOLEAN",
    "notnull" : 0,
    "dflt_value" : null,
    "pk" : 0
  },
  {
    "cid" : 5,
    "name" : "user_gnid",
    "type" : "TEXT",
    "notnull" : 0,
    "dflt_value" : null,
    "pk" : 0
  }
];

export const testOldVsNewUnionColumnSelectionSample = [
  "SELECT 'user_id' AS col, OLD.user_id AS old_val, NEW.user_id AS new_val",
  "SELECT 'user_uuid' AS col, OLD.user_uuid AS old_val, NEW.user_uuid AS new_val",
  "SELECT 'user_admin' AS col, OLD.user_admin AS old_val, NEW.user_admin AS new_val",
  "SELECT 'user_internal' AS col, OLD.user_internal AS old_val, NEW.user_internal AS new_val",
  "SELECT 'user_system' AS col, OLD.user_system AS old_val, NEW.user_system AS new_val",
  "SELECT 'user_gnid' AS col, OLD.user_gnid AS old_val, NEW.user_gnid AS new_val"
];

export const testFinalDiffQuery = `
INSERT INTO {{synqPrefix}}_changes (table_name, row_id, operation, data)
SELECT * FROM (
  WITH RECURSIVE all_cols AS (
    SELECT 'user_id' AS col, OLD.user_id AS old_val, NEW.user_id AS new_val
    UNION ALL
    SELECT 'user_uuid' AS col, OLD.user_uuid AS old_val, NEW.user_uuid AS new_val
    UNION ALL
    SELECT 'user_admin' AS col, OLD.user_admin AS old_val, NEW.user_admin AS new_val
    UNION ALL
    SELECT 'user_internal' AS col, OLD.user_internal AS old_val, NEW.user_internal AS new_val
    UNION ALL
    SELECT 'user_system' AS col, OLD.user_system AS old_val, NEW.user_system AS new_val
    UNION ALL
    SELECT 'user_gnid' AS col, OLD.user_gnid AS old_val, NEW.user_gnid AS new_val
  ),
  changed_cols AS (
    SELECT col, new_val
    FROM all_cols
    WHERE new_val != old_val
  )
  SELECT 'user', NEW.user_id, 'UPDATE', json_group_object(col, new_val)
  FROM changed_cols
);`;
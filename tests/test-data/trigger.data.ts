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

export const testOldVsNewSelectionSample = [
  "substr(group_concat(CAST(user_id AS TEXT), ':|:'), 1, LENGTH(CAST(user_id AS TEXT))) as o_user_id",
  "substr(group_concat(CAST(user_id AS TEXT), ':|:'), LENGTH(CAST(user_id AS TEXT)) + 4) as n_user_id",
  "substr(group_concat(CAST(user_uuid AS TEXT), ':|:'), 1, LENGTH(CAST(user_uuid AS TEXT))) as o_user_uuid",
  "substr(group_concat(CAST(user_uuid AS TEXT), ':|:'), LENGTH(CAST(user_uuid AS TEXT)) + 4) as n_user_uuid",
  "substr(group_concat(CAST(user_admin AS TEXT), ':|:'), 1, LENGTH(CAST(user_admin AS TEXT))) as o_user_admin",
  "substr(group_concat(CAST(user_admin AS TEXT), ':|:'), LENGTH(CAST(user_admin AS TEXT)) + 4) as n_user_admin",
  "substr(group_concat(CAST(user_internal AS TEXT), ':|:'), 1, LENGTH(CAST(user_internal AS TEXT))) as o_user_internal",
  "substr(group_concat(CAST(user_internal AS TEXT), ':|:'), LENGTH(CAST(user_internal AS TEXT)) + 4) as n_user_internal",
  "substr(group_concat(CAST(user_system AS TEXT), ':|:'), 1, LENGTH(CAST(user_system AS TEXT))) as o_user_system",
  "substr(group_concat(CAST(user_system AS TEXT), ':|:'), LENGTH(CAST(user_system AS TEXT)) + 4) as n_user_system",
  "substr(group_concat(CAST(user_gnid AS TEXT), ':|:'), 1, LENGTH(CAST(user_gnid AS TEXT))) as o_user_gnid",
  "substr(group_concat(CAST(user_gnid AS TEXT), ':|:'), LENGTH(CAST(user_gnid AS TEXT)) + 4) as n_user_gnid"
];

export const testOldVsNewUnionSelectsSample = [
  "SELECT 'user_id' as prop, o_user_id as o_val, n_user_id as n_val FROM old_new",
  "SELECT 'user_uuid' as prop, o_user_uuid as o_val, n_user_uuid as n_val FROM old_new",
  "SELECT 'user_admin' as prop, o_user_admin as o_val, n_user_admin as n_val FROM old_new",
  "SELECT 'user_internal' as prop, o_user_internal as o_val, n_user_internal as n_val FROM old_new",
  "SELECT 'user_system' as prop, o_user_system as o_val, n_user_system as n_val FROM old_new",
  "SELECT 'user_gnid' as prop, o_user_gnid as o_val, n_user_gnid as n_val FROM old_new"
];

export const testFinalDiffQuery = `
SELECT *
FROM (
  WITH old_new AS (
    SELECT 
      substr(group_concat(CAST(user_id AS TEXT), ':|:'), 1, LENGTH(CAST(user_id AS TEXT))) as o_user_id,substr(group_concat(CAST(user_id AS TEXT), ':|:'), LENGTH(CAST(user_id AS TEXT)) + 4) as n_user_id,substr(group_concat(CAST(user_uuid AS TEXT), ':|:'), 1, LENGTH(CAST(user_uuid AS TEXT))) as o_user_uuid,substr(group_concat(CAST(user_uuid AS TEXT), ':|:'), LENGTH(CAST(user_uuid AS TEXT)) + 4) as n_user_uuid,substr(group_concat(CAST(user_admin AS TEXT), ':|:'), 1, LENGTH(CAST(user_admin AS TEXT))) as o_user_admin,substr(group_concat(CAST(user_admin AS TEXT), ':|:'), LENGTH(CAST(user_admin AS TEXT)) + 4) as n_user_admin,substr(group_concat(CAST(user_internal AS TEXT), ':|:'), 1, LENGTH(CAST(user_internal AS TEXT))) as o_user_internal,substr(group_concat(CAST(user_internal AS TEXT), ':|:'), LENGTH(CAST(user_internal AS TEXT)) + 4) as n_user_internal,substr(group_concat(CAST(user_system AS TEXT), ':|:'), 1, LENGTH(CAST(user_system AS TEXT))) as o_user_system,substr(group_concat(CAST(user_system AS TEXT), ':|:'), LENGTH(CAST(user_system AS TEXT)) + 4) as n_user_system,substr(group_concat(CAST(user_gnid AS TEXT), ':|:'), 1, LENGTH(CAST(user_gnid AS TEXT))) as o_user_gnid,substr(group_concat(CAST(user_gnid AS TEXT), ':|:'), LENGTH(CAST(user_gnid AS TEXT)) + 4) as n_user_gnid
    FROM (
      SELECT 0 as peg, OLD.user_id,OLD.user_uuid,OLD.user_admin,OLD.user_internal,OLD.user_system,OLD.user_gnid
      UNION ALL 
      SELECT 1 as peg, NEW.user_id,NEW.user_uuid,NEW.user_admin,NEW.user_internal,NEW.user_system,NEW.user_gnid
    )
    ORDER BY peg ASC
  )
  SELECT 'user_id' as prop, o_user_id as o_val, n_user_id as n_val FROM old_new
UNION ALL
SELECT 'user_uuid' as prop, o_user_uuid as o_val, n_user_uuid as n_val FROM old_new
UNION ALL
SELECT 'user_admin' as prop, o_user_admin as o_val, n_user_admin as n_val FROM old_new
UNION ALL
SELECT 'user_internal' as prop, o_user_internal as o_val, n_user_internal as n_val FROM old_new
UNION ALL
SELECT 'user_system' as prop, o_user_system as o_val, n_user_system as n_val FROM old_new
UNION ALL
SELECT 'user_gnid' as prop, o_user_gnid as o_val, n_user_gnid as n_val FROM old_new
)
WHERE o_val != n_val;`;
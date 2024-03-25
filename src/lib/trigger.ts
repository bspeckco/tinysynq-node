

import { TinySynq } from "./tinysynq.class.js";
import { SyncableTable } from "./types.js";

export const getOldVsNewUnionColumnSelection = (params: {columns: any[]}) => {
  if (!params.columns) throw new Error('Missing table column data to generate trigger union column selection'); 

  return params.columns.map((c) => `SELECT '${c.name}' AS col, OLD.${c.name} AS old_val, NEW.${c.name} AS new_val`);
}

export const getUpdateTriggerDiffQuery = (params: {ts: TinySynq, table: SyncableTable}) => {
  const { ts, table } = params;
  // Need to get the table schema in order to generate the query.
  const columns = ts.runQuery({
    sql: `SELECT * FROM pragma_table_info('${table.name}')`
  });

  const unionSelects = getOldVsNewUnionColumnSelection({columns});
  const sql = `
  INSERT INTO ${ts.synqPrefix}_changes (table_name, row_id, operation, data)
  SELECT * FROM (
    WITH RECURSIVE all_cols AS (
      ${unionSelects.join('\n    UNION ALL\n    ')}
    ),
    changed_cols AS (
      SELECT col, new_val
      FROM all_cols
      WHERE new_val != old_val
    )
    SELECT '${table.name}', NEW.${table.id}, 'UPDATE', json_group_object(col, new_val)
    FROM changed_cols
  );`;
  console.log('@getUpdateTriggerDiffQuery', sql)

  return sql;
};
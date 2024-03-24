/*


SELECT *
FROM (
    -- existing_incoming (OLD vs NEW)
	WITH e_i AS (
		SELECT 
			substr(group_concat(CAST(user_admin AS TEXT), ':|:'), 1, LENGTH(CAST(user_admin AS TEXT))) as o_user_admin,
			substr(group_concat(user_admin, ':|:'), LENGTH(CAST(user_admin AS TEXT)) + 4) as n_user_admin,
			substr(group_concat(user_internal, ':|:'), 1, LENGTH(CAST(user_internal AS TEXT))) as o_user_internal,
			substr(group_concat(user_internal, ':|:'), LENGTH(CAST(user_internal AS TEXT)) + 4) as n_user_internal,
			substr(group_concat(user_system, ':|:'), 1, LENGTH(CAST(user_system AS TEXT))) as o_user_system,
			substr(group_concat(CAST(user_system AS TEXT), ':|:'), LENGTH(CAST(user_system AS TEXT)) + 4) as n_user_system
			
		FROM (
			-- Select the existing user (For updates)
			SELECT 0 as peg, user.* FROM user WHERE user.user_id = 'u001' -- OLD and NEW objects will be used in the actual trigger
			UNION 
			-- Select a default user (id and uuid would actually don't matter because they would be overwritten by incoming)
			SELECT 1 as peg, RANDOM() as user_id, '0000-0000-0000-0000' as user_uuid, 0 as user_admin, 0 as user_internal, 0 as user_system, null as user_gnid
		)
		ORDER BY peg ASC
	)
	
	SELECT 'user_admin' as prop, o_user_admin as o_val, n_user_admin as n_val FROM e_i
	UNION
	SELECT 'user_internal' as prop, o_user_internal as o_val, n_user_internal as n_val FROM e_i
	UNION
	SELECT 'user_system' as prop, o_user_system as o_val, n_user_system as n_val FROM e_i
)
WHERE o_val != n_val

*/

import { TinySynq } from "./tinysynq.class.js";
import { SyncableTable } from "./types.js";


export const getOldVsNewColumnSelection =  (params: {columns: any[]}) => {
  if (!params.columns) throw new Error('Missing table column data to generate trigger sub-select');

  const selectColumns: string[] = [];
  for (const c of params.columns) {
    const o = `substr(group_concat(CAST(${c.name} AS TEXT), ':|:'), 1, LENGTH(CAST(${c.name} AS TEXT))) as o_${c.name}`
    const n = `substr(group_concat(CAST(${c.name} AS TEXT), ':|:'), LENGTH(CAST(${c.name} AS TEXT)) + 4) as n_${c.name}` 
    selectColumns.push(o);
    selectColumns.push(n);
  }
  return selectColumns;
}

export const getOldVsNewUnionSelects = (params: {columns: any[]}) => {
  if (!params.columns) throw new Error('Missing table column data to generate trigger union selects');

  return params.columns.map(c =>
    `SELECT '${c.name}' as prop, o_${c.name} as o_val, n_${c.name} as n_val FROM old_new`
  );
}

export const getOldVsNewUnionColumnSelection = (params: {columns: any[], version: 'NEW' | 'OLD'}) => {
  if (!params.columns) throw new Error('Missing table column data to generate trigger union column selection');

  return params.columns.map(c => `${params.version}.${c.name}`);
}

export const generateUpdateDiffQuery = (params: {ts: TinySynq, table: SyncableTable}) => {
  const { ts, table } = params;
  // Need to get the table schema in order to generate the query.
  const columns = ts.runQuery({
    sql: `SELECT * FROM pragma_table_info('${table.name}')`
  });

  const oldVsNewColumnSelection = getOldVsNewColumnSelection({columns});
  const newColumns = getOldVsNewUnionColumnSelection({columns, version: 'NEW'});
  const oldColumns = getOldVsNewUnionColumnSelection({columns, version: 'OLD'});
  const unionSelects = getOldVsNewUnionSelects({columns});

  const sql = `
  SELECT *
  FROM (
    WITH old_new AS (
      SELECT 
        ${oldVsNewColumnSelection}
      FROM (
        SELECT 0 as peg, ${oldColumns.join(',')}
        UNION ALL
        SELECT 1 as peg, ${newColumns.join(',')}
      )
      ORDER BY peg ASC
    )
    ${unionSelects.join('\nUNION ALL\n')}
  )
  WHERE o_val != n_val;`;

  return sql
};
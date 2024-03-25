import { describe, expect, test } from "vitest";
import { getUpdateTriggerDiffQuery, getOldVsNewUnionColumnSelection } from "../src/lib/trigger.js";
import { getConfiguredDb } from "./utils.js";
import { testCreateTableUser, testFinalDiffQuery, testOldVsNewUnionColumnSelectionSample, testPragmaTableInfo } from "./test-data/trigger.data.js";

describe('Trigger', () => {
  test('getOldVsNewColumnSelection', () => {    
    const columns = testPragmaTableInfo;
    const selection = getOldVsNewUnionColumnSelection({columns});
    expect(selection).toHaveLength(6);
    expect(selection).toMatchObject(testOldVsNewUnionColumnSelectionSample);
  });

  test('generateUpdateDiffQuery', () => {
    const ts = getConfiguredDb({
      useDefault: false,
      config: {
        tables: [{name: 'user', id: 'user_id', editable: ['user_admin', 'user_internal', 'user_system']}],
        preInit: [testCreateTableUser],
        postInit: []
      }
    });
    const sql = getUpdateTriggerDiffQuery({ts, table: ts.synqTables!.user});
    expect(sql.replace(/\s+/g,'')).toEqual(testFinalDiffQuery.replace('{{synqPrefix}}', ts.synqPrefix!).replace(/\s+/g,''));
  });
});
import { describe, expect, test } from "vitest";
import { generateUpdateDiffQuery, getOldVsNewColumnSelection, getOldVsNewUnionSelects } from "../src/lib/trigger.js";
import { getConfiguredDb } from "./utils.js";
import { testCreateTableUser, testFinalDiffQuery, testOldVsNewSelectionSample, testOldVsNewUnionSelectsSample, testPragmaTableInfo } from "./test-data/trigger.data.js";

describe('Trigger', () => {
  test('getOldVsNewColumnSelection', () => {    
    const columns = testPragmaTableInfo;
    const selection = getOldVsNewColumnSelection({columns});
    expect(selection).toHaveLength(12);
    expect(selection).toMatchObject(testOldVsNewSelectionSample);
  });

  test('getOldVsNewUnionSelects', () => {    
    const columns = testPragmaTableInfo;
    const selects = getOldVsNewUnionSelects({columns});
    expect(selects).toHaveLength(6);
    expect(selects).toMatchObject(testOldVsNewUnionSelectsSample);
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
    const sql = generateUpdateDiffQuery({ts, table: ts.synqTables!.user});
    expect(sql.replace(/\s+/g,'')).toEqual(testFinalDiffQuery.replace(/\s+/g,''));
  });
});
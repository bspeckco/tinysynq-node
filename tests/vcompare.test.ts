import { describe, expect, test } from "vitest";
import { VCompare } from "../src/lib/vcompare.class.js";

/**
 * @TODO
 * There is a case where the remote's value for the local ID
 * _could_ be higher than the local's value for the local ID:
 * if the local instance had been restored to an earlier point.
 * This case is beyond the scope of VCompare, though. What
 * should happen is that the restored instance is forced to
 * download and apply the all updates.
 */

describe('VCompare', () => {
  test('should instantiate', () => {
    const vc = new VCompare({local: {'n1': 1}, remote: {}, localId: 'n1', localTime: '', remoteTime: ''});
    expect(vc).toBeTruthy();
  });

  test('should find conflict when each clock only has its own change', () => {
    const local = {n1: 1};
    const remote = {n2: 1};
    const vc = new VCompare({local, remote, localId: 'n1', localTime: '', remoteTime: ''});
    expect(vc.isConflicted()).toBeTruthy();
  });

  test('should find conflict when local clock is higher than remote', () => {
    const local = {n1: 2};
    const remote = {n1: 1, n2: 1};
    const vc = new VCompare({local, localId: 'n1', remote, localTime: '', remoteTime: ''});
    expect(vc.isConflicted()).toBeTruthy();
  });

  test('should not find conflict when all local values are lower or equal', () => {
    const local = {n1: 1};
    const remote = {n1: 1, n2: 1};
    const vc = new VCompare({local, remote, localId: 'n1', localTime: '', remoteTime: ''});
    expect(vc.isConflicted()).toBeFalsy();
  });

  test('should detect stale update', () => {
    const local = {n1: 6, n2: 3};
    const localTime = '1970-01-01T00:00:02.000';
    const remote = {n1: 5, n2: 3};
    const remoteTime = '1970-01-01T00:00:01.000';
    const vc = new VCompare({local, remote, localId: 'n1', localTime, remoteTime});
    expect(vc.isOutDated()).toBeTruthy();
  });

  test('should detect fresh update', () => {
    const local = {n1: 5, n2: 3};
    const localTime = '1970-01-01T00:00:01.000';
    const remote = {n1: 5, n2: 4};
    const remoteTime = '1970-01-01T00:00:02.100';
    const vc = new VCompare({local, remote, localId: 'n1', localTime, remoteTime});
    expect(vc.isOutDated()).toBeFalsy();
  });

  test('should detect out of order update', () => {
    const local = {n1: 5, n2: 3};
    const remote = {n1: 5, n2: 5};
    const vc = new VCompare({local, remote, localId: 'n1', localTime: '', remoteTime: ''});
    expect(vc.isOutOfOrder()).toBeTruthy();
  });

  test('should detect ordered update', () => {
    const local = {n1: 5, n2: 3};
    const remote = {n1: 5, n2: 4};
    const vc = new VCompare({local, remote, localId: 'n1', localTime: '', remoteTime: ''});
    expect(vc.isOutOfOrder()).toBeFalsy();
  });

  test('should merge vclocks correctly', () => {
    const local = {n1: 5, n2: 4};
    const remote: any = '{"n1": 5, "n2": 4, "n3": 1}';
    const vs = new VCompare({local, remote, localId: 'n1', localTime: '', remoteTime: ''});
    const merged = vs.merge();
    expect(merged).toMatchObject({n1: 5, n2: 4, n3: 1});
  });
});
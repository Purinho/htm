import { describe, expect, it } from 'vitest';
import {
  buildPayloadKeySignature,
  getRequiredParentRefs,
  groupUpsertEntriesIntoBatches,
  type BatchableUpsertItem
} from './cloudSyncBatchUtils';

function makeItem(
  id: string,
  entityTable: string,
  payload: Record<string, unknown>,
  byteSize = 100
): BatchableUpsertItem<string> {
  return {
    entry: id,
    entityTable,
    payload,
    byteSize,
    keySignature: buildPayloadKeySignature(payload)
  };
}

describe('cloudSyncBatchUtils', () => {
  it('groups consecutive items with same table and key signature', () => {
    const items = [
      makeItem('1', 'exercises', { id: '1', title: 'A' }),
      makeItem('2', 'exercises', { title: 'B', id: '2' }),
      makeItem('3', 'exercises', { id: '3', title: 'C' })
    ];

    const batches = groupUpsertEntriesIntoBatches(items, { maxBatchSize: 75, maxBatchBytes: 400_000 });
    expect(batches).toHaveLength(1);
    expect(batches[0].map((i) => i.entry)).toEqual(['1', '2', '3']);
  });

  it('splits batches on table or key-signature boundaries', () => {
    const items = [
      makeItem('1', 'exercises', { id: '1', title: 'A' }),
      makeItem('2', 'exercises', { id: '2', title: 'B', is_favorite: false }),
      makeItem('3', 'session_templates', { id: '3', title: 'T1' })
    ];

    const batches = groupUpsertEntriesIntoBatches(items);
    expect(batches).toHaveLength(3);
    expect(batches.map((b) => b.map((i) => i.entry))).toEqual([['1'], ['2'], ['3']]);
  });

  it('splits batches when maxBatchSize or maxBatchBytes is reached', () => {
    const items = [
      makeItem('1', 'exercises', { id: '1' }, 200),
      makeItem('2', 'exercises', { id: '2' }, 200),
      makeItem('3', 'exercises', { id: '3' }, 200),
      makeItem('4', 'exercises', { id: '4' }, 350),
      makeItem('5', 'exercises', { id: '5' }, 100)
    ];

    const batchesBySize = groupUpsertEntriesIntoBatches(items, {
      maxBatchSize: 2,
      maxBatchBytes: 10_000
    });
    expect(batchesBySize.map((b) => b.map((i) => i.entry))).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5']
    ]);

    const batchesByBytes = groupUpsertEntriesIntoBatches(items, {
      maxBatchSize: 50,
      maxBatchBytes: 450
    });
    expect(batchesByBytes.map((b) => b.map((i) => i.entry))).toEqual([
      ['1', '2'],
      ['3'],
      ['4', '5']
    ]);
  });

  it('extracts required parent refs for child tables and returns empty for top-level tables', () => {
    expect(
      getRequiredParentRefs('session_phases', { id: 'ph1', training_session_id: 's1' })
    ).toEqual([{ table: 'training_sessions', id: 's1' }]);

    expect(
      getRequiredParentRefs('session_blocks', { id: 'b1', session_phase_id: 'ph1' })
    ).toEqual([{ table: 'session_phases', id: 'ph1' }]);

    expect(
      getRequiredParentRefs('team_members', { id: 'tm1', team_id: 't1', club_member_id: 'm1' })
    ).toEqual([
      { table: 'teams', id: 't1' },
      { table: 'club_members', id: 'm1' }
    ]);

    expect(getRequiredParentRefs('exercises', { id: 'ex1', club_id: 'c1' })).toEqual([]);
    expect(getRequiredParentRefs('clubs', { id: 'c1' })).toEqual([]);
  });
});

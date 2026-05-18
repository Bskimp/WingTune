// Tests for the M1.7.1 per-log time-alignment composable.
//
// The composable is pure math + a couple of reactive reads — no chart,
// no async, so the tests stay tiny. Pinia is set up explicitly per
// test so each case gets a fresh session store.

import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSessionStore } from '../../src/stores/session';
import { useViewStore } from '../../src/stores/view';
import { useAlignedTime } from '../../src/composables/useAlignedTime';

describe('useAlignedTime', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('returns identity math when offset is 0 (default)', () => {
    const session = useSessionStore();
    const id = session.__test_seedLog({ name: 'L0' });
    const align = useAlignedTime(id);

    expect(align.offsetSec.value).toBe(0);
    expect(align.toSessionTime(10)).toBe(10);
    expect(align.toLogTime(10)).toBe(10);
  });

  it('applies positive offset: log → session adds, session → log subtracts', () => {
    const session = useSessionStore();
    const id = session.__test_seedLog({ name: 'L0' });
    session.setTimeOffset(id, 3.5);
    const align = useAlignedTime(id);

    expect(align.offsetSec.value).toBe(3.5);
    expect(align.toSessionTime(0)).toBe(3.5);
    expect(align.toSessionTime(10)).toBe(13.5);
    expect(align.toLogTime(13.5)).toBe(10);
    expect(align.toLogTime(0)).toBe(-3.5);
  });

  it('applies negative offset symmetrically', () => {
    const session = useSessionStore();
    const id = session.__test_seedLog({ name: 'L0' });
    session.setTimeOffset(id, -2);
    const align = useAlignedTime(id);

    expect(align.offsetSec.value).toBe(-2);
    expect(align.toSessionTime(5)).toBe(3);
    expect(align.toLogTime(3)).toBe(5);
  });

  it('returns null for an unknown logId', () => {
    const align = useAlignedTime('not-a-real-id');
    expect(align.offsetSec.value).toBe(0);
    expect(align.toSessionTime(10)).toBeNull();
    expect(align.toLogTime(10)).toBeNull();
    expect(align.alignedCursor.value).toBeNull();
  });

  it('alignedCursor mirrors view.cursorTime through the offset', () => {
    const session = useSessionStore();
    const view = useViewStore();
    const id = session.__test_seedLog({ name: 'L0' });
    session.setTimeOffset(id, 2.5);
    const align = useAlignedTime(id);

    // No cursor → null
    expect(align.alignedCursor.value).toBeNull();

    // Cursor at session time 10 → log-local 7.5 with offset 2.5
    view.setCursor(10);
    expect(align.alignedCursor.value).toBe(7.5);

    // Cursor cleared → null again
    view.setCursor(null);
    expect(align.alignedCursor.value).toBeNull();
  });

  it('reacts when the log is removed mid-session', async () => {
    const session = useSessionStore();
    const view = useViewStore();
    const id = session.__test_seedLog({ name: 'L0' });
    const align = useAlignedTime(id);
    view.setCursor(5);
    expect(align.alignedCursor.value).toBe(5);

    await session.removeLog(id);
    // After removal, the log is gone — alignedCursor falls through to null.
    expect(align.alignedCursor.value).toBeNull();
    expect(align.toSessionTime(0)).toBeNull();
  });
});

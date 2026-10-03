const { ctLog, getCtLogs, registerCtClient, unregisterCtClient } = require('../server/logger');

describe('ctLog - id-based updates and rate-defense precision', () => {
  beforeEach(() => {
    getCtLogs().length = 0;
  });

  test('plain ctLog appends an entry without an id field', () => {
    ctLog('plain message');
    const logs = getCtLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].message).toBe('plain message');
    expect(logs[0]).not.toHaveProperty('id');
  });

  test('ctLog with an id replaces the existing entry with the same id in place', () => {
    ctLog('before');
    ctLog('first waiting line', { id: 'w1' });
    ctLog('after');
    expect(getCtLogs().length).toBe(3);

    ctLog('resolved line', { id: 'w1' });

    const logs = getCtLogs();
    expect(logs.length).toBe(3);
    expect(logs[1].id).toBe('w1');
    expect(logs[1].message).toBe('resolved line');
    // Timestamp is refreshed so the UI can show the resolution time
    expect(typeof logs[1].timestamp).toBe('string');
    // No duplicate id'd entries
    expect(logs.filter(l => l.id === 'w1').length).toBe(1);
  });

  test('ctLog with an unknown id appends a new entry', () => {
    ctLog('line one');
    ctLog('waiting line', { id: 'w2' });
    const logs = getCtLogs();
    expect(logs.length).toBe(2);
    expect(logs[1].id).toBe('w2');
  });

  test('consecutive rate-defense lines still merge into a single entry', () => {
    ctLog('Rate defense / API cooldown: waiting 5.0s (comicvine.com)');
    ctLog('Rate defense / API cooldown: waiting 3.0s (comicvine.com)');

    const logs = getCtLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].message).toContain('waiting 3.0s');
  });

  test('WAITING FOR USER SELECTION is never merged into a preceding rate-defense line', () => {
    ctLog('Rate defense / API cooldown: waiting 5.0s (comicvine.com)');
    ctLog('>>> WAITING FOR USER SELECTION (Found 2 candidates)');

    const logs = getCtLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].message).toContain('Rate defense');
    expect(logs[1].message).toContain('WAITING FOR USER SELECTION');
  });

  test('a rate-defense line following an id-stamped entry does not clobber it', () => {
    ctLog('>>> WAITING FOR USER SELECTION (Found 4 candidates)', { id: 'w3' });
    ctLog('Rate defense / API cooldown: waiting 2.0s (gcd.org)');

    const logs = getCtLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].id).toBe('w3');
    expect(logs[0].message).toContain('WAITING FOR USER SELECTION');
    expect(logs[1].message).toContain('Rate defense');
  });

  test('registered SSE clients receive the id payload on create and update', () => {
    const writes = [];
    const fakeClient = { write: (chunk) => writes.push(chunk), flush: () => {} };
    registerCtClient(fakeClient);
    try {
      ctLog('>>> WAITING FOR USER SELECTION (Found 1 candidates)', { id: 'w4' });
      ctLog('✓ User selected candidate #1: Example', { id: 'w4' });
    } finally {
      unregisterCtClient(fakeClient);
    }

    expect(writes.length).toBe(2);
    expect(writes[0]).toContain('"id":"w4"');
    expect(writes[0]).toContain('WAITING FOR USER SELECTION');
    expect(writes[1]).toContain('"id":"w4"');
    expect(writes[1]).toContain('User selected candidate #1');
  });
});

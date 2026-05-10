const {
  validateDeviceName,
  validateDeviceId,
  validateLastReadPage,
  validateStatus,
  validateScanInterval,
  validateComicId,
  validateApiKey,
} = require('../server/validation');

describe('validateDeviceName', () => {
  test('accepts a normal name', () => {
    const result = validateDeviceName('My iPad');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('My iPad');
  });

  test('rejects non-string input', () => {
    const result = validateDeviceName(null);
    expect(result.valid).toBe(false);
  });
});

describe('validateDeviceId', () => {
  test('accepts alphanumeric id with hyphens', () => {
    const result = validateDeviceId('device-abc-123');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('device-abc-123');
  });

  test('rejects ids with spaces or special chars', () => {
    const result = validateDeviceId('bad id!');
    expect(result.valid).toBe(false);
  });
});

describe('validateLastReadPage', () => {
  test('accepts a non-negative integer within totalPages', () => {
    const result = validateLastReadPage(5, 20);
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe(5);
  });

  test('rejects negative pages', () => {
    const result = validateLastReadPage(-1, 20);
    expect(result.valid).toBe(false);
  });

  test('rejects pages exceeding totalPages', () => {
    const result = validateLastReadPage(50, 20);
    expect(result.valid).toBe(false);
  });
});

describe('validateStatus', () => {
  test('accepts "read"', () => {
    expect(validateStatus('read').valid).toBe(true);
  });

  test('rejects unknown status', () => {
    expect(validateStatus('finished').valid).toBe(false);
  });
});

describe('validateScanInterval', () => {
  test('accepts an integer in range', () => {
    expect(validateScanInterval(60).valid).toBe(true);
  });

  test('rejects out-of-range values', () => {
    expect(validateScanInterval(0).valid).toBe(false);
    expect(validateScanInterval(99999).valid).toBe(false);
  });
});

describe('validateComicId', () => {
  test('accepts a 40-char hex string', () => {
    const id = 'a'.repeat(40);
    expect(validateComicId(id).valid).toBe(true);
  });

  test('rejects malformed ids', () => {
    expect(validateComicId('not-a-hash').valid).toBe(false);
  });
});

describe('validateApiKey', () => {
  test('accepts empty key as valid (optional)', () => {
    expect(validateApiKey('').valid).toBe(true);
  });

  test('rejects non-alphanumeric characters', () => {
    expect(validateApiKey('abc-def!').valid).toBe(false);
  });
});

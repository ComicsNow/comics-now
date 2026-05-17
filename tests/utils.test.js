const { pMap } = require('../server/utils');

describe('pMap', () => {
  it('should map items correctly', async () => {
    const items = [1, 2, 3];
    const mapper = async (x) => x * 2;
    const result = await pMap(items, mapper);
    expect(result).toEqual([2, 4, 6]);
  });

  it('should respect concurrency limit', async () => {
    const items = [1, 2, 3, 4, 5];
    let active = 0;
    let maxActive = 0;
    const mapper = async (x) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return x;
    };
    await pMap(items, mapper, 2);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('should handle empty array', async () => {
    const result = await pMap([], async x => x);
    expect(result).toEqual([]);
  });

  it('should handle errors in mapper', async () => {
    const items = [1, 2, 3];
    const mapper = async (x) => {
      if (x === 2) throw new Error('fail');
      return x;
    };
    await expect(pMap(items, mapper)).rejects.toThrow('fail');
  });
});

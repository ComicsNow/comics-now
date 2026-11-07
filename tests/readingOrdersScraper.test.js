/**
 * ReadingOrders.com Scraper & Parser Tests
 */
const {
  parseReadingOrderPage,
  parseCollectedEditionsPage,
  parseIssueTitleAndNumber,
  parseCollectedContents
} = require('../server/services/readingOrdersParser');

describe('ReadingOrders Parser Service', () => {
  describe('parseIssueTitleAndNumber', () => {
    it('correctly extracts series name and single issue number', () => {
      const parsed = parseIssueTitleAndNumber('Civil War: Front Line #5');
      expect(parsed).toEqual({
        seriesName: 'Civil War: Front Line',
        issueNumber: '5'
      });
    });

    it('correctly handles multi-issue spans', () => {
      const parsed = parseIssueTitleAndNumber('Black Panther #19-20');
      expect(parsed).toEqual({
        seriesName: 'Black Panther',
        issueNumber: '19-20'
      });
    });

    it('handles issue titles with one-shots or volume years', () => {
      const parsed = parseIssueTitleAndNumber('Batman: The Killing Joke (1988) #1');
      expect(parsed).toEqual({
        seriesName: 'Batman: The Killing Joke (1988)',
        issueNumber: '1'
      });
    });
  });

  describe('parseCollectedContents', () => {
    it('splits contents string into clean constituent entries', () => {
      const raw = 'Civil War: Battle Damage Report (2007) #1; Civil War Files (2006) #1; Penance: Relentless (2007) #1-5';
      const items = parseCollectedContents(raw);
      expect(items).toEqual([
        { seriesName: 'Civil War: Battle Damage Report (2007)', issueRange: '1' },
        { seriesName: 'Civil War Files (2006)', issueRange: '1' },
        { seriesName: 'Penance: Relentless (2007)', issueRange: '1-5' }
      ]);
    });
  });

  describe('parseReadingOrderPage', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <main>
          <h1>Civil War</h1>
          <p class="description">The landmark Marvel crossover event.</p>
          <div class="rounded-xl border text-card-foreground shadow overflow-hidden p-2 mb-4">
            <div class="flex flex-col lg:flex-row gap-2">
              <img src="/images/issues/4228.png" alt="Cover of Civil War: Front Line #5" />
              <div class="flex-1 p-2">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs font-bold">53</span>
                  <span class="text-xs uppercase text-red-300">Essential</span>
                  <span class="text-xs uppercase">Sep 2006</span>
                </div>
                <h3 class="font-semibold text-xl pb-2">Civil War: Front Line #5</h3>
                <div class="text-muted-foreground text-sm">Embedded: Part 5; Accused: Part 5</div>
                <div>#5 collected in: <span class="text-yellow-100">Civil War: Front Line</span></div>
              </div>
            </div>
          </div>
        </main>
      </body>
      </html>
    `;

    it('extracts structured issue orders from HTML and detects publisher', () => {
      const result = parseReadingOrderPage(sampleHtml, 'civil-war');
      expect(result.slug).toBe('civil-war');
      expect(result.publisher).toBe('Marvel Comics');
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue.position).toBe(53);
      expect(issue.importance).toBe('Essential');
      expect(issue.publicationDate).toBe('Sep 2006');
      expect(issue.seriesName).toBe('Civil War: Front Line');
      expect(issue.issueNumber).toBe('5');
      expect(issue.storyParts).toBe('Embedded: Part 5; Accused: Part 5');
      expect(issue.collectedIn).toBe('Civil War: Front Line');
      expect(issue.coverImageUrl).toBe('https://readingorders.com/images/issues/4228.png');
    });

    it('detects DC Comics for DC story arcs like DC K.O.', () => {
      const dcHtml = `
        <!DOCTYPE html>
        <html>
        <body>
          <a href="/timeline/dc-comic-events">DC Comics Events timeline</a>
          <h1>DC K.O. Reading Order</h1>
          <div class="rounded-xl border">
            <h3>DC All In Special #1</h3>
          </div>
        </body>
        </html>
      `;
      const result = parseReadingOrderPage(dcHtml, 'dc-ko');
      expect(result.publisher).toBe('DC Comics');
      expect(result.title).toBe('DC K.O. Reading Order');
    });
  });

  describe('parseCollectedEditionsPage', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <div class="border bg-card text-card-foreground rounded-lg shadow-sm">
          <div class="p-4">
            <img src="/images/collections/1192.png" alt="Civil War Companion cover" />
            <h3 class="text-xl md:text-2xl font-bold">Civil War</h3>
            <p class="text-xl md:text-2xl text-muted-foreground">Companion</p>
            <div>224 pages</div>
            <div>2007</div>
            <p class="text-sm">A handbook-style guide to Marvel's event.</p>
            <div>
              <h4>Contents:</h4>
              <p>Civil War Files (2006) #1; Daily Bugle (2006) #1</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    it('extracts structured collections from HTML', () => {
      const result = parseCollectedEditionsPage(sampleHtml, 'civil-war');
      expect(result.collections).toHaveLength(1);
      const col = result.collections[0];
      expect(col.title).toBe('Civil War');
      expect(col.subtitle).toBe('Companion');
      expect(col.pageCount).toBe(224);
      expect(col.releaseYear).toBe(2007);
      expect(col.description).toContain('handbook-style guide');
      expect(col.coverImageUrl).toBe('https://readingorders.com/images/collections/1192.png');
      expect(col.parsedContents).toHaveLength(2);
      expect(col.parsedContents[0].seriesName).toBe('Civil War Files (2006)');
    });
  });
});

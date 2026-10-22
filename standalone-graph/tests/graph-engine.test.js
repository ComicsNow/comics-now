const { buildCoOccurrenceGraph, parseListField } = require('../graph-engine');

describe('graph-engine (TDD)', () => {
  describe('parseListField', () => {
    test('handles empty and null values safely', () => {
      expect(parseListField(null)).toEqual([]);
      expect(parseListField(undefined)).toEqual([]);
      expect(parseListField('')).toEqual([]);
      expect(parseListField('   ')).toEqual([]);
    });

    test('splits comma-separated strings and trims whitespace', () => {
      expect(parseListField('Batman, Superman, Wonder Woman')).toEqual(['Batman', 'Superman', 'Wonder Woman']);
      expect(parseListField('Batman,Superman, Wonder Woman ')).toEqual(['Batman', 'Superman', 'Wonder Woman']);
    });

    test('deduplicates entities in the same issue', () => {
      expect(parseListField('Batman, Robin, Batman')).toEqual(['Batman', 'Robin']);
    });
  });

  describe('buildCoOccurrenceGraph', () => {
    const sampleComics = [
      {
        id: 'c1',
        name: 'World\'s Finest #1',
        series: 'World\'s Finest',
        publisher: 'DC Comics',
        metadata: JSON.stringify({
          Characters: 'Batman, Superman, Robin',
          Teams: 'Justice League',
          Year: '2024'
        })
      },
      {
        id: 'c2',
        name: 'World\'s Finest #2',
        series: 'World\'s Finest',
        publisher: 'DC Comics',
        metadata: JSON.stringify({
          Characters: 'Batman, Superman',
          Teams: 'Justice League',
          Year: '2024'
        })
      },
      {
        id: 'c3',
        name: 'Detective Comics #1000',
        series: 'Detective Comics',
        publisher: 'DC Comics',
        metadata: JSON.stringify({
          Characters: 'Batman, Joker',
          Year: '2024'
        })
      },
      {
        id: 'c4',
        name: 'Spawn #1',
        series: 'Spawn',
        publisher: 'Image Comics',
        metadata: JSON.stringify({
          Characters: 'Spawn',
          Year: '1992'
        })
      }
    ];

    test('builds nodes for characters with appearance counts and series appearances', () => {
      const graph = buildCoOccurrenceGraph(sampleComics, { entityType: 'characters' });
      expect(graph.nodes).toBeDefined();

      const batman = graph.nodes.find(n => n.id === 'Batman');
      expect(batman).toBeDefined();
      expect(batman.appearances).toBe(3);
      expect(batman.series).toContain('World\'s Finest');
      expect(batman.series).toContain('Detective Comics');

      const superman = graph.nodes.find(n => n.id === 'Superman');
      expect(superman).toBeDefined();
      expect(superman.appearances).toBe(2);

      const spawn = graph.nodes.find(n => n.id === 'Spawn');
      expect(spawn).toBeDefined();
      expect(spawn.appearances).toBe(1);
    });

    test('builds co-occurrence links with weights and comic references', () => {
      const graph = buildCoOccurrenceGraph(sampleComics, { entityType: 'characters' });
      expect(graph.links).toBeDefined();

      // Batman and Superman co-occur in c1 and c2 => weight 2
      const batSup = graph.links.find(
        l => (l.source === 'Batman' && l.target === 'Superman') ||
             (l.source === 'Superman' && l.target === 'Batman')
      );
      expect(batSup).toBeDefined();
      expect(batSup.weight).toBe(2);
      expect(batSup.comics).toContain('c1');
      expect(batSup.comics).toContain('c2');

      // Batman and Joker co-occur in c3 => weight 1
      const batJoker = graph.links.find(
        l => (l.source === 'Batman' && l.target === 'Joker') ||
             (l.source === 'Joker' && l.target === 'Batman')
      );
      expect(batJoker).toBeDefined();
      expect(batJoker.weight).toBe(1);
    });

    test('filters by publisher if specified', () => {
      const graph = buildCoOccurrenceGraph(sampleComics, { entityType: 'characters', publisher: 'DC Comics' });
      expect(graph.nodes.some(n => n.id === 'Spawn')).toBe(false);
      expect(graph.nodes.some(n => n.id === 'Batman')).toBe(true);
    });

    test('filters by minAppearances', () => {
      const graph = buildCoOccurrenceGraph(sampleComics, { entityType: 'characters', minAppearances: 2 });
      // Batman (3) and Superman (2) should be present, Spawn (1), Joker (1), Robin (1) should not
      expect(graph.nodes.some(n => n.id === 'Batman')).toBe(true);
      expect(graph.nodes.some(n => n.id === 'Superman')).toBe(true);
      expect(graph.nodes.some(n => n.id === 'Robin')).toBe(false);
      expect(graph.nodes.some(n => n.id === 'Joker')).toBe(false);
    });

    test('supports teams co-occurrence graph', () => {
      const graph = buildCoOccurrenceGraph(sampleComics, { entityType: 'teams' });
      const jl = graph.nodes.find(n => n.id === 'Justice League');
      expect(jl).toBeDefined();
      expect(jl.appearances).toBe(2);
    });
  });
});

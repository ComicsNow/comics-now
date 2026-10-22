/**
 * Standalone Character & Event Co-Occurrence Server
 * Runs on Port 3021
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const { buildCoOccurrenceGraph, parseListField } = require('./graph-engine');

const DB_PATH = process.env.COMICS_DB_PATH || path.join(__dirname, '../comics-now.db');

function createApp(options = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static UI assets from public folder
  app.use(express.static(path.join(__dirname, 'public')));

  let db = options.db;
  if (!db) {
    try {
      db = new Database(DB_PATH, { readonly: true });
    } catch (err) {
      console.warn('[Standalone Graph] Warning: Unable to open database at', DB_PATH, err.message);
    }
  }

  function getAllComics() {
    if (!db) return [];
    try {
      return db.prepare('SELECT id, publisher, series, name, metadata FROM comics WHERE metadata IS NOT NULL').all();
    } catch (e) {
      console.error('[Standalone Graph] Query failed:', e);
      return [];
    }
  }

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, port: 3021, timestamp: new Date().toISOString() });
  });

  // Get distinct publishers for dropdown
  app.get('/api/publishers', (req, res) => {
    try {
      const comics = getAllComics();
      const publishers = new Set();
      for (const c of comics) {
        if (c.publisher && c.publisher.trim()) {
          publishers.add(c.publisher.trim());
        }
      }
      res.json({
        ok: true,
        publishers: Array.from(publishers).sort((a, b) => a.localeCompare(b))
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Get Graph data with filters
  app.get('/api/graph', (req, res) => {
    try {
      const entityType = req.query.entityType || 'characters';
      const publisher = req.query.publisher || null;
      const series = req.query.series || null;
      const minAppearances = parseInt(req.query.minAppearances, 10) || 2;
      const minWeight = parseInt(req.query.minWeight, 10) || 1;
      const maxNodes = parseInt(req.query.maxNodes, 10) || 120;

      const comics = getAllComics();
      const graph = buildCoOccurrenceGraph(comics, {
        entityType,
        publisher,
        series,
        minAppearances,
        minWeight,
        maxNodes
      });

      res.json({
        ok: true,
        nodes: graph.nodes,
        links: graph.links,
        meta: graph.meta
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Get detail for a specific entity
  app.get('/api/entity/:name/details', (req, res) => {
    try {
      const targetName = decodeURIComponent(req.params.name);
      const entityType = req.query.entityType || 'characters';
      const comics = getAllComics();

      const graph = buildCoOccurrenceGraph(comics, {
        entityType,
        minAppearances: 1,
        minWeight: 1,
        maxNodes: 5000
      });

      const node = graph.nodes.find(n => n.id.toLowerCase() === targetName.toLowerCase());
      if (!node) {
        return res.status(404).json({ ok: false, error: 'Entity not found' });
      }

      // Find all connected entities
      const connected = [];
      for (const link of graph.links) {
        if (link.source.toLowerCase() === node.id.toLowerCase()) {
          connected.push({
            target: link.target,
            weight: link.weight,
            comics: link.comics
          });
        } else if (link.target.toLowerCase() === node.id.toLowerCase()) {
          connected.push({
            target: link.source,
            weight: link.weight,
            comics: link.comics
          });
        }
      }

      connected.sort((a, b) => b.weight - a.weight);

      res.json({
        ok: true,
        entity: node,
        connectedEntities: connected
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3021;
  const app = createApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Interactive Character & Event Graph] Running on http://127.0.0.1:${PORT}`);
  });
}

module.exports = { createApp };

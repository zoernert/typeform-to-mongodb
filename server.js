#!/usr/bin/env node
'use strict';

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'typeform';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'answers';
const MONGODB_COLLECTION_FORMS = process.env.MONGODB_COLLECTION_FORMS || 'forms';

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());

let client; let db; let answers; let forms;

async function init() {
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB);
  answers = db.collection(MONGODB_COLLECTION);
  forms = db.collection(MONGODB_COLLECTION_FORMS);
  // Read-only guard: no write routes
}

// REST API (read-only)
// GET /api/forms?q=
app.get('/api/forms', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const filter = q ? { $or: [
      { form_id: { $regex: q, $options: 'i' } },
      { title: { $regex: q, $options: 'i' } },
    ] } : {};
    const items = await forms.find(filter).project({ _id: 0 }).limit(100).toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/forms/:formId/responses
app.get('/api/forms/:formId/responses', async (req, res) => {
  try {
    const formId = req.params.formId;
    const cursor = answers.aggregate([
      { $match: { form_id: formId } },
      { $group: { _id: '$response_id', count: { $sum: 1 }, email: { $first: '$email' }, chiffre: { $first: '$chiffre' }, datum: { $first: '$datum' } } },
      { $project: { _id: 0, response_id: '$_id', count: 1, email: 1, chiffre: 1, datum: 1 } },
      { $sort: { datum: -1 } },
      { $limit: 200 }
    ]);
    const items = await cursor.toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/responses/:responseId (full response: all answers)
app.get('/api/responses/:responseId', async (req, res) => {
  try {
    const responseId = req.params.responseId;
    const items = await answers.find({ response_id: responseId }).project({ _id: 0 }).sort({ idx: 1 }).toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/chiffre/:chiffre (all responses with the same chiffre)
app.get('/api/chiffre/:chiffre', async (req, res) => {
  try {
    const chiffre = req.params.chiffre;
    const items = await answers.aggregate([
      { $match: { chiffre } },
      { $group: { _id: { form_id: '$form_id', response_id: '$response_id' }, email: { $first: '$email' }, datum: { $first: '$datum' } } },
      { $project: { _id: 0, form_id: '$_id.form_id', response_id: '$_id.response_id', email: 1, datum: 1 } },
      { $sort: { datum: -1 } },
      { $limit: 200 }
    ]).toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/search?q= (search by form_id, chiffre, email)
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ items: [] });
    const items = await answers.aggregate([
      { $match: { $or: [
        { form_id: { $regex: q, $options: 'i' } },
        { chiffre: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ] } },
      { $group: { _id: { form_id: '$form_id', response_id: '$response_id' }, chiffre: { $first: '$chiffre' }, email: { $first: '$email' }, datum: { $first: '$datum' } } },
      { $project: { _id: 0, form_id: '$_id.form_id', response_id: '$_id.response_id', chiffre: 1, email: 1, datum: 1 } },
      { $sort: { datum: -1 } },
      { $limit: 200 }
    ]).toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/chiffres?limit=200 — overview of all chiffres
app.get('/api/chiffres', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 200, 2000));
    const items = await answers.aggregate([
      { $match: { chiffre: { $ne: null, $ne: '' } } },
      { $group: { _id: '$chiffre', responses: { $addToSet: '$response_id' }, forms: { $addToSet: '$form_id' }, latest: { $max: '$datum' }, earliest: { $min: '$datum' } } },
      { $project: { _id: 0, chiffre: '$_id', responsesCount: { $size: '$responses' }, formsCount: { $size: '$forms' }, latest: 1, earliest: 1 } },
      { $sort: { latest: -1 } },
      { $limit: limit }
    ]).toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GET /api/answers/related?form_id=...&field_id=...&exclude_response_id=... (for showing "what others answered")
app.get('/api/answers/related', async (req, res) => {
  try {
    const form_id = req.query.form_id?.toString();
    const field_id = req.query.field_id?.toString();
    const exclude = req.query.exclude_response_id?.toString();
    if (!form_id || !field_id) return res.json({ items: [] });

    const match = { form_id, field_id };
    if (exclude) match.response_id = { $ne: exclude };

    const items = await answers.aggregate([
      { $match: match },
      { $group: { _id: '$antwort', count: { $sum: 1 } } },
      { $project: { _id: 0, antwort: '$_id', count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]).toArray();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Static frontend
app.use('/', express.static(path.join(__dirname, 'web')));

init().then(() => {
  app.listen(PORT, () => {
    console.log(`Web server listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

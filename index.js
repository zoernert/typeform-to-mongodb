#!/usr/bin/env node
'use strict';

// Node.js script to fetch all Typeform forms, their fields, and responses, and upsert one MongoDB document per answer.
// Requirements are described in PLAN.md.

const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// ---- Config via .env ----
// TYPEFORM_TOKEN=... (personal access token)
// MONGODB_URI=mongodb+srv://... or mongodb://...
// MONGODB_DB=yourDb
// MONGODB_COLLECTION=yourCollection

const TYPEFORM_BASE = 'https://api.typeform.com';
const TYPEFORM_TOKEN = process.env.TYPEFORM_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'typeform';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'answers';
const MONGODB_COLLECTION_FORMS = process.env.MONGODB_COLLECTION_FORMS || null;

// Optional limits/filters for safer test runs
// Environment variables or CLI flags:
//  - FORMS_LIMIT or --max-forms=N
//  - RESPONSES_LIMIT or --max-responses=N
//  - FORM_IDS (comma-separated) or --form-ids=a,b,c
//  - DRY_RUN=true or --dry-run

function getArg(name) {
  // supports --name=value and --name value
  const idx = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const entry = process.argv[idx];
  if (entry.includes('=')) return entry.split('=').slice(1).join('=');
  return process.argv[idx + 1];
}

function toInt(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

const FORMS_LIMIT = toInt(process.env.FORMS_LIMIT ?? getArg('max-forms'), Infinity);
const RESPONSES_LIMIT = toInt(process.env.RESPONSES_LIMIT ?? getArg('max-responses'), Infinity);
const FORM_IDS = (process.env.FORM_IDS ?? getArg('form-ids'))
  ? String(process.env.FORM_IDS ?? getArg('form-ids')).split(',').map(s => s.trim()).filter(Boolean)
  : null;
const DRY_RUN = (() => {
  const flagPresent = process.argv.includes('--dry-run');
  const v = (process.env.DRY_RUN ?? getArg('dry-run'));
  if (flagPresent) return true;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
})();
const DRY_RUN_ALL = process.argv.includes('--dry-run-all') || /^(1|true|yes|on)$/i.test(String(process.env.DRY_RUN_ALL || ''));
const DRY_RUN_PREVIEW = toInt(process.env.DRY_RUN_PREVIEW ?? getArg('dry-run-preview'), 3);
const WRITE_MODE = (() => {
  const v = (process.env.WRITE_MODE ?? getArg('write-mode')) || 'bulk';
  const s = String(v).trim().toLowerCase();
  return s === 'single' ? 'single' : 'bulk';
})();

if (!TYPEFORM_TOKEN) {
  console.error('Missing TYPEFORM_TOKEN in .env');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

const http = axios.create({
  baseURL: TYPEFORM_BASE,
  headers: {
    Authorization: `Bearer ${TYPEFORM_TOKEN}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000,
});

const CHIFFRE_REGEX = /^\d{5}[A-Za-z]{1}\d{8}$/;

function formatDate(dateStr) {
  // Typeform's "submitted_at" is ISO datetime. We want YYYY-MM-DD
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

async function fetchAllForms() {
  // Handles pagination using page and total/page_count
  let page = 1;
  const forms = [];
  while (true) {
    const res = await http.get(`/forms`, { params: { page } });
    const data = res.data || {};
    const items = data.items || [];
  forms.push(...items.map(i => ({ id: i.id, title: i.title })));
    const pageCount = data.page_count || 1;
    if (forms.length >= FORMS_LIMIT) {
      return forms.slice(0, FORMS_LIMIT);
    }
    if (page >= pageCount) break;
    page += 1;
  }
  return forms; // [{id}]
}

async function fetchFormDefinition(formId) {
  const res = await http.get(`/forms/${formId}`);
  const data = res.data || {};
  // Build a map field_id -> { title, choicesByIdOrValue(optional) }
  const fields = data.fields || [];
  const fieldMap = new Map();
  for (const f of fields) {
    const entry = { title: f.title, id: f.id, type: f.type };

    // Handle multiple choice label mapping
    // Typeform field for choices: f.properties.choices = [{ id?, label }, ...]
    if (f.type === 'multiple_choice' && f.properties && Array.isArray(f.properties.choices)) {
      const labelById = new Map();
      const labelByValue = new Map();
      for (const c of f.properties.choices) {
        if (c.id) labelById.set(c.id, c.label);
        if (c.label) labelByValue.set(c.label, c.label); // fallback mapping
      }
      entry.choices = { byId: labelById, byValue: labelByValue };
    }

    // Dropdown or other choice-like types
    if (f.type === 'dropdown' && f.properties && Array.isArray(f.properties.choices)) {
      const labelById = new Map();
      const labelByValue = new Map();
      for (const c of f.properties.choices) {
        if (c.id) labelById.set(c.id, c.label);
        if (c.label) labelByValue.set(c.label, c.label);
      }
      entry.choices = { byId: labelById, byValue: labelByValue };
    }

    fieldMap.set(f.id, entry);
  }
  return fieldMap; // Map(field_id -> {title, id, type, choices?})
}

async function fetchAllResponses(formId) {
  let page = 1;
  const all = [];
  while (true) {
    const res = await http.get(`/forms/${formId}/responses`, { params: { page } });
    const data = res.data || {};
    const items = data.items || [];
    all.push(...items);
    const pageCount = data.page_count || 1;
    if (all.length >= RESPONSES_LIMIT) {
      return all.slice(0, RESPONSES_LIMIT);
    }
    if (page >= pageCount) break;
    page += 1;
  }
  return all; // raw response items
}

function extractEmailAndChiffre(answers) {
  let email = null;
  let chiffre = null;
  const list = Array.isArray(answers) ? answers : [];

  for (const ans of list) {
    // Common Typeform answer shapes: email, text, choice, choices, boolean, date, file_url, number
    if (!email && ans.type === 'email' && ans.email) {
      email = ans.email;
    }

    // Check text-like values for chiffre pattern
    const candidates = [];
    if (ans.text) candidates.push(ans.text);
    if (ans.email) candidates.push(ans.email);
    if (ans.number != null) candidates.push(String(ans.number));
    if (ans.date) candidates.push(ans.date);
    if (ans.choice && ans.choice.label) candidates.push(ans.choice.label);
    if (ans.choices && Array.isArray(ans.choices.labels)) candidates.push(...ans.choices.labels);

    for (const c of candidates) {
      if (typeof c === 'string' && CHIFFRE_REGEX.test(c)) {
        chiffre = c;
        break;
      }
    }

    if (chiffre) break;
  }

  return { email, chiffre };
}

function answerValueToLabel(ans, fieldMeta) {
  // Convert answer to human-readable label when multiple choice, else keep the textual value
  if (!ans) return null;
  const t = ans.type || fieldMeta?.type;

  // direct text/email/number/date
  if (ans.text != null) return ans.text;
  if (ans.email != null) return ans.email;
  if (ans.number != null) return String(ans.number);
  if (ans.date != null) return ans.date;
  if (ans.boolean != null) return String(ans.boolean);
  if (ans.url != null) return ans.url;

  // Multiple choice single
  if (ans.choice) {
    const label = ans.choice.label
      || (fieldMeta?.choices?.byId?.get(ans.choice.id))
      || (ans.choice.other)
      || null;
    return label;
  }
  // Multiple choice multiple
  if (ans.choices && Array.isArray(ans.choices.labels)) {
    return ans.choices.labels.join(', ');
  }

  // file_url or other
  if (ans.file_url) return ans.file_url;

  return null;
}

function buildAnswerDocs(formId, fieldMap, responseItem) {
  const list = Array.isArray(responseItem?.answers) ? responseItem.answers : [];
  const rid = responseItem?.response_id ?? responseItem?.token ?? null;
  const submitted = responseItem?.submitted_at ?? responseItem?.landed_at ?? null;
  const { email, chiffre } = extractEmailAndChiffre(list);
  const datum = formatDate(submitted);
  const docs = [];
  let idx = 0;

  for (const ans of list) {
  const fieldId = ans.field?.id || ans.field_id || ans.field || null; // safeguard across shapes
    const fieldMeta = fieldId ? fieldMap.get(fieldId) : undefined;
    const frage = fieldMeta?.title || null;
    const antwort = answerValueToLabel(ans, fieldMeta);

    const doc = {
      id: `${formId}_${chiffre || email}_${rid}_${email}`,
      antwort: antwort ?? null,
      chiffre: chiffre ?? null,
      datum: datum,
      email: email ?? null,
      field_id: fieldId ?? null,
      form_id: formId,
      frage: frage,
      idx: idx,
      response_id: rid,
    };

    docs.push(doc);
    idx += 1;
  }

  return docs;
}

async function upsertDocs(collection, docs) {
  if (!docs.length) return { upserted: 0, matched: 0, modified: 0 };
  if (WRITE_MODE === 'single') {
    let upserted = 0, matched = 0, modified = 0;
    for (const d of docs) {
      const filter = { id: d.id, idx: d.idx };
      const res = await collection.updateOne(filter, { $set: d }, { upsert: true, writeConcern: { w: 1 } });
      // In modern driver, res.upsertedCount may not exist, but upsertedId is set when an upsert happened
      if (res.upsertedCount === 1 || res.upsertedId) upserted += 1;
      matched += res.matchedCount ?? 0;
      modified += res.modifiedCount ?? 0;
    }
    return { upserted, matched, modified };
  } else {
    const ops = docs.map(d => ({
      updateOne: {
        filter: { id: d.id, idx: d.idx },
        update: { $set: d },
        upsert: true,
      }
    }));
    try {
      const res = await collection.bulkWrite(ops, { ordered: false, writeConcern: { w: 1 } });
      // Prefer explicit counters when present
      const upsertedCount = res.upsertedCount ?? res.result?.nUpserted ?? undefined;
      let upserted;
      if (typeof upsertedCount === 'number') {
        upserted = upsertedCount;
      } else {
        const upsertedIds = res.upsertedIds || {};
        upserted = Array.isArray(upsertedIds)
          ? upsertedIds.filter(x => x != null).length
          : Object.keys(upsertedIds).length;
      }
      const matched = res.matchedCount ?? res.result?.nMatched ?? 0;
      const modified = res.modifiedCount ?? res.result?.nModified ?? 0;
      return { upserted, matched, modified };
    } catch (e) {
      console.error('bulkWrite error:', e?.code, e?.message || e);
      throw e;
    }
  }
}

function buildFormDocs(forms) {
  return forms.map(f => ({ form_id: f.id, title: f.title ?? null }));
}

async function upsertForms(collection, docs) {
  if (!docs?.length) return { upserted: 0, matched: 0, modified: 0 };
  if (WRITE_MODE === 'single') {
    let upserted = 0, matched = 0, modified = 0;
    for (const d of docs) {
      const filter = { form_id: d.form_id };
      const res = await collection.updateOne(filter, { $set: d }, { upsert: true, writeConcern: { w: 1 } });
      if (res.upsertedCount === 1 || res.upsertedId) upserted += 1;
      matched += res.matchedCount ?? 0;
      modified += res.modifiedCount ?? 0;
    }
    return { upserted, matched, modified };
  } else {
    const ops = docs.map(d => ({
      updateOne: { filter: { form_id: d.form_id }, update: { $set: d }, upsert: true }
    }));
    const res = await collection.bulkWrite(ops, { ordered: false, writeConcern: { w: 1 } });
    const upserted = typeof res.upsertedCount === 'number'
      ? res.upsertedCount
      : Object.keys(res.upsertedIds || {}).length;
    const matched = res.matchedCount ?? res.result?.nMatched ?? 0;
    const modified = res.modifiedCount ?? res.result?.nModified ?? 0;
    return { upserted, matched, modified };
  }
}

async function main() {
  let client = null;
  let collection = null;
  let formsCollection = null;
  if (!DRY_RUN) {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(MONGODB_DB);
    collection = db.collection(MONGODB_COLLECTION);
    console.log(`Connected. DB=${MONGODB_DB} Collection=${MONGODB_COLLECTION}`);
    try {
      await collection.createIndex({ id: 1, idx: 1 }, { unique: true, name: 'uniq_id_idx' });
      console.log('Ensured unique index on {id, idx}.');
    } catch (e) {
      console.warn('Index creation warning:', e?.message || e);
    }
    if (MONGODB_COLLECTION_FORMS) {
      formsCollection = db.collection(MONGODB_COLLECTION_FORMS);
      console.log(`Forms collection: ${MONGODB_COLLECTION_FORMS}`);
      try {
        await formsCollection.createIndex({ form_id: 1 }, { unique: true, name: 'uniq_form_id' });
        console.log('Ensured unique index on {form_id} in forms collection.');
      } catch (e) {
        console.warn('Forms index creation warning:', e?.message || e);
      }
    }
  } else {
    console.log('DRY_RUN enabled: will not write to MongoDB.');
  }

  try {
    console.log('Fetching forms...');
    const forms = FORM_IDS ? FORM_IDS.map(id => ({ id, title: undefined })) : await fetchAllForms();
    console.log(`Found ${forms.length} forms${Number.isFinite(FORMS_LIMIT) ? ` (limit ${FORMS_LIMIT})` : ''}.`);
    // First step: upsert forms (form_id + title)
    try {
      const formDocs = buildFormDocs(forms);
      if (DRY_RUN) {
        const show = DRY_RUN_ALL ? formDocs : formDocs.slice(0, DRY_RUN_PREVIEW);
        for (const d of show) {
          const filter = { form_id: d.form_id };
          const update = { $set: d };
          console.log('DRY_RUN upsert FORM:', { filter, update, upsert: true });
        }
        if (!DRY_RUN_ALL && formDocs.length > DRY_RUN_PREVIEW) {
          console.log(`   ... and ${formDocs.length - DRY_RUN_PREVIEW} more form ops suppressed (use --dry-run-all or increase DRY_RUN_PREVIEW).`);
        }
      } else if (formsCollection) {
        const res = await upsertForms(formsCollection, formDocs);
        console.log(`Upserted forms: ${res.upserted}, matched ${res.matched}, modified ${res.modified}.`);
      } else {
        console.log('Forms collection not configured (MONGODB_COLLECTION_FORMS not set) — skipping form upserts.');
      }
    } catch (e) {
      console.warn('Form upserts failed:', e?.message || e);
    }
    let grandTotalDocs = 0;
    let grandTotalUpserts = 0;

    for (const { id: formId } of forms) {
      console.log(`Processing form ${formId}...`);
      const fieldMap = await fetchFormDefinition(formId);
      const responses = await fetchAllResponses(formId);
      console.log(` - ${responses.length} responses${Number.isFinite(RESPONSES_LIMIT) ? ` (limit ${RESPONSES_LIMIT})` : ''}.`);
      let formDocs = 0;
  let formUpserts = 0;
  let formMatched = 0;
  let formModified = 0;

  for (const resp of responses) {
        const docs = buildAnswerDocs(formId, fieldMap, resp);
        if (!docs.length) {
          const rid = resp?.response_id ?? resp?.token ?? 'unknown';
          console.warn(`   ! Response ${rid} has no answers; skipping.`);
        }
        if (DRY_RUN) {
          // Print a preview of the exact upsert operations
          const show = DRY_RUN_ALL ? docs : docs.slice(0, DRY_RUN_PREVIEW);
          for (const d of show) {
            const filter = { id: d.id, idx: d.idx };
            const update = { $set: d };
            console.log('DRY_RUN upsert:', { filter, update, upsert: true });
          }
          if (!DRY_RUN_ALL && docs.length > DRY_RUN_PREVIEW) {
            console.log(`   ... and ${docs.length - DRY_RUN_PREVIEW} more ops suppressed (use --dry-run-all or increase DRY_RUN_PREVIEW).`);
          }
        } else {
          const result = await upsertDocs(collection, docs);
          formUpserts += result?.upserted ?? 0;
          formMatched += result?.matched ?? 0;
          formModified += result?.modified ?? 0;
          // Verify one sample doc exists after write
          if (docs[0]) {
            const sample = await collection.findOne({ id: docs[0].id, idx: docs[0].idx });
            if (!sample) {
              console.warn('   ! Post-write verification failed for sample doc:', { id: docs[0].id, idx: docs[0].idx });
            }
          }
        }
        formDocs += docs.length;
      }
      grandTotalDocs += formDocs;
      grandTotalUpserts += formUpserts;
      if (!DRY_RUN) {
        try {
          const count = await collection.countDocuments({ form_id: formId });
          console.log(` - Form ${formId}: built ${formDocs} docs, upserted ${formUpserts}, matched ${formMatched}, modified ${formModified}, collection now has ${count} docs for this form.`);
        } catch (e) {
          console.log(` - Form ${formId}: built ${formDocs} docs, upserted ${formUpserts}, matched ${formMatched}, modified ${formModified}.`);
        }
      } else {
        console.log(` - Form ${formId}: built ${formDocs} docs.`);
      }
    }

    console.log(`Done. Built ${grandTotalDocs} docs in total${DRY_RUN ? '' : `, upserted ${grandTotalUpserts}`}.`);
  } finally {
    if (client) await client.close();
  }
}

main().catch(err => {
  console.error(err?.response?.data || err);
  process.exit(1);
});

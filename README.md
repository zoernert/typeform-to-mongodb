# Typeform to MongoDB

Imports all answers from all Typeform forms into a MongoDB collection (one document per answer).

## Environment
Create a `.env` file in the project root:

```
TYPEFORM_TOKEN=your_typeform_token
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=typeform
MONGODB_COLLECTION=answers
# Optional forms meta collection
MONGODB_COLLECTION_FORMS=forms
```

## Install & Run

```
npm install
npm start
```

## Web frontend (Read-Only)
Browse data from both collections with a simple UI.

```
npm run web
# open http://localhost:3000
```

Config via .env (optional):
- PORT=3000
- HOST=0.0.0.0  (or BIND_ADDR=0.0.0.0)

Features:
- Forms list (search by title or form_id)
- Responses per form (shows “Form title — Chiffre”)
- Response details (all answers). For each question: “Andere Antworten” opens a modal that shows the original answer highlighted at the top and the distribution of other answers for the same field.
- Chiffres overview: list of all chiffrés with counts; click to see their responses
- Global search: form_id, chiffre, email

Endpoints (GET only):
- /api/forms?q=
- /api/forms/:formId/responses
- /api/responses/:responseId
- /api/chiffre/:chiffre
- /api/chiffres?limit=200
- /api/search?q=

## Test with a small batch
Use limits and dry-run to validate without writing to MongoDB:

Environment variables (examples):

```
# limit to first 1 form and first 5 responses per form
FORMS_LIMIT=1
RESPONSES_LIMIT=5

# only process these form IDs
FORM_IDS=o4Sdlq5K

# preview only, do not write to MongoDB
DRY_RUN=true
```

You can also pass CLI flags instead (override env):

```
npm start -- --max-forms=1 --max-responses=5 --form-ids=o4Sdlq5K --dry-run
```

Advanced dry-run preview:

```
# show exact upsert ops for the first 10 docs per response
DRY_RUN_PREVIEW=10 npm start -- --form-ids=o4Sdlq5K --max-responses=1 --dry-run

# show all upsert ops (careful: lots of output)
npm start -- --form-ids=o4Sdlq5K --max-responses=1 --dry-run --dry-run-all
```

## Notes
- Pagination is handled via `page` and `page_count` for both forms and responses.
- Each answer becomes one document with fields: id, antwort, chiffre, datum, email, field_id, form_id, frage, idx, response_id.
- Multiple choice values are converted to labels when available.
- Upserts are done by `{ id, idx }`.

## Troubleshooting
- Upserted 0: Documents may already exist. Check matched/modified counters. If all zero, try:
	- Use `--write-mode=single` to bypass bulk write and see per-doc upsert behavior.
	- Ensure your MongoDB user has write access and the URI targets a writable primary (avoid forcing `readPreference=secondaryPreferred`).
	- Confirm `MONGODB_DB` and `MONGODB_COLLECTION` are correct.
- Preview without writes: use `--dry-run` (see above).

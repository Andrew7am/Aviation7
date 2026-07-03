# Supabase migration — Luxury Explorers Aviation ERP

This folder is the seed of the Supabase side of the ERP. It carries the canonical
Aviation seed workbook (`Aviation 1 (2).xlsx`) into Postgres exactly as it was —
one raw table per vendor, columns matching that vendor's report format
verbatim. Reports and the reconciled ticket layer are built on top of these
tables later.

## Layout

```
supabase/
├── migrations/         numbered SQL migrations, apply in order
├── seed_data/          one CSV per vendor, extracted from the seed workbook
├── seed.sql            \copy loader for psql (fastest path)
└── README.md           this file
```

## Vendors and row counts (from the seed workbook)

| Vendor          | Sheet          | Rows |
| --------------- | -------------- | ---- |
| iata            | IATA           | 1568 |
| flydubai        | FLYDubai       | 27   |
| flyadeal_dxb    | FlyAdeal DXB   | 90   |
| flyadeal_ksa   | FlyAdeal KSA   | 4    |
| airarabia       | Air Arabia     | 18   |
| flynas          | FlyNas         | 19   |
| rts_ibtekar     | RTS IBTKAR     | 8    |
| ibtekar         | ibtekar        | 265  |
| rts_dxb         | RTS DXB        | 249  |
| nsa             | NSA            | 2785 |
| goldmedal       | goldmedal      | 6    |
| **total**       |                | **5039** |

## Schema shape

Every vendor gets its own `<vendor>_rows` table, with **text** columns matching
the sheet's headers 1:1 (snake_case in SQL, verbatim original label preserved in
`vendor_columns`). Everything is `text` on purpose — the raw seed layer is not
allowed to change values. Typed views and the reconciled tickets layer sit on
top of it later.

- `vendors` — one row per vendor, display name + sheet name + seed row count
- `vendor_columns` — verbatim column labels per vendor (ordinal, sql_name, original)
- `vendor_imports` — provenance: every seed or re-import writes a row here
- `<vendor>_rows` — the actual rows, tagged with `vendor_import_id` and
  `source_row_num` (Excel row number)

## Running it

### 1. Apply the migrations

Point the Supabase CLI (or any psql session) at the target project:

```bash
supabase db push                  # if you use the Supabase CLI
# or
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/0001_core_schema.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f migrations/0002_iata_rows.sql
# ... etc, 0003..0012
```

### 2. Load the seed data — pick one

**Option A: psql `\copy` (fastest, ~5s for all 5k rows)**

```bash
cd supabase
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f seed.sql
```

`seed.sql` is idempotent: it wipes each `<vendor>_rows` table before reloading,
and creates a new `vendor_imports` row per vendor so provenance is preserved.

**Option B: TypeScript over the REST API (no psql needed)**

```bash
export SUPABASE_URL=https://<your-project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role_secret>
npx tsx ../scripts/seed-supabase.ts
```

Use the service-role key, not the anon key — the raw seed tables are RLS-off by
default and only server-side / trusted contexts should write to them.

## Rules for the raw seed

- Text-only. No numeric parsing at this layer — that belongs to the reports layer.
- Row counts must match the sheet exactly. If a re-import changes a count, either
  the workbook changed or the CSV export drifted; investigate before committing.
- Column labels in the workbook are the source of truth. `vendor_columns.original`
  preserves them verbatim including trailing spaces and quirky casing like
  `Balamce` (FlyAdeal KSA) or `0utstanding balances` (NSA) — do not "fix" them.

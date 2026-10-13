# Scale report (Phase 5)

How the dashboard behaves at 1k, 10k, 50k and 100k responses, what was slow, what was changed, and the final measurements.

**Targets**: `dashboard_bundle` p95 < 400 ms at 10k responses and < 1 s at 100k. **Result: met** — p95 98 ms at 10k and 227 ms at 100k (default dashboard, through the API, as a signed-in admin).

## Setup

- Machine: Windows 11 laptop, Supabase local stack on Docker Desktop (Postgres 17.11), Node 24. Hosted Supabase on dedicated hardware should be equal or faster; repeat on staging before launch.
- Data: the "Scale test (Demo)" form (14 questions: text, email, phone, date, 3 numbers, rating, 0–10 scale, checkboxes, dropdown, 2 paragraphs, yes/no; 2 conditional questions), filled by `generate_demo_responses` over 90 days. 100k responses = 1,075,678 answer rows; the summaries hold 124,744 (`answer_summary`) and 7,644 (`response_summary`) rows for that form.
- Method: `pnpm bench:dashboard` (`scripts/bench-dashboard.ts`). It grows the form to each size (generator in chunks of 500, then `ANALYZE` and a 30 s pause so autovacuum does not overlap), signs in as `admin@formpulse.test` and calls every RPC through PostgREST (HTTP + JWT + permission checks included): 3 warm-ups, then 20 timed runs; p95 = nearest rank of 20.
- Filters used: "last 30 days" = 30 Asia/Jakarta calendar days (the dashboard preset); "answer filter" = one dropdown option (≈ 20% of responses).

## Before (Phase 4 code, 100k responses, measured in psql)

| Call                               | Time                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `dashboard_bundle` (no filters)    | 4.6–5.7 s                                                                        |
| `dashboard_overview` alone         | 0.66 s                                                                           |
| `cross_suggestions`                | 13.2 s                                                                           |
| `cross_stats` (one pair)           | 0.6–1.4 s                                                                        |
| `question_stats` (one question)    | 0.31 s                                                                           |
| `list_responses` (first page)      | 0.49 s                                                                           |
| `dashboard_bundle` (answer filter) | 5.7 s at 50k; > 8 s (API timeout) at 100k                                        |
| `generate_demo_responses(100000)`  | 124 s, and > 10 min in one call once conditional questions had ~50k visible rows |

At 10k the Phase 4 bundle took 380–410 ms locally — already at the target's edge.

### Why (EXPLAIN ANALYZE, Phase 4 code at 100k)

The default dashboard reads every answer of the form. The overview alone scanned the filtered response set several times through a non-inlinable function (`_dashboard_responses` has `SET search_path`), ~70–130 ms per scan:

```
Result (actual time=614.473..614.501 rows=1)
  ->  Function Scan on _dashboard_responses (actual time=68.044..75.821 rows=100000)
  ->  Function Scan on _dashboard_responses _dashboard_responses_1 (actual time=73.045..81.943 rows=100000)
  ->  Aggregate (actual time=135.753..135.755 rows=1)
        ->  Hash Join (actual time=73.110..135.409 rows=3230)
              ->  CTE Scan on nodates (actual time=73.047..102.809 rows=100000)
```

The question statistics aggregated 1.07M answer rows per call (hash aggregate, `unnest` of options, checkbox pairs, quantile sorts over ~480k numbers, terms). No index helps a query that must read every row; the cost is linear in answers.

Answer filters were `NOT EXISTS` probes that rebuilt the filter's value arrays for every response (1.1 s per call at 70k, called 4–5 times per bundle):

```
Function Scan on _dashboard_responses r (actual time=1105.436..1106.214 rows=13542)
```

## Fixes, cheapest first

1. **Indexes** — reviewed; nothing to gain for unfiltered statistics (they read the whole form). One change: `response_answers (form_id, question_key, response_id)` replaces `(form_id, question_key)`, so the top-terms sample reads one question's answers in response-id order.
2. **Narrower queries**
   - `_dashboard_responses`: answer filters resolved set-based (one indexed read per filtered question, intersected). Answer-filtered bundle at 50k: 5.7 s → 1.05 s p95.
   - `list_responses`: no id array (the `unnest` join was planned as a nested loop over every response). 0.49 s → 0.19 s p95 at 100k.
   - `cross_suggestions`: latest 5,000 matching responses (it is a hint; each pair still reports its n). 13.2 s → 0.70 s p95 at 100k.
   - `generate_demo_responses`: conditional questions iterate the visible ids instead of `= any(array)` per row (quadratic); visibility probe as a per-response lateral lookup.
3. **Summary tables maintained by triggers** — `response_summary` (hourly) and `answer_summary` (daily, per value), see [architecture.md](architecture.md#dashboard-summaries). The bundle reads ~125k pre-aggregated rows instead of 1.07M answers; medians / quantiles / standard deviations are computed from value counts with the same formulas as Postgres, and an integration test checks that the summary path and the raw path return identical JSON.
4. **Plan caching** — found while benchmarking: PL/pgSQL switches to a generic plan after five calls on the same connection, and PostgREST reuses connections. For the dashboard functions the generic plan was ~2x slower (bundle 170 → 330 ms at 86k), and in the demo generator it hash-joined ~1M answers and hit the 8 s API timeout at exactly 86k responses in three runs. Fix: `plan_cache_mode = force_custom_plan` on the dashboard, export and generator functions (~1 ms planning per call).

## Results (after all fixes)

`pnpm bench:dashboard`, 2026-10-13. Payload = JSON size.

### 1,000 responses

| Call                               | p50 (ms) | p95 (ms) | max (ms) |  payload |
| ---------------------------------- | -------: | -------: | -------: | -------: |
| dashboard_bundle (no filters)      |       46 |       62 |       73 |  16.1 KB |
| dashboard_bundle (last 30 days)    |       36 |       42 |       54 |  13.4 KB |
| dashboard_bundle (device = mobile) |       44 |       57 |       60 |  15.7 KB |
| dashboard_bundle (answer filter)   |      161 |      198 |      205 |  14.0 KB |
| question_stats (rating)            |       15 |       18 |       18 |   0.3 KB |
| cross_stats (dropdown × rating)    |       17 |       20 |       21 |   0.3 KB |
| cross_suggestions                  |      119 |      150 |      172 |   0.4 KB |
| list_responses (first page)        |       21 |       27 |       32 |  28.0 KB |
| export_responses (batch of 1000)   |      147 |      191 |      239 | 492.5 KB |

### 10,000 responses

| Call                               | p50 (ms) | p95 (ms) | max (ms) |  payload |
| ---------------------------------- | -------: | -------: | -------: | -------: |
| **dashboard_bundle (no filters)**  |   **85** |   **98** |      120 |  16.9 KB |
| dashboard_bundle (last 30 days)    |       66 |       72 |       73 |  14.6 KB |
| dashboard_bundle (device = mobile) |       72 |       89 |       94 |  16.7 KB |
| dashboard_bundle (answer filter)   |      285 |      329 |      336 |  16.2 KB |
| question_stats (rating)            |       14 |       15 |       19 |   0.4 KB |
| cross_stats (dropdown × rating)    |       89 |       99 |      107 |   0.3 KB |
| cross_suggestions                  |      473 |      550 |      634 |   0.4 KB |
| list_responses (first page)        |       24 |       25 |       25 |  27.5 KB |
| export_responses (batch of 1000)   |      149 |      199 |      234 | 489.5 KB |

### 50,000 responses

| Call                               | p50 (ms) | p95 (ms) | max (ms) |  payload |
| ---------------------------------- | -------: | -------: | -------: | -------: |
| dashboard_bundle (no filters)      |      160 |      212 |      212 |  17.5 KB |
| dashboard_bundle (last 30 days)    |      127 |      146 |      160 |  15.1 KB |
| dashboard_bundle (device = mobile) |      139 |      160 |      168 |  17.2 KB |
| dashboard_bundle (answer filter)   |      970 |    1,051 |    1,073 |  16.8 KB |
| question_stats (rating)            |       19 |       20 |       23 |   0.4 KB |
| cross_stats (dropdown × rating)    |      513 |      619 |      624 |   0.3 KB |
| cross_suggestions                  |      671 |      820 |      823 |   0.4 KB |
| list_responses (first page)        |       67 |      100 |      147 |  28.3 KB |
| export_responses (batch of 1000)   |      126 |      147 |      148 | 489.0 KB |

### 100,000 responses

| Call                               | p50 (ms) | p95 (ms) | max (ms) |  payload |
| ---------------------------------- | -------: | -------: | -------: | -------: |
| **dashboard_bundle (no filters)**  |  **190** |  **227** |      240 |  17.8 KB |
| dashboard_bundle (last 30 days)    |      182 |      204 |      208 |  15.4 KB |
| dashboard_bundle (device = mobile) |      213 |      239 |      256 |  17.5 KB |
| dashboard_bundle (answer filter)   |    1,849 |    1,996 |    2,423 |  17.1 KB |
| question_stats (rating)            |       22 |       27 |       27 |   0.4 KB |
| cross_stats (dropdown × rating)    |    1,114 |    1,557 |    1,630 |   0.3 KB |
| cross_suggestions                  |      592 |      704 |      742 |   0.4 KB |
| list_responses (first page)        |      135 |      189 |      217 |  28.1 KB |
| export_responses (batch of 1000)   |      142 |      217 |      258 | 488.2 KB |

Generation time (500 per call through the API, including the summary triggers): 9,000 responses in 19.6 s, 40,000 in 117 s, 50,000 in 129 s (≈ 2.6 ms per response at 50–100k).

### Export end to end (100k responses, production build, `next start`, local)

| Format | Time   | Size    | Rows                          | Server RSS before → peak |
| ------ | ------ | ------- | ----------------------------- | ------------------------ |
| CSV    | 27.8 s | 18.7 MB | 100,001 lines (header + 100k) | 108 → 200 MB             |
| XLSX   | 35.1 s | 12.0 MB | 100,001 + 63 summary rows     | 190 → 307 MB             |

The XLSX was read back with exceljs (100,001 rows on the first sheet). Memory does not grow with the row count (the unit test streams 100k rows through both writers and checks that no batch is fetched ahead of a slow reader); the RSS growth above is V8 heap headroom.

## EXPLAIN ANALYZE after the fixes (100k responses)

Default bundle (`auto_explain`, nested statements; instrumentation roughly doubles the times). Four statements over 15 ms:

```
duration: 50.651 ms   -- median duration (exact, raw)
Aggregate (actual time=50.640..50.642 rows=1)
  ->  Seq Scan on responses r (actual time=0.073..25.334 rows=100000)

duration: 56.324 ms   -- overview from response_summary
  ->  CTE Scan on nodates (actual time=0.061..11.974 rows=7644)
  ->  Aggregate (actual time=15.790..15.791 rows=1)
        ->  CTE Scan on f (actual time=0.063..14.596 rows=7644)

duration: 315.854 ms  -- question statistics
  ->  HashAggregate (actual time=88.273..88.491 rows=413)
        ->  Seq Scan on answer_summary x (actual time=0.533..25.034 rows=124744)
  ->  Aggregate (actual time=213.839..213.844 rows=1)          -- top terms, 4 text questions
        ->  ... Limit (actual time=39.173..39.617 rows=1500 loops=4)
              ->  Sort
                    ->  Bitmap Heap Scan on response_answers ra (rows=3399 loops=4)
                          ->  Bitmap Index Scan on response_answers_form_question_response_idx
```

Summary read alone (`explain (analyze, buffers)`): all in shared buffers, 78 ms:

```
HashAggregate (actual time=77.472..77.690 rows=413 loops=1)
  Group Key: question_key, kind, value
  Batches: 1  Memory Usage: 657kB
  Buffers: shared hit=2236
  ->  Seq Scan on answer_summary x (actual time=0.298..24.586 rows=124744 loops=1)
        Filter: (form_id = '9a104f4b-…'::uuid)
```

Export keyset page (the predicate of `export_responses`): index range scan, constant per page:

```
Limit (actual time=0.351..3.730 rows=1000 loops=1)
  ->  Incremental Sort (actual time=0.349..3.674 rows=1000 loops=1)
        Sort Key: submitted_at, id
        Presorted Key: submitted_at
        ->  Index Scan using responses_form_submitted_idx on responses r (actual time=0.040..3.309 rows=1001 loops=1)
Execution Time: 3.876 ms
```

Answer filter (raw path, 86k): the set-based filter costs ~200 ms per evaluation and the bundle evaluates it four times (overview start date, filtered set, set without dates, questions), plus ~0.8 s of raw aggregation over the ≈ 17k matching responses:

```
Bitmap Heap Scan on responses r (actual time=216.864..239.508 rows=16921 loops=1)
  ->  GroupAggregate (actual time=196.956..202.626 rows=16921 loops=1)
        ->  Sort (actual time=196.931..198.230 rows=16921 loops=1)
  ->  CTE Scan on matched m (actual time=196.957..205.454 rows=16921 loops=1)
```

## Remaining hot spots and next steps

| Area                                     | At 100k              | Next step if needed                                                                                                                                   |
| ---------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Answer-filtered dashboard (drill-down)   | p95 2.0 s            | Evaluate the filter once per call (pass the matching ids between overview and questions), or a per-response facet table for the filterable questions. |
| `cross_stats` (custom cross-tab widgets) | p95 1.6 s            | Pair-level summary for categorical × categorical, or the same 5,000-response sample as suggestions (with a label).                                    |
| Top terms in the bundle                  | ~4 × 40 ms           | Cache per (form, day) or move to a separate lazy query.                                                                                               |
| Bulk demo generation                     | ~2.6 ms per response | Statement-level summary triggers join the batch to `responses` with a hash join; fine for demo data, single submissions use the primary key.          |

None of these affect the default dashboard, the date / device / language filters, live updates, the responses table or exports.

## How to reproduce

```bash
pnpm db:reset && pnpm seed
pnpm bench:dashboard                          # ~15 minutes, leaves 100k demo rows in "Scale test (Demo)"
pnpm bench:dashboard --sizes 10000 --runs 30  # one size
# then: /admin/demo/scale > Clear demo data (or rerun with the default sizes, which clears first)
```

EXPLAIN output: `load 'auto_explain'; set auto_explain.log_min_duration = 15; set auto_explain.log_analyze = on; set auto_explain.log_nested_statements = on; set client_min_messages = log;` in psql (`docker exec -it supabase_db_formpulse psql -U postgres`), then `select dashboard_bundle('<form id>', '{}');`.

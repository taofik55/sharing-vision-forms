/**
 * Demo job sizes (shared by the server actions, scripts and the scale page).
 * PostgREST stops statements after 8 s. Generation costs ~1.5-3 ms per
 * response at 100k rows (bulk trigger joins grow with the tables), so 500 per
 * call stays around 1-1.5 s with headroom for a busy database.
 */
export const DEMO_CHUNK = 500;

/** Rows per delete_demo_responses call (~1.5 s each, oldest first). */
export const DEMO_DELETE_CHUNK = 20_000;

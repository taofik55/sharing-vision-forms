import "server-only";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import {
  csvRecord,
  sanitizeCell,
  UTF8_BOM,
  type Cell,
  type ExportColumn,
  type ExportRow,
} from "./format";

export const EXPORT_BATCH = 1000;

export type ExportCursor = { at: string; id: string } | null;

/** One keyset page (submitted_at, id ascending). */
export type FetchBatch = (
  cursor: ExportCursor,
  limit: number,
) => Promise<ExportRow[]>;

/**
 * Keyset batches of `batchSize` rows. Only one batch is held at a time; the
 * next one is fetched when the consumer asks for it (stream backpressure).
 */
export async function* exportBatches(
  fetchBatch: FetchBatch,
  batchSize = EXPORT_BATCH,
): AsyncGenerator<ExportRow[]> {
  let cursor: ExportCursor = null;
  for (;;) {
    const rows = await fetchBatch(cursor, batchSize);
    if (rows.length) yield rows;
    if (rows.length < batchSize) return;
    const last = rows[rows.length - 1];
    // Raw timestamptz text from the database (microsecond precision).
    cursor = { at: last.submitted_at, id: last.id };
  }
}

/** UTF-8 (with BOM) RFC 4180 CSV, one pull per batch. */
export function csvStream(
  columns: ExportColumn[],
  batches: AsyncIterable<ExportRow[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = batches[Symbol.asyncIterator]();
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(
          encoder.encode(UTF8_BOM + csvRecord(columns.map((c) => c.header))),
        );
        return;
      }
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      let chunk = "";
      for (const row of value)
        chunk += csvRecord(columns.map((c) => c.value(row)));
      controller.enqueue(encoder.encode(chunk));
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

/** Buffered bytes (uncompressed input + unread zip output) before the writer pauses. */
const XLSX_BUFFER_LIMIT = 2 * 1024 * 1024;

/**
 * XLSX via the exceljs streaming writer: rows are committed as they are
 * written, so memory stays flat. Sheets: responses + summary.
 */
export function xlsxStream(options: {
  columns: ExportColumn[];
  batches: AsyncIterable<ExportRow[]>;
  sheetNames: { responses: string; summary: string };
  /** Built lazily after the responses sheet (e.g. from dashboard_bundle). */
  summary: () => Promise<Cell[][]>;
}): ReadableStream<Uint8Array> {
  const output = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
    useSharedStrings: false,
  });

  // exceljs ignores backpressure: committed rows pile up in the zip entry's
  // input when compression is behind, and the zip (archiver) buffers its
  // output when the client reads slowly. Both are measured through exceljs
  // 4.4.0 internals (pinned version) and the writer pauses between batches.
  type StreamState = {
    _writableState?: { length: number };
    _readableState?: { length: number };
  };
  type SheetInternals = { _stream?: { pipes?: StreamState[] } };
  let delivered = 0;
  const zip = (workbook as unknown as { zip: { pointer(): number } }).zip;
  const backlog = (sheet: unknown) => {
    const pipes = (sheet as SheetInternals)._stream?.pipes ?? [];
    const input = pipes.reduce(
      (n, p) =>
        n + (p._writableState?.length ?? 0) + (p._readableState?.length ?? 0),
      0,
    );
    return input + zip.pointer() - delivered;
  };
  const waitForReader = async (sheet: unknown) => {
    while (!output.destroyed && backlog(sheet) > XLSX_BUFFER_LIMIT) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  void (async () => {
    try {
      const sheet = workbook.addWorksheet(options.sheetNames.responses, {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      sheet.columns = options.columns.map((c, i) => ({
        header: c.header,
        key: String(i),
        width: c.width,
      }));
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).commit();

      for await (const batch of options.batches) {
        if (output.destroyed) return;
        for (const row of batch) {
          sheet
            .addRow(options.columns.map((c) => sanitizeCell(c.value(row))))
            .commit();
        }
        await waitForReader(sheet);
      }
      sheet.commit();

      const summary = workbook.addWorksheet(options.sheetNames.summary);
      summary.columns = [
        { width: 48 },
        { width: 18 },
        { width: 12 },
        { width: 32 },
        { width: 12 },
        { width: 14 },
      ];
      for (const cells of await options.summary()) {
        const row = summary.addRow(cells.map(sanitizeCell));
        // Header, total and question rows start with text; detail rows are indented.
        if (cells[0] !== null && cells[0] !== undefined)
          row.font = { bold: true };
        row.commit();
      }
      summary.commit();
      await workbook.commit();
    } catch (error) {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return (Readable.toWeb(output) as ReadableStream<Uint8Array>).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        delivered += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
}

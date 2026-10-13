import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  answerCell,
  csvRecord,
  exportColumns,
  exportFileName,
  jakartaTime,
  questionHeaders,
  sanitizeCell,
  summaryRows,
  type ExportQuestion,
  type ExportRow,
} from "@/lib/export/format";
import {
  csvStream,
  exportBatches,
  xlsxStream,
  type FetchBatch,
} from "@/lib/export/stream";
import type { QuestionStats } from "@/lib/analytics/types";

const labels = {
  responseId: "Response ID",
  submittedAtUtc: "Submitted at (UTC)",
  submittedAtLocal: "Submitted at (WIB)",
  version: "Version",
  identifierEmail: "Email",
  identifierPhone: "Phone",
  other: "Other",
};

const questions: ExportQuestion[] = [
  {
    key: "q_choice_1",
    type: "multiple_choice",
    title: "Channel",
    options: [
      { id: "a", label: "Store" },
      { id: "b", label: "App, web" },
    ],
  },
  {
    key: "q_boxes_22",
    type: "checkboxes",
    title: "Products",
    options: [
      { id: "x", label: "Coffee" },
      { id: "y", label: "Tea" },
    ],
  },
  { key: "q_rating_3", type: "rating", title: "Score" },
  { key: "q_text_444", type: "paragraph", title: "Comment" },
  { key: "q_date_555", type: "date", title: "Visit" },
];

function row(i: number, answers: ExportRow["answers"] = {}): ExportRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    submitted_at: new Date(Date.UTC(2026, 9, 12, 17, 0, i % 60)).toISOString(),
    version_number: 1,
    identifier_email: null,
    identifier_phone: null,
    answers,
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

describe("export format", () => {
  it("guards against formula injection", () => {
    expect(sanitizeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeCell("+62812")).toBe("'+62812");
    expect(sanitizeCell("-1")).toBe("'-1");
    expect(sanitizeCell("@cmd")).toBe("'@cmd");
    expect(sanitizeCell("\t=1")).toBe("'\t=1");
    expect(sanitizeCell("fine = ok")).toBe("fine = ok");
    expect(sanitizeCell(-5)).toBe(-5);
    expect(sanitizeCell(null)).toBeNull();
  });

  it("encodes RFC 4180 records with CRLF", () => {
    expect(csvRecord(["a", 1, null, 'say "hi"', "x,y", "line\nbreak"])).toBe(
      'a,1,,"say ""hi""","x,y","line\nbreak"\r\n',
    );
    expect(csvRecord(["=HYPERLINK(1)"])).toBe("'=HYPERLINK(1)\r\n");
  });

  it("uses option labels and joins checkboxes with '; '", () => {
    expect(answerCell(questions[0], { o: ["b"] }, "Other")).toBe("App, web");
    expect(
      answerCell(questions[0], { o: ["__other__"], t: "Friend" }, "Other"),
    ).toBe("Other: Friend");
    expect(answerCell(questions[1], { o: ["x", "y"] }, "Other")).toBe(
      "Coffee; Tea",
    );
    expect(answerCell(questions[1], { o: ["gone"] }, "Other")).toBe("gone");
    expect(answerCell(questions[2], { n: 4 }, "Other")).toBe(4);
    expect(answerCell(questions[4], { d: "2026-10-01" }, "Other")).toBe(
      "2026-10-01",
    );
    expect(answerCell(questions[3], undefined, "Other")).toBeNull();
  });

  it("appends the short key when titles collide", () => {
    expect(
      questionHeaders([
        { key: "abcdefgh1", type: "short_text", title: "Name" },
        { key: "zyxwvut22", type: "short_text", title: "Name" },
        { key: "k3", type: "short_text", title: "Age" },
      ]),
    ).toEqual(["Name [abcdef]", "Name [zyxwvu]", "Age"]);
  });

  it("formats Jakarta time and file names", () => {
    expect(jakartaTime("2026-10-12T17:00:00.000Z")).toBe("2026-10-13 00:00:00");
    expect(
      exportFileName(
        "Survei Kepuasan: 2026!",
        "csv",
        new Date("2026-10-12T18:00:00Z"),
      ),
    ).toBe("survei-kepuasan-2026-responses-2026-10-13.csv");
  });

  it("includes identifier columns only when allowed", () => {
    const withIds = exportColumns(questions, labels, true).map((c) => c.header);
    const without = exportColumns(questions, labels, false).map(
      (c) => c.header,
    );
    expect(withIds).toContain("Email");
    expect(without).not.toContain("Email");
    expect(without.slice(0, 4)).toEqual([
      "Response ID",
      "Submitted at (UTC)",
      "Submitted at (WIB)",
      "Version",
    ]);
    expect(without.slice(4)).toEqual([
      "Channel",
      "Products",
      "Score",
      "Comment",
      "Visit",
    ]);
  });

  it("builds summary rows from bundle stats", () => {
    const stats = {
      q_choice_1: {
        type: "multiple_choice",
        key: "q_choice_1",
        n: 4,
        total: 5,
        eligible: 5,
        low_sample: true,
        options: [
          { id: "a", count: 3 },
          { id: "b", count: 1 },
        ],
        other: 0,
      },
    } as unknown as Record<string, QuestionStats>;
    const rows = summaryRows([questions[0]], stats, 5, {
      question: "Question",
      type: "Type",
      answered: "Answered",
      value: "Value",
      count: "Count",
      percent: "%",
      total: "Responses",
      mean: "Mean",
      median: "Median",
      min: "Min",
      max: "Max",
      averageLength: "Avg length",
      other: "Other",
      typeLabel: (t) => t,
    });
    expect(rows[0]).toEqual(["Responses", null, 5, null, null, null]);
    expect(rows[3]).toEqual([
      "Channel",
      "multiple_choice",
      4,
      null,
      null,
      null,
    ]);
    expect(rows[4]).toEqual([null, null, null, "Store", 3, 75]);
    expect(rows[5]).toEqual([null, null, null, "App, web", 1, 25]);
  });
});

describe("export streams", () => {
  const columns = exportColumns(questions, labels, false);

  it("pages with a keyset cursor", async () => {
    const calls: unknown[] = [];
    const all = Array.from({ length: 2500 }, (_, i) => row(i));
    const fetchBatch: FetchBatch = async (cursor, limit) => {
      calls.push(cursor);
      const start = cursor ? all.findIndex((r) => r.id === cursor.id) + 1 : 0;
      return all.slice(start, start + limit);
    };
    let count = 0;
    for await (const batch of exportBatches(fetchBatch)) count += batch.length;
    expect(count).toBe(2500);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toEqual({ at: all[999].submitted_at, id: all[999].id });
  });

  it("writes a CSV with BOM, header and one line per response", async () => {
    const rows = [
      row(1, {
        q_choice_1: { o: ["a"] },
        q_text_444: { t: "=cmd|' /C calc'!A0" },
      }),
      row(2, { q_boxes_22: { o: ["x", "y"] }, q_rating_3: { n: 5 } }),
    ];
    const csv = (
      await readAll(
        csvStream(
          columns,
          exportBatches(async (c) => (c ? [] : rows), 1000),
        ),
      )
    ).toString("utf8");
    expect(csv.startsWith("﻿Response ID,")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(",Store,");
    expect(lines[1]).toContain(",'=cmd|' /C calc'!A0,");
    expect(lines[2]).toContain(",Coffee; Tea,5,");
  });

  it("writes an XLSX with Responses and Summary sheets", async () => {
    const rows = [
      row(1, { q_choice_1: { o: ["a"] }, q_text_444: { t: "@SUM(1)" } }),
    ];
    const buffer = await readAll(
      xlsxStream({
        columns,
        batches: exportBatches(async (c) => (c ? [] : rows)),
        sheetNames: { responses: "Responses", summary: "Summary" },
        summary: async () => [["Responses", null, 1, null, null, null]],
      }),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Responses",
      "Summary",
    ]);
    const sheet = workbook.getWorksheet("Responses")!;
    expect(sheet.getRow(1).getCell(1).value).toBe("Response ID");
    expect(sheet.getRow(2).getCell(5).value).toBe("Store");
    expect(sheet.getRow(2).getCell(8).value).toBe("'@SUM(1)");
    expect(workbook.getWorksheet("Summary")!.getRow(1).getCell(3).value).toBe(
      1,
    );
  });

  // 100k rows (11 columns) through both writers with keyset batches of 1000:
  // memory must stay flat because only one batch is alive at a time.
  const big: FetchBatch = async (cursor, limit) => {
    const start = cursor ? Number(cursor.id.slice(-12)) + 1 : 0;
    const end = Math.min(100_000, start + limit);
    return Array.from({ length: end - start }, (_, k) =>
      row(start + k, {
        q_choice_1: { o: ["a"] },
        q_boxes_22: { o: ["x", "y"] },
        q_rating_3: { n: (start + k) % 5 },
        q_text_444: {
          t: "Pelayanan cepat dan staf ramah, terima kasih banyak.",
        },
        q_date_555: { d: "2026-10-01" },
      }),
    );
  };

  async function measure(stream: ReadableStream<Uint8Array>) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    let bytes = 0;
    const reader = stream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    return { bytes, growthMb: (peak - before) / 1024 / 1024 };
  }

  it("streams a 100k-row CSV with bounded memory", async () => {
    const { bytes, growthMb } = await measure(
      csvStream(columns, exportBatches(big)),
    );
    expect(bytes).toBeGreaterThan(100_000 * 100);
    expect(growthMb).toBeLessThan(64);
  }, 120_000);

  it("does not fetch ahead of a slow reader (CSV and XLSX)", async () => {
    let csvCalls = 0;
    const csv = csvStream(
      columns,
      exportBatches(async (c, l) => {
        csvCalls += 1;
        return big(c, l);
      }),
    ).getReader();
    await csv.read();
    await csv.read();
    await new Promise((r) => setTimeout(r, 200));
    expect(csvCalls).toBeLessThanOrEqual(3);
    await csv.cancel();

    let xlsxCalls = 0;
    const xlsx = xlsxStream({
      columns,
      batches: exportBatches(async (c, l) => {
        xlsxCalls += 1;
        return big(c, l);
      }),
      sheetNames: { responses: "Responses", summary: "Summary" },
      summary: async () => [],
    }).getReader();
    await xlsx.read();
    await new Promise((r) => setTimeout(r, 1500));
    // 100 batches exist; the writer pauses once ~2 MB wait unread.
    expect(xlsxCalls).toBeLessThan(60);
    await xlsx.cancel();
  }, 60_000);

  it("streams a 100k-row XLSX with bounded memory", async () => {
    const { bytes, growthMb } = await measure(
      xlsxStream({
        columns,
        batches: exportBatches(big),
        sheetNames: { responses: "Responses", summary: "Summary" },
        summary: async () => [],
      }),
    );
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(growthMb).toBeLessThan(160);
  }, 300_000);
});

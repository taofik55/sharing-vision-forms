/**
 * "Kuesioner Survei UMKM BRI" (Value Proposition Enhancement Layanan UMKM),
 * draft instrument v0.3 (15 Oct 2026) by PT Sharing Vision Indonesia, as a
 * form definition + interview settings. Face-to-face (CAPI), 400 UMKM
 * respondents, quota 20 per city x sector x segment.
 *
 * Modelling notes (see docs/progress.md, CAPI section):
 * - question keys are the lower-case codes (s1, b5a, c3u): stable and readable;
 * - option ids are `c<code>` (code 99 = "Lainnya", its original answer goes
 *   into the interviewer note);
 * - "STOP" = terminate rules (screen-out with the question code), "lanjut X"
 *   = jump rules, "[jika …]" = show-if conditions;
 * - combined questions are split: C3 (installed) + C3U (main), C10A/C10B,
 *   E3 + E3_ALASAN, F3 + F3_APP, J3 + J3_NOMOR, J4 + J4_FOTO + J4_GPS;
 * - the PDF's QC sheet lists B7b, which does not exist: B7 has no note rule.
 */
import type { CapiSettings } from "./capi";
import type {
  Condition,
  ConditionGroup,
  FormDefinition,
  Option,
  Question,
  QuestionType,
  Rule,
  Section,
} from "./schema";

export const BRI_TITLE =
  "Survei Layanan UMKM BRI — Preferensi Perbankan & Pembayaran Digital";
export const BRI_DESCRIPTION =
  "Wawancara tatap muka terstruktur (±25 menit) dengan pemilik atau pengelola UMKM Retail & F&B. Draf instrumen v0.3 — PT Sharing Vision Indonesia untuk PT Bank Rakyat Indonesia (Persero) Tbk.";

const key = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const opt = (
  code: number | string,
  label: string,
  exclusive = false,
): Option => ({
  id: `c${code}`,
  label,
  code: String(code),
  ...(exclusive ? { exclusive: true } : {}),
});
const opts = (
  pairs: [number | string, string][],
  exclusive: (number | string)[] = [],
) => pairs.map(([c, l]) => opt(c, l, exclusive.includes(c)));

// Conditions on question codes and option codes.
const eq = (code: string, value: number | string): Condition => ({
  questionKey: key(code),
  operator: "equals",
  value: `c${value}`,
});
const neq = (code: string, value: number | string): Condition => ({
  questionKey: key(code),
  operator: "not_equals",
  value: `c${value}`,
});
const has = (code: string, value: number | string): Condition => ({
  questionKey: key(code),
  operator: "contains",
  value: `c${value}`,
});
const hasNot = (code: string, value: number | string): Condition => ({
  questionKey: key(code),
  operator: "not_contains",
  value: `c${value}`,
});
const lt = (code: string, value: number): Condition => ({
  questionKey: key(code),
  operator: "lt",
  value,
});
const gt = (code: string, value: number): Condition => ({
  questionKey: key(code),
  operator: "gt",
  value,
});
const notSame = (code: string, other: string): Condition => ({
  questionKey: key(code),
  operator: "not_same_as",
  value: key(other),
});
const any = (...conditions: Condition[]): ConditionGroup => ({
  combinator: "or",
  conditions,
});
const all = (...conditions: Condition[]): ConditionGroup => ({
  combinator: "and",
  conditions,
});
const stop = (reason: string, ...conditions: Condition[]): Rule => ({
  action: "terminate",
  reason,
  when: any(...conditions),
});
const jump = (target: string, ...conditions: Condition[]): Rule => ({
  action: "jump",
  target,
  ...(conditions.length ? { when: any(...conditions) } : {}),
});

type Extra = Partial<Omit<Question, "id" | "key" | "code" | "type" | "title">>;

function q(
  code: string,
  type: QuestionType,
  title: string,
  extra: Extra = {},
): Question {
  return {
    id: `q_${key(code)}`,
    key: key(code),
    code,
    type,
    title,
    required: true,
    ...extra,
  };
}

function section(
  id: string,
  title: string,
  description: string,
  questions: Question[],
): Section {
  return { id, title, description, questions };
}

// -----------------------------------------------------------------------------
// Shared lists
// -----------------------------------------------------------------------------

const S5_BANKS = opts([
  [1, "BRI"],
  [2, "BCA"],
  [3, "Mandiri"],
  [4, "BNI"],
  [5, "BSI"],
  [6, "CIMB Niaga"],
  [7, "Bank digital (Jago, Seabank, Blu, Neo, Jenius)"],
  [8, "BPR/BPD"],
  [9, "Tidak punya rekening usaha"],
  [99, "Lainnya"],
]);

/** Daftar bank Modul B (B1, B2, B5a, B8a, D1a, D4a, E1a, H7a). */
const BANKS = opts([
  [1, "BRI"],
  [2, "BCA"],
  [3, "Mandiri"],
  [4, "BNI"],
  [5, "BSI"],
  [6, "CIMB Niaga"],
  [7, "Bank Jago"],
  [8, "Seabank"],
  [9, "Blu/BCA Digital"],
  [10, "Bank Neo"],
  [11, "Jenius/BTPN"],
  [12, "BPR/BPD"],
  [13, "Bank lain"],
  [99, "Lainnya"],
]);

/** Daftar penyedia QRIS (C3, C3U, J5). */
const QRIS = opts([
  [1, "BRI"],
  [2, "BCA"],
  [3, "Mandiri"],
  [4, "BNI"],
  [5, "BSI"],
  [6, "CIMB Niaga"],
  [7, "GoPay/GoBiz"],
  [8, "OVO"],
  [9, "DANA"],
  [10, "ShopeePay"],
  [11, "LinkAja"],
  [12, "Bank digital"],
  [13, "Agregator (Midtrans, Xendit, Cashlez, Youtap)"],
  [99, "Lainnya"],
]);

const SWITCH_TRIGGERS = opts([
  [1, "Biaya"],
  [2, "Aplikasi sering bermasalah"],
  [3, "Pembeli beralih ke bank itu"],
  [4, "Ditawari petugas bank"],
  [5, "Butuh pinjaman"],
  [6, "Cabang/ATM pindah atau tutup"],
  [7, "Masalah transaksi tak terselesaikan"],
  [8, "Ikut pemasok/mitra"],
  [99, "Lainnya"],
]);

const PERCENT_BANDS = opts([
  [1, "Kurang dari 10%"],
  [2, "10–25%"],
  [3, "26–50%"],
  [4, "51–75%"],
  [5, "Lebih dari 75%"],
]);

const ATTRIBUTES = opts([
  [1, "Kecepatan dana QRIS masuk rekening"],
  [2, "Biaya transfer antar bank"],
  [3, "Biaya admin bulanan"],
  [4, "Kemudahan aplikasi mobile"],
  [5, "Aplikasi tetap lancar saat jam ramai"],
  [6, "Kemudahan mencocokkan dana masuk dengan penjualan"],
  [7, "Kedekatan cabang/ATM/agen"],
  [8, "Kecepatan penyelesaian masalah transaksi"],
  [9, "Keramahan & kompetensi petugas/CS"],
  [10, "Kemudahan mendapat pinjaman usaha"],
  [11, "Bunga/imbal hasil simpanan"],
  [12, "Promo untuk pembeli di merchant"],
  [13, "Terhubung dengan aplikasi kasir/marketplace"],
  [14, "Rasa aman dari penipuan"],
]).map((o) => ({ ...o, id: `r${o.code}` }));

const CONCEPTS = opts([
  [1, "QRIS seketika"],
  [2, "Rekening usaha pisah kantong"],
  [3, "Laporan penjualan otomatis"],
  [4, "Pinjaman modal kerja instan"],
  [5, "Bebas biaya transfer ke pemasok"],
  [6, "Promo pembeli QRIS BRI"],
]);

const CONCEPT_CARDS = [
  "Kartu konsep (dibacakan, urutan diacak):",
  "1. QRIS seketika — Dana dari pembeli masuk ke rekening operasional saat itu juga, tanpa potongan tambahan.",
  "2. Rekening usaha pisah kantong — Satu rekening dengan kantong otomatis untuk operasional, tabungan, dan pajak; bisa diatur persentasenya.",
  "3. Laporan penjualan otomatis — Rekap harian dari QRIS dan transfer, bisa diunduh untuk pembukuan atau dibagikan ke akuntan.",
  "4. Pinjaman modal kerja instan — Plafon dihitung dari riwayat transaksi QRIS di BRI, cair dalam hitungan jam, tanpa agunan.",
  "5. Bebas biaya transfer ke pemasok — Transfer antarbank gratis sampai jumlah tertentu per bulan untuk rekening yang didaftarkan sebagai pemasok.",
  "6. Promo pembeli QRIS BRI — Pembeli yang bayar lewat QRIS BRI di toko Bapak/Ibu mendapat cashback/voucher, dibiayai BRI.",
].join("\n");

const NON_BRI = neq("S5", 1);
const IS_BRI = eq("S5", 1);

// -----------------------------------------------------------------------------
// Definition
// -----------------------------------------------------------------------------

export function briUmkmDefinition(): FormDefinition {
  return {
    schemaVersion: 1,
    sections: [
      section(
        "sec_s",
        "Modul S — Screening",
        "Sepuluh pertanyaan penyaring. Jika satu kriteria gagal, wawancara dihentikan dan dicatat sebagai screen-out beserta kode pertanyaannya.",
        [
          q(
            "S1",
            "multiple_choice",
            "Apakah Bapak/Ibu pemilik usaha ini, atau pengelola yang berwenang memutuskan urusan keuangan usaha?",
            {
              options: opts([
                [1, "Pemilik"],
                [2, "Pengelola berwenang"],
                [3, "Karyawan/anggota keluarga tanpa wewenang"],
              ]),
              rules: [stop("Bukan pemilik/pengelola berwenang", eq("S1", 3))],
            },
          ),
          q("S2", "multiple_choice", "Apa jenis usaha utama di lokasi ini?", {
            options: opts([
              [1, "Perdagangan/Retail (toko, warung, kios, minimarket)"],
              [2, "Kuliner/F&B (rumah makan, kafe, kedai, kaki lima)"],
              [3, "Jasa"],
              [4, "Produksi/manufaktur"],
              [99, "Lainnya"],
            ]),
            rules: [
              stop(
                "Bukan sektor Retail atau F&B",
                eq("S2", 3),
                eq("S2", 4),
                eq("S2", 99),
              ),
            ],
          }),
          q(
            "S3",
            "multiple_choice",
            "Sudah berapa lama usaha ini berjalan di lokasi ini?",
            {
              options: opts([
                [1, "Kurang dari 1 tahun"],
                [2, "1–3 tahun"],
                [3, "Lebih dari 3–5 tahun"],
                [4, "Lebih dari 5 tahun"],
              ]),
              rules: [stop("Usaha berjalan kurang dari 1 tahun", eq("S3", 1))],
            },
          ),
          q("S4", "number", "Boleh tahu usia Bapak/Ibu saat ini?", {
            description: "Isian angka tahun.",
            placeholder: "Usia (tahun)",
            validation: { integerOnly: true, min: 10, max: 100 },
            rules: [
              stop("Usia di luar 21–55 tahun", lt("S4", 21), gt("S4", 55)),
            ],
          }),
          q(
            "S5",
            "multiple_choice",
            "Dari semua rekening bank yang dipakai usaha, rekening bank mana yang menjadi rekening operasional utama, yaitu tempat masuknya hasil penjualan sehari-hari?",
            {
              options: S5_BANKS,
              rules: [stop("Tidak punya rekening usaha", eq("S5", 9))],
            },
          ),
          q(
            "S6",
            "multiple_choice",
            "Dalam sebulan terakhir, berapa kali Bapak/Ibu memakai aplikasi mobile banking untuk transaksi usaha, bukan sekadar cek saldo?",
            {
              options: opts([
                [1, "Tidak pernah"],
                [2, "1–2 kali"],
                [3, "3–5 kali"],
                [4, "6–10 kali"],
                [5, "Lebih dari 10 kali"],
              ]),
              rules: [
                stop(
                  "Pemakaian mobile banking usaha kurang dari 3 kali sebulan",
                  eq("S6", 1),
                  eq("S6", 2),
                ),
              ],
            },
          ),
          q(
            "S7",
            "checkboxes",
            "Apakah usaha ini menerima pembayaran non-tunai dari pembeli?",
            {
              options: opts(
                [
                  [1, "Ya, QRIS"],
                  [2, "Ya, transfer"],
                  [3, "Ya, kartu/EDC"],
                  [4, "Ya, e-wallet tanpa QRIS"],
                  [5, "Tidak sama sekali"],
                ],
                [5],
              ),
              rules: [
                stop("Tidak menerima pembayaran non-tunai", has("S7", 5)),
              ],
            },
          ),
          q(
            "S8a",
            "multiple_choice",
            "Apakah Bapak/Ibu atau anggota keluarga serumah bekerja di bank, perusahaan riset pasar, atau agensi iklan/pemasaran?",
            {
              options: opts([
                [1, "Ya"],
                [2, "Tidak"],
              ]),
              rules: [
                stop("Bekerja di bank/riset/agensi (security)", eq("S8a", 1)),
              ],
            },
          ),
          q(
            "S8b",
            "multiple_choice",
            "Dalam 6 bulan terakhir, apakah pernah mengikuti survei tentang bank atau pembayaran digital?",
            {
              options: opts([
                [1, "Ya"],
                [2, "Tidak"],
                [97, "Tidak ingat"],
              ]),
              rules: [
                stop("Mengikuti survei sejenis 6 bulan terakhir", eq("S8b", 1)),
              ],
            },
          ),
          q(
            "S9",
            "multiple_choice",
            "Apakah usaha ini cabang dari jaringan/waralaba nasional yang rekening banknya ditentukan kantor pusat?",
            {
              options: opts([
                [1, "Ya"],
                [2, "Tidak, usaha mandiri"],
                [3, "Waralaba tetapi rekening diatur sendiri"],
              ]),
              rules: [stop("Rekening ditentukan kantor pusat", eq("S9", 1))],
            },
          ),
          q("S10", "multiple_choice", "Konfirmasi kota lokasi usaha", {
            description:
              "Aplikasi mengecek kuota sel kota × sektor × segmen; jika penuh, wawancara dihentikan (kuota terpenuhi).",
            options: opts([
              [1, "Jakarta"],
              [2, "Surabaya"],
              [3, "Bandung"],
              [4, "Semarang"],
              [5, "Yogyakarta"],
            ]),
          }),
          q("S10_KEC", "short_text", "Kecamatan", {
            placeholder: "Nama kecamatan",
          }),
          q("S10_ALAMAT", "paragraph", "Alamat usaha", {
            placeholder: "Jalan, nomor, patokan",
          }),
        ],
      ),
      section(
        "sec_a",
        "Modul A — Profil Usaha",
        "Profil untuk pemecahan analisis (skala usaha, intensitas transaksi, kanal online, pinjaman); tidak ada kuota di modul ini.",
        [
          q(
            "A1_R",
            "multiple_choice",
            "Lebih spesifik, apa yang dijual usaha ini? (Retail)",
            {
              showIf: all(eq("S2", 1)),
              options: opts([
                [1, "Sembako/kelontong"],
                [2, "Minimarket/toko serba ada"],
                [3, "Pakaian & aksesori"],
                [4, "Elektronik & pulsa"],
                [5, "Kosmetik & obat"],
                [6, "Bahan bangunan/alat"],
                [7, "Retail lainnya"],
              ]),
            },
          ),
          q(
            "A1_F",
            "multiple_choice",
            "Lebih spesifik, apa yang dijual usaha ini? (F&B)",
            {
              showIf: all(eq("S2", 2)),
              options: opts([
                [11, "Warung/rumah makan"],
                [12, "Kafe/kedai kopi"],
                [13, "Kaki lima/gerobak"],
                [14, "Katering/pesanan"],
                [15, "Minuman kekinian"],
                [16, "Bakery/kue"],
                [17, "F&B lainnya"],
              ]),
            },
          ),
          q(
            "A2",
            "dropdown",
            "Kira-kira berapa rata-rata omzet (total penjualan) usaha ini per bulan?",
            {
              options: opts([
                [1, "Kurang dari Rp10 juta"],
                [2, "Rp10–25 juta"],
                [3, "Rp25–50 juta"],
                [4, "Rp50–100 juta"],
                [5, "Rp100–150 juta"],
                [6, "Rp150–300 juta"],
                [7, "Rp300–500 juta"],
                [8, "Rp500 juta–1 miliar"],
                [9, "Lebih dari Rp1 miliar"],
                [98, "Menolak"],
              ]),
            },
          ),
          q(
            "A3",
            "multiple_choice",
            "Berapa orang yang bekerja di usaha ini, termasuk keluarga yang membantu dan Bapak/Ibu sendiri?",
            {
              options: opts([
                [1, "Hanya sendiri"],
                [2, "2–3 orang"],
                [3, "4–5 orang"],
                [4, "6–10 orang"],
                [5, "Lebih dari 10 orang"],
              ]),
            },
          ),
          q(
            "A4",
            "multiple_choice",
            "Rata-rata berapa transaksi penjualan per hari pada hari biasa?",
            {
              options: opts([
                [1, "Kurang dari 20"],
                [2, "20–50"],
                [3, "51–100"],
                [4, "101–200"],
                [5, "Lebih dari 200"],
              ]),
            },
          ),
          q(
            "A5",
            "multiple_choice",
            "Rata-rata nilai satu kali transaksi pembeli?",
            {
              options: opts([
                [1, "Kurang dari Rp20 ribu"],
                [2, "Rp20–50 ribu"],
                [3, "Rp50–100 ribu"],
                [4, "Rp100–500 ribu"],
                [5, "Lebih dari Rp500 ribu"],
              ]),
            },
          ),
          q(
            "A8",
            "checkboxes",
            "Apakah usaha saat ini memiliki pinjaman atau pembiayaan? Dari mana?",
            {
              options: opts(
                [
                  [1, "Tidak ada"],
                  [2, "KUR/pinjaman bank BRI"],
                  [3, "Pinjaman bank lain"],
                  [4, "Koperasi/BPR"],
                  [5, "Pinjaman online/fintech"],
                  [6, "Paylater/kartu kredit"],
                  [7, "Keluarga/teman"],
                  [8, "Rentenir/informal"],
                  [98, "Menolak"],
                ],
                [1, 98],
              ),
            },
          ),
        ],
      ),
      section(
        "sec_b",
        "Modul B — Perilaku Perbankan",
        "Memetakan bank yang dipakai beserta perannya, lalu menggali mengapa bank di S5 menjadi rekening operasional utama.",
        [
          q(
            "B1",
            "checkboxes",
            "Bank apa saja yang Bapak/Ibu gunakan untuk keperluan usaha, termasuk yang jarang dipakai?",
            {
              description: "Bank di S5 otomatis tercentang.",
              options: BANKS,
              autoSelectFrom: key("S5"),
            },
          ),
          q("B2", "grid", "Untuk setiap bank di B1, dipakai untuk apa saja?", {
            options: opts(
              [
                [1, "Menerima pembayaran pembeli"],
                [2, "Menyimpan dana/tabungan usaha"],
                [3, "Membayar pemasok"],
                [4, "Membayar gaji"],
                [5, "Pinjaman/angsuran"],
                [6, "Keperluan pribadi"],
                [7, "Jarang dipakai"],
              ],
              [7],
            ),
            grid: { rows: [], multiple: true, rowsFrom: key("B1") },
          }),
          q(
            "B3",
            "multiple_choice",
            "Sejak kapan bank [S5] menjadi rekening operasional utama?",
            {
              options: opts([
                [1, "Kurang dari 1 tahun"],
                [2, "1–3 tahun"],
                [3, "Lebih dari 3 tahun"],
                [4, "Sejak usaha berdiri"],
              ]),
            },
          ),
          q(
            "B4",
            "ranking",
            "Apa alasan utama memilih bank [S5] sebagai rekening operasional? Sebutkan yang paling penting dulu.",
            {
              ranking: { max: 3 },
              noteRequired: true,
              options: opts([
                [1, "Cabang/ATM/agen dekat"],
                [2, "Pembeli banyak memakai bank itu"],
                [3, "Biaya transfer murah/gratis"],
                [4, "Aplikasi mudah dan jarang bermasalah"],
                [5, "Dana QRIS cepat masuk"],
                [6, "Sudah punya pinjaman di bank itu"],
                [7, "Pemasok memakai bank itu"],
                [8, "Saran keluarga/teman"],
                [9, "Didatangi/ditawari petugas bank"],
                [10, "Rekening pribadi sudah di situ"],
                [11, "Promo/bunga"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "B5",
            "multiple_choice",
            "Apakah pernah menggunakan bank selain bank [S5] sebagai rekening operasional utama?",
            {
              options: opts([
                [1, "Pernah"],
                [2, "Tidak pernah"],
              ]),
            },
          ),
          q("B5a", "multiple_choice", "Dari bank mana?", {
            showIf: all(eq("B5", 1)),
            options: BANKS,
            notSameAs: key("S5"),
          }),
          q(
            "B5b",
            "multiple_choice",
            "Berapa lama menggunakan bank tersebut sebagai rekening operasional utama?",
            {
              showIf: all(eq("B5", 1)),
              options: opts([
                [1, "Kurang dari 1 tahun"],
                [2, "1–3 tahun"],
                [3, "Lebih dari 3 tahun"],
              ]),
            },
          ),
          q("B5c", "multiple_choice", "Apa pemicunya?", {
            showIf: all(eq("B5", 1)),
            options: SWITCH_TRIGGERS,
          }),
          q(
            "B6",
            "checkboxes",
            "Fitur mobile banking apa saja yang dipakai untuk usaha dalam sebulan terakhir?",
            {
              options: opts([
                [1, "Transfer ke sesama bank"],
                [2, "Transfer antar bank"],
                [3, "Cek mutasi/saldo"],
                [4, "Menerima/cek QRIS merchant"],
                [5, "Bayar tagihan (listrik, air, internet)"],
                [6, "Top up e-wallet"],
                [7, "Pengajuan/angsuran pinjaman"],
                [8, "Tarik tunai tanpa kartu"],
                [9, "Investasi/deposito"],
                [10, "Notifikasi transaksi"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "B7",
            "multiple_choice",
            "Dalam seminggu, berapa kali transfer ke rekening bank lain untuk keperluan usaha?",
            {
              options: opts([
                [1, "Tidak pernah"],
                [2, "1–2 kali"],
                [3, "3–5 kali"],
                [4, "6–10 kali"],
                [5, "Lebih dari 10 kali"],
              ]),
            },
          ),
          q(
            "B8",
            "multiple_choice",
            "Dalam 12 bulan terakhir, apakah pernah berganti atau menambah bank untuk usaha?",
            {
              options: opts([
                [1, "Ya, pindah bank utama"],
                [2, "Ya, menambah bank"],
                [3, "Tidak"],
              ]),
            },
          ),
          q("B8a", "multiple_choice", "Ke bank mana?", {
            showIf: any(eq("B8", 1), eq("B8", 2)),
            options: BANKS,
          }),
          q("B8b", "checkboxes", "Apa pemicunya?", {
            showIf: any(eq("B8", 1), eq("B8", 2)),
            options: SWITCH_TRIGGERS,
          }),
          q(
            "B9",
            "checkboxes",
            "Dalam 3 bulan terakhir, apakah pernah mengunjungi cabang, ATM, atau agen bank terkait urusan usaha? Untuk apa?",
            {
              options: opts(
                [
                  [1, "Tidak pernah"],
                  [2, "Setor tunai"],
                  [3, "Tarik tunai"],
                  [4, "Urus pinjaman"],
                  [5, "Ganti kartu/PIN/aplikasi bermasalah"],
                  [6, "Komplain transaksi"],
                  [7, "Buka rekening/produk baru"],
                  [99, "Lainnya"],
                ],
                [1],
              ),
            },
          ),
        ],
      ),
      section(
        "sec_c",
        "Modul C — Pembayaran Digital, QRIS & EDC",
        "Penyedia QRIS dan EDC, alasan, kecepatan dana masuk, kendala, dan pemicu pindah.",
        [
          q(
            "C1",
            "checkboxes",
            "Metode pembayaran apa saja yang diterima dari pembeli?",
            {
              options: opts([
                [1, "Tunai"],
                [2, "QRIS"],
                [3, "Transfer bank"],
                [4, "Kartu debit/kredit (EDC)"],
                [5, "E-wallet tanpa QRIS"],
                [6, "Paylater"],
                [7, "Virtual account/link pembayaran"],
              ]),
            },
          ),
          q(
            "C2",
            "multiple_choice",
            "Dari total penjualan, kira-kira berapa bagian yang dibayar non-tunai?",
            {
              options: PERCENT_BANDS,
            },
          ),
          q("C3", "checkboxes", "QRIS dari penyedia mana saja yang dipasang?", {
            showIf: all(has("C1", 2)),
            options: QRIS,
          }),
          q(
            "C3U",
            "multiple_choice",
            "Dari QRIS yang dipasang, mana yang paling sering dipakai (QRIS utama)?",
            {
              showIf: all(has("C1", 2)),
              options: QRIS,
              optionsFrom: { questionKey: key("C3"), mode: "selected" },
            },
          ),
          q(
            "C3a",
            "multiple_choice",
            "Dari total penjualan, kira-kira berapa bagian yang dibayar menggunakan QRIS?",
            {
              showIf: all(has("C1", 2)),
              options: PERCENT_BANDS,
            },
          ),
          q("C3b", "checkboxes", "Mengapa belum memakai QRIS?", {
            showIf: all(hasNot("C1", 2)),
            options: opts([
              [1, "Tidak tahu caranya"],
              [2, "Pembeli tidak minta"],
              [3, "Khawatir biaya potongan"],
              [4, "Dana lama masuk"],
              [5, "Pernah ditolak/pendaftaran rumit"],
              [6, "Lebih suka tunai"],
              [99, "Lainnya"],
            ]),
            rules: [jump(key("C9"))],
          }),
          q(
            "C4",
            "ranking",
            "Mengapa memilih [C3U] sebagai QRIS utama? Sebutkan yang paling penting dulu.",
            {
              ranking: { max: 3 },
              noteRequired: true,
              options: opts([
                [1, "Dana langsung masuk rekening operasional"],
                [2, "Dana masuk cepat/real-time"],
                [3, "Biaya potongan kecil/gratis"],
                [4, "Mudah mendaftar"],
                [5, "Dipasangkan petugas bank/sales"],
                [6, "Pembeli banyak memakai aplikasi itu"],
                [7, "Ada laporan/dashboard penjualan"],
                [8, "Satu paket dengan aplikasi kasir"],
                [9, "Promo untuk pembeli"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "C5a",
            "multiple_choice",
            "Setelah pembeli bayar QRIS, berapa lama dana masuk ke rekening?",
            {
              options: opts([
                [1, "Seketika/real-time"],
                [2, "Beberapa jam, hari yang sama"],
                [3, "Hari berikutnya (H+1)"],
                [4, "Lebih dari H+1"],
                [97, "Tidak tahu"],
              ]),
            },
          ),
          q("C5b", "multiple_choice", "Apakah kecepatan itu sesuai harapan?", {
            options: opts([
              [1, "Sesuai"],
              [2, "Ingin lebih cepat"],
              [3, "Sangat mengganggu arus kas"],
            ]),
          }),
          q(
            "C6",
            "checkboxes",
            "Dalam 3 bulan terakhir, kendala apa yang dialami pada pembayaran non-tunai?",
            {
              options: opts(
                [
                  [1, "Tidak ada kendala"],
                  [2, "Transaksi gagal/pending saat ramai"],
                  [3, "Pembeli bilang sudah bayar tetapi dana tidak masuk"],
                  [4, "Sulit mencocokkan dana masuk dengan penjualan"],
                  [5, "Biaya potongan terasa berat"],
                  [6, "Tidak ada yang bisa dihubungi saat bermasalah"],
                  [7, "Jaringan/sinyal"],
                  [8, "Stiker QRIS dipalsukan/ditimpa"],
                  [99, "Lainnya"],
                ],
                [1],
              ),
            },
          ),
          q(
            "C7",
            "checkboxes",
            "Mengapa QRIS tidak dari bank yang sama dengan rekening operasional?",
            {
              showIf: all(notSame("C3U", "S5")),
              noteRequired: true,
              options: opts([
                [1, "Belum pernah ditawari"],
                [2, "Pendaftaran di bank itu rumit"],
                [3, "Dana masuk lebih lambat"],
                [4, "Biaya lebih tinggi"],
                [5, "Sudah terbiasa dengan penyedia lain"],
                [6, "Pembeli lebih kenal penyedia lain"],
                [7, "Penyedia lain satu paket dengan kasir/pesan-antar"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "C8",
            "multiple_choice",
            "Apakah pernah berganti penyedia QRIS utama?",
            {
              options: opts([
                [1, "Ya"],
                [2, "Tidak"],
              ]),
            },
          ),
          q("C8a", "checkboxes", "Apa pemicunya?", {
            showIf: all(eq("C8", 1)),
            noteRequired: true,
            options: opts([
              [1, "Dana sering tertahan"],
              [2, "Biaya potongan"],
              [3, "Aplikasi sulit/sering error"],
              [4, "Ditawari penyedia baru dengan promo"],
              [5, "Permintaan pembeli"],
              [6, "Pindah bank operasional"],
              [99, "Lainnya"],
            ]),
          }),
          q(
            "C9",
            "checkboxes",
            "Apakah usaha memakai mesin EDC (gesek/tap kartu)? Dari bank mana?",
            {
              options: opts(
                [
                  [1, "Tidak"],
                  [2, "BRI"],
                  [3, "BCA"],
                  [4, "Mandiri"],
                  [5, "BNI"],
                  [6, "BSI"],
                  [7, "CIMB Niaga"],
                  [8, "Agregator (Cashlez, Youtap, dll.)"],
                  [99, "Lainnya"],
                ],
                [1],
              ),
              rules: [jump(key("C11"), has("C9", 1))],
            },
          ),
          q("C10A", "checkboxes", "Apa pertimbangan utama memilih EDC itu?", {
            description: "Maksimal 2.",
            noteRequired: true,
            validation: { max: 2 },
            options: opts([
              [1, "Satu bank dengan rekening operasional"],
              [2, "Dipasangkan petugas bank"],
              [3, "Biaya MDR rendah"],
              [4, "Dana cepat masuk"],
              [5, "Pembeli sering pakai kartu"],
            ]),
          }),
          q("C10B", "checkboxes", "Kendala yang dirasakan pada EDC?", {
            description: "Maksimal 2.",
            validation: { max: 2 },
            options: opts(
              [
                [11, "Mesin sering gangguan"],
                [12, "Settlement lambat"],
                [13, "Biaya sewa/MDR"],
                [14, "Tidak ada kendala"],
              ],
              [14],
            ),
            rules: [jump("sec_d")],
          }),
          q(
            "C11",
            "multiple_choice",
            "Apakah berminat memakai EDC bila disediakan bank operasional?",
            {
              showIf: all(has("C9", 1)),
              options: opts([
                [1, "Ya"],
                [2, "Tidak, cukup QRIS"],
                [3, "Tidak, pembeli jarang pakai kartu"],
              ]),
            },
          ),
        ],
      ),
      section(
        "sec_d",
        "Modul D — Penyimpanan Dana (CASA) & Pembayaran Gaji",
        "Aliran dana setelah masuk rekening operasional: ke mana, seberapa cepat keluar, apa yang membuatnya mengendap, dan cara membayar gaji.",
        [
          q(
            "D1",
            "ranking",
            "Setelah hasil penjualan masuk ke rekening operasional, apa yang biasanya dilakukan dengan uang itu?",
            {
              ranking: { max: 3 },
              options: opts([
                [1, "Dibiarkan di rekening itu"],
                [2, "Dipindahkan ke rekening bank lain"],
                [3, "Dipindahkan ke rekening pribadi di bank yang sama"],
                [4, "Ditarik tunai"],
                [5, "Langsung dipakai bayar pemasok/belanja"],
                [6, "Dipindah ke e-wallet"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q("D1a", "multiple_choice", "Ke bank mana?", {
            showIf: all(has("D1", 2)),
            options: BANKS,
            notSameAs: key("S5"),
          }),
          q(
            "D2",
            "multiple_choice",
            "Seberapa sering dana dipindahkan atau ditarik dari rekening operasional?",
            {
              options: opts([
                [1, "Setiap hari"],
                [2, "Beberapa kali seminggu"],
                [3, "Seminggu sekali"],
                [4, "Beberapa kali sebulan"],
                [5, "Sebulan sekali atau lebih jarang"],
              ]),
            },
          ),
          q(
            "D3",
            "multiple_choice",
            "Dari uang yang masuk, kira-kira berapa bagian yang tetap berada di rekening operasional lebih dari seminggu?",
            {
              options: opts([
                [1, "Hampir tidak ada (kurang dari 10%)"],
                [2, "10–25%"],
                [3, "26–50%"],
                [4, "Lebih dari 50%"],
                [97, "Tidak tahu"],
              ]),
            },
          ),
          q(
            "D4",
            "checkboxes",
            "Di mana dana cadangan atau tabungan usaha disimpan?",
            {
              options: opts(
                [
                  [1, "Di rekening operasional yang sama"],
                  [2, "Rekening lain di bank yang sama"],
                  [3, "Rekening di bank lain"],
                  [4, "Tabungan pribadi"],
                  [5, "Tunai di rumah/toko"],
                  [6, "Emas/barang"],
                  [7, "Deposito/investasi"],
                  [8, "Tidak punya cadangan"],
                  [99, "Lainnya"],
                ],
                [8],
              ),
            },
          ),
          q("D4a", "multiple_choice", "Di bank mana?", {
            showIf: all(has("D4", 3)),
            options: BANKS,
            notSameAs: key("S5"),
          }),
          q(
            "D5",
            "ranking",
            "Mengapa menyimpan dana di tempat itu? Sebutkan yang paling penting dulu.",
            {
              ranking: { max: 3 },
              noteRequired: true,
              options: opts([
                [1, "Aman"],
                [2, "Bunga/bagi hasil"],
                [3, "Mudah ditarik kapan saja"],
                [4, "Terpisah dari uang operasional agar tidak terpakai"],
                [5, "Sudah ada pinjaman di bank itu"],
                [6, "Kebiasaan/sudah lama"],
                [7, "Bebas biaya admin"],
                [8, "Dekat rumah/toko"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "D6",
            "checkboxes",
            "Apa yang akan membuat Bapak/Ibu bersedia menyimpan lebih banyak dana di rekening operasional?",
            {
              options: opts(
                [
                  [1, "Bunga/imbal hasil lebih baik"],
                  [2, "Bebas biaya admin"],
                  [3, "Fitur pisah kantong (operasional, tabungan, pajak)"],
                  [4, "Saldo mengendap dihitung untuk pinjaman"],
                  [5, "Undian/hadiah/cashback"],
                  [6, "Notifikasi & laporan lebih jelas"],
                  [7, "Jaminan dana aman dari penipuan"],
                  [8, "Tidak ada yang bisa mengubah"],
                ],
                [8],
              ),
            },
          ),
          q(
            "D7",
            "multiple_choice",
            "Apakah rekening usaha dan pribadi dipisah?",
            {
              options: opts([
                [1, "Ya, rekening terpisah"],
                [2, "Tidak, tercampur satu rekening"],
                [3, "Terpisah sebagian"],
              ]),
            },
          ),
          q("D8", "checkboxes", "Bagaimana cara membayar gaji/upah pegawai?", {
            showIf: all(neq("A3", 1)),
            options: opts([
              [1, "Tunai"],
              [2, "Transfer dari rekening operasional"],
              [3, "Transfer dari rekening bank lain"],
              [4, "E-wallet"],
              [5, "Campuran tunai dan transfer"],
            ]),
          }),
          q(
            "D8a",
            "multiple_choice",
            "Apakah tertarik fitur gaji otomatis (payroll) dari bank operasional, misalnya jadwal transfer massal ke rekening pegawai?",
            {
              showIf: any(has("D8", 2), has("D8", 3)),
              options: opts([
                [1, "Ya"],
                [2, "Tidak, pegawai belum punya rekening"],
                [3, "Tidak, lebih nyaman tunai"],
                [4, "Tidak, jumlah pegawai sedikit"],
              ]),
            },
          ),
        ],
      ),
      section(
        "sec_e",
        "Modul E — Pinjaman",
        "Pengalaman, kebutuhan, dan preferensi sumber pembiayaan usaha.",
        [
          q(
            "E1",
            "multiple_choice",
            "Dalam 2 tahun terakhir, apakah pernah mengajukan pinjaman usaha ke bank? Bagaimana hasilnya?",
            {
              options: opts([
                [1, "Tidak pernah"],
                [2, "Diajukan, disetujui"],
                [3, "Diajukan, ditolak"],
                [4, "Diajukan, dibatalkan karena prosesnya"],
              ]),
            },
          ),
          q("E1a", "multiple_choice", "Bank yang menyetujui pinjaman", {
            showIf: all(eq("E1", 2)),
            options: BANKS,
          }),
          q(
            "E2",
            "checkboxes",
            "Dalam 12 bulan ke depan, apakah membutuhkan pembiayaan untuk usaha? Untuk apa?",
            {
              options: opts(
                [
                  [1, "Tidak"],
                  [2, "Modal kerja/stok"],
                  [3, "Renovasi/peralatan"],
                  [4, "Buka cabang"],
                  [5, "Kendaraan"],
                  [99, "Lainnya"],
                ],
                [1],
              ),
              rules: [jump("sec_f", has("E2", 1))],
            },
          ),
          q(
            "E3",
            "multiple_choice",
            "Jika butuh, ke mana akan mengajukan pertama kali?",
            {
              noteRequired: true,
              options: opts([
                [1, "Bank operasional utama"],
                [2, "BRI (KUR)"],
                [3, "Bank lain"],
                [4, "Koperasi/BPR"],
                [5, "Fintech/pinjol"],
                [6, "Keluarga"],
                [7, "Belum tahu"],
              ]),
            },
          ),
          q("E3_ALASAN", "checkboxes", "Mengapa ke sana?", {
            description: "Maksimal 2 alasan.",
            showIf: all(neq("E3", 7)),
            validation: { max: 2 },
            options: opts([
              [11, "Bunga rendah"],
              [12, "Proses cepat"],
              [13, "Tanpa agunan"],
              [14, "Sudah kenal petugas"],
              [15, "Riwayat transaksi di bank itu"],
            ]),
          }),
        ],
      ),
      section(
        "sec_f",
        "Modul F — Investasi",
        "Produk simpanan berjangka dan investasi yang dimiliki, kanal pembeliannya, dan minat membeli lewat aplikasi bank operasional.",
        [
          q(
            "F1",
            "checkboxes",
            "Produk simpanan atau investasi apa yang dimiliki saat ini, pribadi maupun usaha?",
            {
              options: opts(
                [
                  [1, "Tidak ada"],
                  [2, "Deposito"],
                  [3, "Emas (fisik/digital)"],
                  [4, "Reksa dana"],
                  [5, "Saham"],
                  [6, "SBN/sukuk ritel"],
                  [7, "Valas/forex"],
                  [8, "Kripto"],
                  [9, "Asuransi/unit link"],
                  [99, "Lainnya"],
                ],
                [1],
              ),
              rules: [jump(key("F3"), has("F1", 1))],
            },
          ),
          q("F2", "checkboxes", "Lewat kanal mana membelinya?", {
            options: opts([
              [1, "Aplikasi bank"],
              [
                2,
                "Aplikasi investasi non-bank (Bibit, Ajaib, Pluang, Pegadaian, dll.)",
              ],
              [3, "Cabang bank"],
              [4, "Toko emas/agen"],
              [99, "Lainnya"],
            ]),
          }),
          q(
            "F3",
            "checkboxes",
            "Dalam 12 bulan ke depan, produk mana yang ingin dimiliki atau ditambah?",
            {
              options: opts(
                [
                  [0, "Tidak ada"],
                  [2, "Deposito"],
                  [3, "Emas (fisik/digital)"],
                  [4, "Reksa dana"],
                  [5, "Saham"],
                  [6, "SBN/sukuk ritel"],
                  [7, "Valas/forex"],
                  [8, "Kripto"],
                  [9, "Asuransi/unit link"],
                ],
                [0],
              ),
            },
          ),
          q(
            "F3_APP",
            "multiple_choice",
            "Apakah tertarik membelinya lewat aplikasi bank operasional?",
            {
              showIf: all(hasNot("F3", 0)),
              options: opts([
                [1, "Ya"],
                [2, "Tidak"],
                [97, "Tidak tahu"],
              ]),
            },
          ),
        ],
      ),
      section(
        "sec_g",
        "Modul G — Kepentingan vs Kepuasan, CSAT, NPS",
        "Empat belas atribut dinilai dua kali (penting, lalu puas terhadap bank [S5]); skala dibacakan dan ditunjukkan dengan kartu bantu. Hasilnya menjadi matriks improve/maintain dan analisis driver.",
        [
          q(
            "G1",
            "grid",
            "Seberapa penting hal-hal berikut untuk usaha Bapak/Ibu? [kartu skala]",
            {
              options: opts([
                [1, "Tidak penting"],
                [2, "Kurang penting"],
                [3, "Cukup penting"],
                [4, "Penting"],
                [5, "Sangat penting"],
              ]),
              grid: {
                rows: ATTRIBUTES,
                multiple: false,
                randomizeRows: true,
                straightlining: true,
              },
            },
          ),
          q(
            "G2",
            "grid",
            "Untuk bank [S5], seberapa puas Bapak/Ibu pada hal yang sama? [kartu skala]",
            {
              orderLike: key("G1"),
              options: opts([
                [1, "Sangat tidak puas"],
                [2, "Tidak puas"],
                [3, "Biasa saja"],
                [4, "Puas"],
                [5, "Sangat puas"],
                [97, "Tidak pernah pakai"],
              ]),
              grid: {
                rows: ATTRIBUTES,
                multiple: false,
                randomizeRows: true,
                straightlining: true,
                maxPerColumn: [{ optionId: "c97", max: 4 }],
              },
            },
          ),
          q(
            "G3",
            "multiple_choice",
            "Secara keseluruhan, seberapa puas Bapak/Ibu dengan bank [S5] untuk keperluan usaha? [kartu skala 1–7]",
            {
              options: opts([
                [1, "Tidak puas sama sekali"],
                [2, "Sangat tidak puas"],
                [3, "Tidak puas"],
                [4, "Netral"],
                [5, "Cukup puas"],
                [6, "Puas"],
                [7, "Sangat puas"],
              ]),
            },
          ),
          q(
            "G4",
            "linear_scale",
            "Seberapa besar kemungkinan Bapak/Ibu merekomendasikan bank [S5] kepada sesama pelaku usaha? [kartu skala 0–10]",
            {
              scale: {
                min: 0,
                max: 10,
                minLabel: "Sangat tidak mungkin",
                maxLabel: "Sangat mungkin",
              },
            },
          ),
          q(
            "G5",
            "dropdown",
            "Dari semua hal tadi, satu hal apa yang paling ingin diperbaiki dari bank [S5]?",
            {
              noteRequired: true,
              options: [
                ...ATTRIBUTES.map((a) => ({ ...a, id: `c${a.code}` })),
                opt(15, "Tidak ada"),
                opt(99, "Lainnya"),
              ],
            },
          ),
          q(
            "G6",
            "checkboxes",
            "Layanan apa yang dibutuhkan usaha tetapi belum disediakan bank mana pun?",
            {
              noteRequired: true,
              options: opts(
                [
                  [1, "Pinjaman cepat tanpa agunan berbasis omzet"],
                  [2, "Pembukuan/laporan penjualan otomatis"],
                  [3, "Pisah kantong usaha-pribadi"],
                  [4, "Pembayaran pemasok terjadwal"],
                  [5, "Gaji karyawan otomatis"],
                  [6, "Asuransi usaha/kesehatan karyawan"],
                  [7, "Bantuan pemasaran/promo pembeli"],
                  [8, "Pendampingan usaha/pelatihan"],
                  [9, "Tidak ada"],
                  [99, "Lainnya"],
                ],
                [9],
              ),
            },
          ),
        ],
      ),
      section(
        "sec_h",
        "Modul H — Persepsi BRI & Switching",
        "H1, H2, H9 untuk semua responden; H3–H5 hanya segmen N (Non-BRI); H6–H8 hanya segmen B (Nasabah BRI).",
        [
          q(
            "H1",
            "grid",
            "Apakah Bapak/Ibu mengenal layanan BRI berikut? [satu per satu]",
            {
              options: opts([
                [1, "Tidak tahu"],
                [2, "Tahu tapi tidak pernah pakai"],
                [3, "Pernah pakai, sudah tidak"],
                [4, "Masih pakai"],
              ]),
              grid: {
                multiple: false,
                rows: opts([
                  [1, "BRImo"],
                  [2, "QRIS BRI"],
                  [3, "Agen BRILink"],
                  [4, "KUR BRI"],
                  [5, "Rekening usaha BRI"],
                  [6, "BRI Merchant/EDC"],
                ]).map((r) => ({ ...r, id: `r${r.code}` })),
              },
            },
          ),
          q(
            "H2",
            "checkboxes",
            'Kalau mendengar "BRI untuk usaha saya", apa yang terlintas?',
            {
              description: "Pilih maksimal 3.",
              noteRequired: true,
              validation: { max: 3 },
              options: opts(
                [
                  [1, "Bank rakyat, dekat dengan UMKM"],
                  [2, "Aman dan terpercaya"],
                  [3, "Cabang/agen di mana-mana"],
                  [4, "Cocok untuk pinjaman/KUR"],
                  [5, "Biaya murah"],
                  [6, "Aplikasi kurang modern/sering gangguan"],
                  [7, "Antre lama di cabang"],
                  [8, "Bank orang tua/kampung"],
                  [9, "Tidak ada kesan khusus"],
                  [99, "Lainnya"],
                ],
                [9],
              ),
            },
          ),
          q(
            "H3",
            "grid",
            "Dibanding bank [S5], menurut Bapak/Ibu BRI lebih baik, sama, atau lebih buruk dalam hal berikut?",
            {
              showIf: all(NON_BRI),
              options: opts([
                [1, "BRI lebih baik"],
                [2, "Sama saja"],
                [3, "BRI lebih buruk"],
                [97, "Tidak tahu"],
              ]),
              grid: {
                multiple: false,
                rows: opts([
                  [1, "Biaya"],
                  [2, "Aplikasi mobile"],
                  [3, "QRIS"],
                  [4, "Jaringan cabang/ATM/agen"],
                  [5, "Pinjaman"],
                  [6, "Layanan petugas"],
                ]).map((r) => ({ ...r, id: `r${r.code}` })),
              },
            },
          ),
          q(
            "H4",
            "ranking",
            "Mengapa BRI belum menjadi bank operasional utama? Sebutkan yang paling penting dulu.",
            {
              showIf: all(NON_BRI),
              ranking: { max: 3 },
              noteRequired: true,
              options: opts([
                [1, "Tidak merasa perlu, sudah cukup dengan bank sekarang"],
                [2, "Pembeli/pemasok memakai bank lain"],
                [3, "Aplikasi BRImo kurang nyaman"],
                [4, "Biaya"],
                [5, "Pernah pengalaman buruk"],
                [6, "Tidak pernah ditawari"],
                [7, "Cabang/ATM BRI jauh"],
                [8, "Malas pindah/repot"],
                [9, "Rekening pribadi di bank lain"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "H5",
            "checkboxes",
            "Apa yang akan membuat Bapak/Ibu memindahkan rekening operasional ke BRI?",
            {
              showIf: all(NON_BRI),
              options: opts(
                [
                  [1, "Dana QRIS masuk seketika"],
                  [2, "Bebas biaya transfer antarbank"],
                  [3, "Akses pinjaman/KUR lebih mudah"],
                  [4, "Petugas datang membantu daftar"],
                  [5, "Promo/cashback untuk pembeli"],
                  [6, "Aplikasi lebih lancar"],
                  [7, "Bebas biaya admin"],
                  [8, "Tidak ada yang bisa membuat pindah"],
                ],
                [8],
              ),
            },
          ),
          q(
            "H6",
            "ranking",
            "Mengapa tetap memakai BRI sebagai bank operasional? Sebutkan yang paling penting dulu.",
            {
              showIf: all(IS_BRI),
              ranking: { max: 3 },
              noteRequired: true,
              options: opts([
                [1, "Cabang/agen/ATM dekat"],
                [2, "Pembeli/pemasok memakai BRI"],
                [3, "Sudah punya KUR/pinjaman"],
                [4, "Aplikasi BRImo cukup"],
                [5, "Biaya murah"],
                [6, "Sudah lama, malas pindah"],
                [7, "Rekening pribadi di BRI"],
                [8, "Petugas BRI aktif membantu"],
                [9, "Aman/terpercaya"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "H7",
            "multiple_choice",
            "Dalam 12 bulan terakhir, apakah pernah mempertimbangkan pindah ke bank lain?",
            {
              showIf: all(IS_BRI),
              options: opts([
                [1, "Ya"],
                [2, "Tidak"],
              ]),
            },
          ),
          q("H7a", "multiple_choice", "Ke bank mana?", {
            showIf: all(eq("H7", 1)),
            options: BANKS,
            notSameAs: key("S5"),
          }),
          q("H7b", "checkboxes", "Apa alasannya?", {
            showIf: all(eq("H7", 1)),
            noteRequired: true,
            options: opts([
              [1, "Biaya lebih murah"],
              [2, "Aplikasi lebih lancar"],
              [3, "QRIS lebih cepat masuk"],
              [4, "Promo/bunga"],
              [5, "Pembeli memakai bank itu"],
              [6, "Pinjaman lebih mudah"],
              [7, "Pengalaman buruk di BRI"],
              [99, "Lainnya"],
            ]),
          }),
          q(
            "H8",
            "multiple_choice",
            "Satu hal apa yang paling mengganggu dari layanan BRI saat ini?",
            {
              showIf: all(IS_BRI),
              noteRequired: true,
              options: opts([
                [1, "Aplikasi lambat/error"],
                [2, "Biaya transfer"],
                [3, "Antre di cabang"],
                [4, "CS/petugas lambat menanggapi"],
                [5, "Dana QRIS tertahan"],
                [6, "Limit transaksi"],
                [7, "Notifikasi/laporan kurang jelas"],
                [8, "Tidak ada"],
                [99, "Lainnya"],
              ]),
            },
          ),
          q(
            "H9",
            "checkboxes",
            "Dalam 6 bulan terakhir, apakah pernah didatangi atau ditawari petugas bank untuk layanan usaha? Bank mana?",
            {
              options: opts(
                [
                  [1, "Tidak pernah"],
                  [2, "BRI"],
                  [3, "BCA"],
                  [4, "Mandiri"],
                  [5, "BNI"],
                  [6, "BSI"],
                  [7, "Bank digital"],
                  [8, "Penyedia QRIS non-bank"],
                  [99, "Lainnya"],
                ],
                [1],
              ),
            },
          ),
        ],
      ),
      section(
        "sec_i",
        "Modul I — Uji Konsep Value Proposition",
        `Enam konsep dibacakan satu per satu dari kartu konsep, urutan diacak; tiap konsep dinilai daya tarik dan niat pakai, lalu dipilih yang paling diinginkan. Daftar konsep bersifat usulan dan dikunci bersama BRI sebelum pilot.\n\n${CONCEPT_CARDS}`,
        [
          q(
            "I1",
            "grid",
            "Seberapa menarik layanan ini untuk usaha Bapak/Ibu? [kartu konsep, kartu skala]",
            {
              options: opts([
                [1, "Sangat tidak menarik"],
                [2, "Tidak menarik"],
                [3, "Biasa saja"],
                [4, "Menarik"],
                [5, "Sangat menarik"],
              ]),
              grid: {
                rows: CONCEPTS.map((c) => ({ ...c, id: `r${c.code}` })),
                multiple: false,
                randomizeRows: true,
                straightlining: true,
              },
            },
          ),
          q(
            "I2",
            "grid",
            "Jika layanan ini tersedia di BRI, seberapa mungkin Bapak/Ibu akan memakainya?",
            {
              orderLike: key("I1"),
              options: opts([
                [1, "Pasti tidak"],
                [2, "Mungkin tidak"],
                [3, "Ragu-ragu"],
                [4, "Mungkin ya"],
                [5, "Pasti ya"],
              ]),
              grid: {
                rows: CONCEPTS.map((c) => ({ ...c, id: `r${c.code}` })),
                multiple: false,
                randomizeRows: true,
                straightlining: true,
              },
            },
          ),
          q(
            "I3a",
            "multiple_choice",
            "Dari enam layanan tadi, mana yang paling Bapak/Ibu inginkan?",
            {
              options: CONCEPTS,
            },
          ),
          q(
            "I3b",
            "multiple_choice",
            "Mana yang paling tidak relevan untuk usaha Bapak/Ibu?",
            {
              options: [...CONCEPTS, opt(7, "Semua relevan")],
            },
          ),
          q(
            "I4",
            "multiple_choice",
            "Jika layanan pilihan di I3a ([I3a]) hanya ada di BRI, apakah Bapak/Ibu akan memindahkan rekening operasional ke BRI?",
            {
              showIf: all(NON_BRI),
              options: opts([
                [1, "Pasti pindah"],
                [2, "Mungkin pindah"],
                [3, "Menambah BRI tanpa pindah"],
                [4, "Tidak pindah"],
              ]),
            },
          ),
          q(
            "I4b",
            "multiple_choice",
            "Jika layanan pilihan di I3a ([I3a]) tersedia di BRI, apakah akan menambah porsi transaksi/dana di BRI?",
            {
              showIf: all(IS_BRI),
              options: opts([
                [1, "Pasti"],
                [2, "Mungkin"],
                [3, "Tidak berubah"],
              ]),
            },
          ),
          q(
            "I5",
            "multiple_choice",
            "Berapa biaya bulanan maksimum yang wajar untuk layanan pilihan tersebut?",
            {
              options: opts([
                [1, "Harus gratis"],
                [2, "Kurang dari Rp25 ribu"],
                [3, "Rp25–50 ribu"],
                [4, "Rp50–100 ribu"],
                [5, "Lebih dari Rp100 ribu"],
              ]),
            },
          ),
        ],
      ),
      section(
        "sec_j",
        "Modul J — Demografi, Penutup, Catatan Surveyor",
        "Pertanyaan ringan di akhir; J4–J6 diisi surveyor setelah berpamitan. J7 (durasi) dicatat otomatis oleh aplikasi.",
        [
          q("J1", "multiple_choice", "Jenis kelamin (dicatat surveyor)", {
            options: opts([
              [1, "Laki-laki"],
              [2, "Perempuan"],
            ]),
          }),
          q(
            "J2",
            "multiple_choice",
            "Siapa yang sehari-hari mengoperasikan mobile banking usaha?",
            {
              options: opts([
                [1, "Sendiri"],
                [2, "Pasangan/keluarga"],
                [3, "Karyawan/kasir"],
                [4, "Bergantian"],
              ]),
            },
          ),
          q(
            "J3",
            "multiple_choice",
            "Bolehkah kami menghubungi Bapak/Ibu untuk verifikasi singkat lewat telepon?",
            {
              options: opts([
                [1, "Ya"],
                [2, "Tidak"],
              ]),
            },
          ),
          q("J3_NOMOR", "phone", "Nomor telepon untuk verifikasi", {
            showIf: all(eq("J3", 1)),
            placeholder: "0812 3456 7890",
          }),
          q(
            "J3a",
            "multiple_choice",
            "Cendera mata diserahkan dan diterima (dicatat surveyor)",
            {
              options: opts([
                [1, "Ya"],
                [2, "Ditolak"],
              ]),
            },
          ),
          q("J4_GPS", "location", "Bukti lokasi: GPS otomatis", {
            required: false,
            description:
              "Diambil otomatis; jika gagal, tekan Ambil ulang di luar bangunan.",
          }),
          q(
            "J4",
            "multiple_choice",
            "Bukti lokasi: foto tampak depan tanpa wajah",
            {
              options: opts([
                [1, "Foto diambil"],
                [2, "Responden menolak foto (P2)"],
              ]),
            },
          ),
          q("J4_FOTO", "photo", "Foto tampak depan usaha (tanpa wajah)", {
            showIf: all(eq("J4", 1)),
          }),
          q(
            "J5",
            "checkboxes",
            "Stiker/papan QRIS atau EDC yang terlihat di kasir (observasi surveyor)",
            {
              options: [...QRIS, opt(0, "Tidak terlihat", true)],
            },
          ),
          q("J6", "checkboxes", "Kondisi wawancara (observasi surveyor)", {
            description: "Jika jawaban diragukan, jelaskan di catatan.",
            options: opts(
              [
                [1, "Lancar"],
                [2, "Sering terputus melayani pembeli"],
                [3, "Dibantu orang lain menjawab"],
                [4, "Responden terburu-buru"],
                [5, "Jawaban diragukan"],
              ],
              [1],
            ),
          }),
        ],
      ),
    ],
  };
}

/** Quota: 5 cities x 2 sectors x 2 segments = 20 cells of 20 (+2 reserve). */
export function briUmkmCapiSettings(): CapiSettings {
  return {
    enabled: true,
    notes: true,
    dimensions: [
      {
        id: "city",
        label: "Kota",
        questionKey: key("S10"),
        groups: [
          { code: "JKT", label: "Jakarta", optionIds: ["c1"] },
          { code: "SBY", label: "Surabaya", optionIds: ["c2"] },
          { code: "BDG", label: "Bandung", optionIds: ["c3"] },
          { code: "SMG", label: "Semarang", optionIds: ["c4"] },
          { code: "YGY", label: "Yogyakarta", optionIds: ["c5"] },
        ],
      },
      {
        id: "sector",
        label: "Sektor",
        questionKey: key("S2"),
        groups: [
          { code: "R", label: "Retail", optionIds: ["c1"] },
          { code: "F", label: "F&B", optionIds: ["c2"] },
        ],
      },
      {
        id: "segment",
        label: "Segmen",
        questionKey: key("S5"),
        groups: [
          { code: "B", label: "Nasabah BRI", optionIds: ["c1"] },
          {
            code: "N",
            label: "Non-BRI",
            optionIds: ["c2", "c3", "c4", "c5", "c6", "c7", "c8", "c99"],
          },
        ],
      },
    ],
    quota: { enabled: true, target: 20, reserve: 2, checkAfter: key("S10") },
    respondentId: { enabled: true, digits: 2 },
    qc: {
      minMinutes: 12,
      maxMinutes: 45,
      backcheckPercent: 20,
      otherPercent: 15,
    },
  };
}

export const briKey = key;

/**
 * Built-in templates. Structure is defined once; text is localized per
 * locale (chosen at creation time). Instantiation assigns fresh ids/keys.
 * The non-blank templates mix question types and conditional rules so they
 * double as dashboard test data.
 */
import type { Locale } from "@/lib/i18n/routing";
import { cloneDefinitionWithNewKeys } from "./operations";
import type { FormDefinition, Option, Question, Section } from "./schema";

export const TEMPLATE_IDS = [
  "blank",
  "customer_satisfaction",
  "event_registration",
  "employee_feedback",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(value: unknown): value is TemplateId {
  return (
    typeof value === "string" &&
    (TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

export type TemplateContent = {
  title: string;
  description?: string;
  thankYouMessage?: string;
  definition: FormDefinition;
};

type Q = Omit<Question, "id" | "required"> & { required?: boolean };

function q(spec: Q): Question {
  return { id: `q_${spec.key}`, required: false, ...spec };
}

function opts(...pairs: [string, string][]): Option[] {
  return pairs.map(([id, label]) => ({ id, label }));
}

function section(
  id: string,
  title: string,
  questions: Question[],
  description?: string,
): Section {
  return { id, title, ...(description ? { description } : {}), questions };
}

function def(...sections: Section[]): FormDefinition {
  return { schemaVersion: 1, sections };
}

const t = <T>(en: T, id: T) => ({ en, id });
type L<T> = { en: T; id: T };
const pick = <T>(value: L<T>, locale: Locale) => value[locale];

function blank(locale: Locale): TemplateContent {
  const s = {
    title: t("Untitled form", "Formulir tanpa judul"),
    section: t("Section 1", "Bagian 1"),
    question: t("Untitled question", "Pertanyaan tanpa judul"),
  };
  return {
    title: pick(s.title, locale),
    definition: def(
      section("s_main", pick(s.section, locale), [
        q({
          key: "question1",
          type: "short_text",
          title: pick(s.question, locale),
        }),
      ]),
    ),
  };
}

function customerSatisfaction(locale: Locale): TemplateContent {
  const x = <T>(en: T, id: T) => pick(t(en, id), locale);
  return {
    title: x("Customer Satisfaction Survey", "Survei Kepuasan Pelanggan"),
    description: x(
      "Tell us about your experience. It takes about 3 minutes.",
      "Ceritakan pengalaman Anda. Hanya sekitar 3 menit.",
    ),
    thankYouMessage: x(
      "Thank you for your feedback!",
      "Terima kasih atas masukan Anda!",
    ),
    definition: def(
      section("s_about", x("About you", "Tentang Anda"), [
        q({
          key: "name",
          type: "short_text",
          title: x("Your name", "Nama Anda"),
        }),
        q({
          key: "email",
          type: "email",
          title: x("Email address", "Alamat email"),
          description: x(
            "Only used to follow up on your feedback.",
            "Hanya untuk menindaklanjuti masukan Anda.",
          ),
        }),
        q({
          key: "visit_date",
          type: "date",
          title: x("Date of your last visit", "Tanggal kunjungan terakhir"),
        }),
        q({
          key: "visits",
          type: "number",
          title: x(
            "How many times did you visit us this year?",
            "Berapa kali Anda berkunjung tahun ini?",
          ),
          validation: { min: 0, max: 365, integerOnly: true },
        }),
      ]),
      section("s_experience", x("Your experience", "Pengalaman Anda"), [
        q({
          key: "overall",
          type: "rating",
          title: x(
            "Overall, how satisfied are you?",
            "Secara keseluruhan, seberapa puas Anda?",
          ),
          required: true,
          rating: { max: 5 },
        }),
        q({
          key: "nps",
          type: "linear_scale",
          title: x(
            "How likely are you to recommend us to a friend?",
            "Seberapa mungkin Anda merekomendasikan kami kepada teman?",
          ),
          required: true,
          scale: {
            min: 0,
            max: 10,
            minLabel: x("Not at all likely", "Sangat tidak mungkin"),
            maxLabel: x("Extremely likely", "Sangat mungkin"),
          },
        }),
        q({
          key: "products",
          type: "checkboxes",
          title: x(
            "Which products did you use?",
            "Produk apa saja yang Anda gunakan?",
          ),
          options: opts(
            ["web", x("Website", "Situs web")],
            ["app", x("Mobile app", "Aplikasi seluler")],
            ["store", x("Physical store", "Toko fisik")],
            ["support", x("Customer support", "Layanan pelanggan")],
          ),
          allowOther: true,
        }),
        q({
          key: "channel",
          type: "dropdown",
          title: x(
            "How did you hear about us?",
            "Dari mana Anda mengetahui kami?",
          ),
          options: opts(
            ["social", x("Social media", "Media sosial")],
            ["friend", x("Friend or family", "Teman atau keluarga")],
            ["search", x("Search engine", "Mesin pencari")],
            ["ads", x("Advertisement", "Iklan")],
          ),
        }),
        q({
          key: "improve",
          type: "paragraph",
          title: x("What should we improve?", "Apa yang perlu kami perbaiki?"),
          required: true,
          showIf: {
            combinator: "and",
            conditions: [{ questionKey: "overall", operator: "lt", value: 3 }],
          },
        }),
        q({
          key: "liked",
          type: "paragraph",
          title: x("What did you like most?", "Apa yang paling Anda sukai?"),
          showIf: {
            combinator: "and",
            conditions: [{ questionKey: "overall", operator: "gt", value: 3 }],
          },
        }),
        q({
          key: "contact_ok",
          type: "multiple_choice",
          title: x(
            "May we contact you about your answers?",
            "Bolehkah kami menghubungi Anda terkait jawaban ini?",
          ),
          required: true,
          options: opts(["yes", x("Yes", "Ya")], ["no", x("No", "Tidak")]),
        }),
        q({
          key: "phone",
          type: "phone",
          title: x("Phone number", "Nomor telepon"),
          required: true,
          showIf: {
            combinator: "and",
            conditions: [
              { questionKey: "contact_ok", operator: "equals", value: "yes" },
            ],
          },
        }),
      ]),
    ),
  };
}

function eventRegistration(locale: Locale): TemplateContent {
  const x = <T>(en: T, id: T) => pick(t(en, id), locale);
  return {
    title: x("Event Registration", "Pendaftaran Acara"),
    description: x(
      "Reserve your seat for our upcoming event.",
      "Amankan kursi Anda untuk acara kami.",
    ),
    thankYouMessage: x(
      "You're registered! We'll email your ticket soon.",
      "Pendaftaran berhasil! Tiket akan kami kirim lewat email.",
    ),
    definition: def(
      section("s_attendee", x("Attendee details", "Data peserta"), [
        q({
          key: "full_name",
          type: "short_text",
          title: x("Full name", "Nama lengkap"),
          required: true,
          validation: { minLength: 2, maxLength: 100 },
        }),
        q({
          key: "email",
          type: "email",
          title: x("Email", "Email"),
          required: true,
        }),
        q({
          key: "phone",
          type: "phone",
          title: x("Phone number", "Nomor telepon"),
          required: true,
        }),
        q({
          key: "organization",
          type: "short_text",
          title: x("Organization", "Organisasi"),
        }),
      ]),
      section("s_ticket", x("Ticket and sessions", "Tiket dan sesi"), [
        q({
          key: "ticket",
          type: "multiple_choice",
          title: x("Ticket type", "Jenis tiket"),
          required: true,
          options: opts(
            ["regular", x("Regular", "Reguler")],
            ["student", x("Student", "Pelajar/Mahasiswa")],
            ["vip", "VIP"],
          ),
        }),
        q({
          key: "student_id",
          type: "short_text",
          title: x("Student ID number", "Nomor induk pelajar/mahasiswa"),
          required: true,
          validation: { pattern: "[A-Za-z0-9-]{4,20}" },
          showIf: {
            combinator: "and",
            conditions: [
              { questionKey: "ticket", operator: "equals", value: "student" },
            ],
          },
        }),
        q({
          key: "sessions",
          type: "checkboxes",
          title: x(
            "Which sessions will you attend?",
            "Sesi mana yang akan Anda ikuti?",
          ),
          required: true,
          validation: { min: 1, max: 3 },
          options: opts(
            ["keynote", x("Opening keynote", "Pembukaan utama")],
            ["workshop", x("Hands-on workshop", "Lokakarya praktik")],
            ["panel", x("Panel discussion", "Diskusi panel")],
            ["networking", x("Networking dinner", "Makan malam networking")],
          ),
        }),
        q({
          key: "dietary",
          type: "dropdown",
          title: x("Dietary preference", "Preferensi makanan"),
          options: opts(
            ["none", x("No preference", "Tidak ada")],
            ["vegetarian", x("Vegetarian", "Vegetarian")],
            ["halal", "Halal"],
            ["gluten_free", x("Gluten-free", "Bebas gluten")],
          ),
          allowOther: true,
          showIf: {
            combinator: "and",
            conditions: [
              {
                questionKey: "sessions",
                operator: "contains",
                value: "networking",
              },
            ],
          },
        }),
        q({
          key: "guests",
          type: "number",
          title: x("Number of additional guests", "Jumlah tamu tambahan"),
          validation: { min: 0, max: 5, integerOnly: true },
        }),
        q({
          key: "arrival",
          type: "date",
          title: x("Arrival date", "Tanggal kedatangan"),
        }),
      ]),
      section("s_extra", x("Anything else?", "Ada lagi?"), [
        q({
          key: "accessibility",
          type: "multiple_choice",
          title: x(
            "Do you need accessibility support?",
            "Apakah Anda memerlukan dukungan aksesibilitas?",
          ),
          options: opts(["yes", x("Yes", "Ya")], ["no", x("No", "Tidak")]),
        }),
        q({
          key: "accessibility_details",
          type: "paragraph",
          title: x("Tell us what you need", "Ceritakan kebutuhan Anda"),
          required: true,
          showIf: {
            combinator: "and",
            conditions: [
              {
                questionKey: "accessibility",
                operator: "equals",
                value: "yes",
              },
            ],
          },
        }),
        q({
          key: "comments",
          type: "paragraph",
          title: x("Comments or questions", "Komentar atau pertanyaan"),
        }),
      ]),
    ),
  };
}

function employeeFeedback(locale: Locale): TemplateContent {
  const x = <T>(en: T, id: T) => pick(t(en, id), locale);
  return {
    title: x("Employee Feedback", "Umpan Balik Karyawan"),
    description: x(
      "Anonymous feedback to help us build a better workplace.",
      "Umpan balik anonim untuk membangun tempat kerja yang lebih baik.",
    ),
    thankYouMessage: x(
      "Thanks for helping us improve.",
      "Terima kasih telah membantu kami menjadi lebih baik.",
    ),
    definition: def(
      section("s_role", x("Your role", "Peran Anda"), [
        q({
          key: "department",
          type: "dropdown",
          title: x("Department", "Departemen"),
          required: true,
          options: opts(
            ["engineering", x("Engineering", "Teknik")],
            ["sales", x("Sales", "Penjualan")],
            ["operations", x("Operations", "Operasional")],
            ["hr", x("People & HR", "SDM")],
            ["finance", x("Finance", "Keuangan")],
          ),
        }),
        q({
          key: "tenure",
          type: "multiple_choice",
          title: x(
            "How long have you worked here?",
            "Sudah berapa lama Anda bekerja di sini?",
          ),
          required: true,
          options: opts(
            ["lt1", x("Less than 1 year", "Kurang dari 1 tahun")],
            ["1to3", x("1–3 years", "1–3 tahun")],
            ["3to5", x("3–5 years", "3–5 tahun")],
            ["gt5", x("More than 5 years", "Lebih dari 5 tahun")],
          ),
        }),
      ]),
      section("s_feedback", x("Your feedback", "Umpan balik Anda"), [
        q({
          key: "satisfaction",
          type: "linear_scale",
          title: x(
            "How satisfied are you with your job?",
            "Seberapa puas Anda dengan pekerjaan Anda?",
          ),
          required: true,
          scale: {
            min: 1,
            max: 5,
            minLabel: x("Very dissatisfied", "Sangat tidak puas"),
            maxLabel: x("Very satisfied", "Sangat puas"),
          },
        }),
        q({
          key: "manager",
          type: "rating",
          title: x(
            "Rate the support from your manager",
            "Nilai dukungan dari atasan Anda",
          ),
          required: true,
          rating: { max: 5 },
        }),
        q({
          key: "worklife",
          type: "checkboxes",
          title: x(
            "What helps your work-life balance?",
            "Apa yang membantu keseimbangan kerja Anda?",
          ),
          options: opts(
            ["remote", x("Remote work", "Kerja jarak jauh")],
            ["flexible", x("Flexible hours", "Jam kerja fleksibel")],
            ["leave", x("Paid leave", "Cuti berbayar")],
            ["wellness", x("Wellness programs", "Program kesehatan")],
          ),
          allowOther: true,
        }),
        q({
          key: "recommend",
          type: "multiple_choice",
          title: x(
            "Would you recommend this company as a place to work?",
            "Apakah Anda akan merekomendasikan perusahaan ini sebagai tempat kerja?",
          ),
          required: true,
          options: opts(
            ["yes", x("Yes", "Ya")],
            ["maybe", x("Maybe", "Mungkin")],
            ["no", x("No", "Tidak")],
          ),
        }),
        q({
          key: "concern",
          type: "paragraph",
          title: x(
            "What is the main thing we should change?",
            "Apa hal utama yang perlu kami ubah?",
          ),
          required: true,
          showIf: {
            combinator: "or",
            conditions: [
              { questionKey: "satisfaction", operator: "lt", value: 3 },
              { questionKey: "manager", operator: "lt", value: 3 },
              { questionKey: "recommend", operator: "equals", value: "no" },
            ],
          },
        }),
        q({
          key: "ideas",
          type: "paragraph",
          title: x("Any other ideas?", "Ada ide lain?"),
        }),
      ]),
    ),
  };
}

const BUILDERS: Record<TemplateId, (locale: Locale) => TemplateContent> = {
  blank,
  customer_satisfaction: customerSatisfaction,
  event_registration: eventRegistration,
  employee_feedback: employeeFeedback,
};

/** Raw template (stable symbolic ids). Use instantiateTemplate() to create forms. */
export function getTemplate(id: TemplateId, locale: Locale): TemplateContent {
  return BUILDERS[id](locale);
}

/** Template content with fresh section ids, question ids and keys. */
export function instantiateTemplate(
  id: TemplateId,
  locale: Locale,
): TemplateContent {
  const template = getTemplate(id, locale);
  return {
    ...template,
    definition: cloneDefinitionWithNewKeys(template.definition),
  };
}

export function templateQuestionCount(id: TemplateId): number {
  return getTemplate(id, "en").definition.sections.reduce(
    (n, s) => n + s.questions.length,
    0,
  );
}

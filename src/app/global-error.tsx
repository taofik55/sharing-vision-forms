"use client";

// Last resort when the root layout itself fails: no i18n or theme available,
// so the message is static and bilingual.
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="id">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          padding: "4rem 1rem",
          textAlign: "center",
        }}
      >
        <h1>Terjadi kesalahan / Something went wrong</h1>
        <p>
          Muat ulang halaman atau coba lagi nanti. / Reload the page or try
          again later.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
        >
          Coba lagi / Try again
        </button>
      </body>
    </html>
  );
}

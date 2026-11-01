// Neutral application entry: no customer data, no device parameters, no
// credentials — the dashboard surfaces land with M03/M04 behind the BFF.
export default function Home() {
  return (
    <section aria-labelledby="app-title">
      <h1 id="app-title">GenieACS PWA</h1>
      <p>
        Dashboard perangkat akan tersedia setelah autentikasi dikonfigurasi.
      </p>
    </section>
  );
}

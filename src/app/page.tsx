import en from '@/i18n/en.json';

// Placeholder until the walking skeleton in Phase 3 replaces it.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[560px] flex-col justify-center gap-2 px-4">
      <h1 className="text-2xl font-bold text-brand">{en.app.name}</h1>
      <p className="text-ink-muted">{en.app.tagline}</p>
    </main>
  );
}

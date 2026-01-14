// src/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <header className="flex flex-col gap-2">
          <div className="text-xs font-medium text-muted">Sargenteante</div>

          <h1 className="text-2xl font-semibold tracking-tight">
            Sistema de Escalas
          </h1>

         
        </header>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Link
            href="/scales"
            className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="text-sm font-semibold">Escalas</div>
            
            <div className="mt-4 text-xs font-medium">Abrir →</div>
          </Link>

          <Link
            href="/militars"
            className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="text-sm font-semibold">Militares</div>
           
            <div className="mt-4 text-xs font-medium">Abrir →</div>
          </Link>

          <Link
            href="/scales"
            className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="text-sm font-semibold">Planilha</div>
            
            <div className="mt-4 text-xs font-medium">Ir para escalas →</div>
          </Link>
        </div>

      
      </div>
    </div>
  );
}

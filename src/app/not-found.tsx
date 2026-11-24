import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-slate-50 p-5 text-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 sm:p-10">
        <p className="text-sm font-semibold text-teal-800">Pediturno</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">No encontramos esta página</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          Volvé al inicio para encontrar los servicios, las canchas o los espacios que buscabas.
        </p>
        <Link
          href="/"
          prefetch={false}
          className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-800"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}

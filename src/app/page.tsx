import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <div className="text-center space-y-6 px-4">
        <div className="text-6xl mb-4">$</div>
        <h1 className="text-5xl font-bold">Gastos de casa</h1>
        <p className="text-xl text-indigo-100 max-w-md mx-auto">
          Manda el gasto por Telegram y se carga solo: monto, fecha y categoria
          se infieren del mensaje.
        </p>
        <div className="flex justify-center pt-4">
          <Link
            href="/login"
            className="px-8 py-3 bg-white text-indigo-600 rounded-lg font-semibold hover:bg-indigo-50 transition"
          >
            Iniciar Sesion
          </Link>
        </div>
        <p className="text-sm text-indigo-200 pt-8">
          Uso privado. No hay registro abierto.
        </p>
      </div>
    </div>
  );
}

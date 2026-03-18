import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <div className="text-center space-y-6 px-4">
        <div className="text-6xl mb-4">$</div>
        <h1 className="text-5xl font-bold">Expense Tracker</h1>
        <p className="text-xl text-indigo-100 max-w-md mx-auto">
          Escanea recibos con OCR, categoriza automaticamente y controla tu presupuesto
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/login"
            className="px-8 py-3 bg-white text-indigo-600 rounded-lg font-semibold hover:bg-indigo-50 transition"
          >
            Iniciar Sesion
          </Link>
          <Link
            href="/register"
            className="px-8 py-3 bg-indigo-500 text-white rounded-lg font-semibold hover:bg-indigo-400 transition border border-indigo-400"
          >
            Registrarse
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-12 max-w-2xl">
          {[
            ["OCR Scan", "Escanea tickets y facturas"],
            ["Auto-Categorias", "Clasificacion automatica"],
            ["Presupuestos", "Alertas al limite"],
            ["Reportes CSV", "Exporta para impuestos"],
          ].map(([title, desc]) => (
            <div key={title} className="bg-white/10 backdrop-blur rounded-lg p-4">
              <h3 className="font-semibold text-sm">{title}</h3>
              <p className="text-xs text-indigo-200 mt-1">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

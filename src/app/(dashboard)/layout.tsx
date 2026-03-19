"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

const primaryNavItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/dashboard/expenses",
    label: "Gastos",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/credit-cards",
    label: "Tarjetas",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    href: "/dashboard/recurring",
    label: "Recurrentes",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    href: "/dashboard/home",
    label: "Compartidos",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const secondaryNavItems = [
  { href: "/dashboard/groups", label: "Grupos" },
  { href: "/dashboard/budgets", label: "Presupuestos" },
  { href: "/dashboard/categories", label: "Categorias" },
  { href: "/dashboard/export", label: "Exportar" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setUser(d.user))
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setDropdownOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const isSecondaryActive = secondaryNavItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Top nav */}
      <nav className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-bold text-indigo-600 dark:text-indigo-400 text-lg">
              $ ExpenseTracker
            </Link>
            {/* Desktop primary nav */}
            <div className="hidden md:flex items-center gap-1">
              {primaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    pathname === item.href
                      ? "bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              <div ref={moreRef} className="relative">
                <button
                  onClick={() => setDropdownOpen((prev) => !prev)}
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    isSecondaryActive
                      ? "bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400"
                      : dropdownOpen
                      ? "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  Más
                  <svg
                    className={`w-4 h-4 transition-transform duration-150 ${dropdownOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-xl shadow-lg py-1 z-40">
                    {secondaryNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setDropdownOpen(false)}
                        className={`block px-4 py-2 text-sm font-medium transition ${
                          pathname === item.href || pathname.startsWith(item.href + "/")
                            ? "bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400"
                            : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right side: theme + user + hamburger (mobile secondary) */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={toggle}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              title={theme === "dark" ? "Modo claro" : "Modo oscuro"}
            >
              {theme === "dark" ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-300 hidden sm:inline">{user.name}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
            >
              Salir
            </button>
            {/* Mobile: "Más" hamburger for secondary nav only */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              aria-label="Más opciones"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile secondary menu (hamburger dropdown) */}
        {menuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-20 bg-black/20 dark:bg-black/40 md:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <div className="relative z-30 md:hidden border-t dark:border-gray-700 px-4 py-2 space-y-1 bg-white dark:bg-gray-800">
              <p className="px-3 pt-1 pb-0.5 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Más secciones
              </p>
              {secondaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block px-3 py-2.5 rounded-lg text-sm font-medium ${
                    pathname === item.href || pathname.startsWith(item.href + "/")
                      ? "bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400"
                      : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/60"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 py-6 pb-24 md:pb-6">{children}</main>

      {/* ── Bottom navigation bar (mobile only) ─────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 safe-area-inset-bottom">
        <div className="flex items-stretch h-16">
          {primaryNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-w-0 transition-colors ${
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-b-full" />
                )}
                <span className={`transition-transform ${isActive ? "scale-110" : ""}`}>
                  {item.icon}
                </span>
                <span className="text-[10px] font-medium leading-tight truncate w-full text-center px-0.5">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

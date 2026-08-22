/**
 * Lee una variable de entorno obligatoria y falla ruidosamente si falta.
 *
 * Se usa para los secretos que no pueden tener un fallback: un valor por
 * defecto conocido en un dominio publico permite forjar sesiones de cualquier
 * usuario. Es mejor que la app no arranque.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

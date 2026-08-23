import { test } from "node:test";
import assert from "node:assert/strict";
import { householdPolicy, isHouseholdEmail } from "../src/lib/visibility.ts";

test("un typo en la allowlist deja afuera al miembro legitimo", () => {
  const conTypo = householdPolicy("leandrojoel@hotmial.com,virginiapayetta@gmail.com", "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", conTypo), false);
  assert.equal(isHouseholdEmail("virginiapayetta@gmail.com", conTypo), true);
});

test("la allowlist bien escrita acepta a los dos", () => {
  const ok = householdPolicy("leandrojoel@hotmail.com,virginiapayetta@gmail.com", "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", ok), true);
  assert.equal(isHouseholdEmail("virginiapayetta@gmail.com", ok), true);
});

test("es insensible a mayusculas y espacios", () => {
  const ok = householdPolicy(" Leandrojoel@Hotmail.com , virginiapayetta@gmail.com ", "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", ok), true);
});

test("en produccion, sin la variable, nadie es miembro", () => {
  const vacia = householdPolicy(undefined, "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", vacia), false);
});

test("fuera de produccion, sin la variable, se abre para desarrollo local", () => {
  const dev = householdPolicy(undefined, "development");
  assert.equal(isHouseholdEmail("cualquiera@ejemplo.com", dev), true);
});

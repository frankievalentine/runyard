/**
 * The setup code as it's typed: upper case, grouped in fours like Runyard prints it
 * (`Q481-TKXH-YPQV`). The server ignores case, dashes and look-alike letters, so this is only
 * for reading.
 */
export function formatSetupCode(input: string): string {
  const plain = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 12);
  return plain.match(/.{1,4}/g)?.join("-") ?? "";
}

/** How a new password reads against Runyard's 12-character minimum: 0 too short, 1–3 fair to strong. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (password.length < 12) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length >= 20 || (password.length >= 16 && kinds >= 3)) return 3;
  return kinds >= 3 || password.length >= 16 ? 2 : 1;
}

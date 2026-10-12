/**
 * GSTIN parsing + validation.
 *
 * A GSTIN is 15 chars: 2-digit state code · 10-char PAN · 1-char entity number ·
 * "Z" (by default) · 1-char checksum. The first two chars are the GST state code
 * (the same place-of-supply key `shops.state_code` stores and the billing RPCs use
 * to decide CGST+SGST vs IGST), so a valid GSTIN lets us auto-fill the shop's state
 * at signup — removing the one hard blocker the ShopSetupDialog otherwise interrupts
 * the owner with before their first bill. See lib/stateCodes.ts and lib/auth.tsx.
 */
import { INDIAN_STATE_CODES, stateName } from "./stateCodes";

/** Mod-36 alphabet GSTN uses for the check digit (values 0–35). */
const CODEPOINTS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Shape only — checksum is validated separately. PAN = 5 letters, 4 digits, 1 letter. */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export interface GstinInfo {
  /** Trimmed + upper-cased input. */
  raw: string;
  /** True only when shape, state code, and checksum all pass. */
  valid: boolean;
  /** 2-digit GST state code, or null when the shape is wrong. */
  stateCode: string | null;
  /** Human-readable state, or "" when unknown. */
  stateName: string;
  /** The embedded 10-char PAN, or null when the shape is wrong. */
  pan: string | null;
  /** Human-readable reason when not valid (empty input → null, no error shown). */
  error: string | null;
}

export function normalizeGstin(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * The GSTN check-digit: weight each of the first 14 chars by an alternating
 * 1/2 factor (right to left), fold each product mod 36, and the check char is
 * the value that makes the running sum a multiple of 36.
 */
function checksumChar(first14: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const cp = CODEPOINTS.indexOf(first14[i]);
    let digit = factor * cp;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  return CODEPOINTS[(36 - (sum % 36)) % 36];
}

export function parseGstin(input: string): GstinInfo {
  const raw = normalizeGstin(input);
  if (!raw) {
    return { raw, valid: false, stateCode: null, stateName: "", pan: null, error: null };
  }
  if (!GSTIN_SHAPE.test(raw)) {
    return {
      raw,
      valid: false,
      stateCode: null,
      stateName: "",
      pan: null,
      error: "GSTIN should be 15 characters (e.g. 27AAPFU0939F1ZV).",
    };
  }

  const stateCode = raw.slice(0, 2);
  const pan = raw.slice(2, 12);
  const known = INDIAN_STATE_CODES.some((s) => s.code === stateCode);
  if (!known) {
    return { raw, valid: false, stateCode, stateName: "", pan, error: `"${stateCode}" is not a valid GST state code.` };
  }
  if (checksumChar(raw.slice(0, 14)) !== raw[14]) {
    return {
      raw,
      valid: false,
      stateCode,
      stateName: stateName(stateCode),
      pan,
      error: "Check digit does not match, re-type the GSTIN.",
    };
  }
  return { raw, valid: true, stateCode, stateName: stateName(stateCode), pan, error: null };
}

export function isValidGstin(input: string): boolean {
  return parseGstin(input).valid;
}

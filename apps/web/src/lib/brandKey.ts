/**
 * Brand-name normalisation — the runtime counterpart of `clean_brand()` in
 * `supabase/seeds/master-items/build_brand_reference.py`. It MUST stay equivalent
 * to that builder: `brand_aliases.brand_key` was produced by the Python cleaner, so
 * a shop's item name only matches a row when cleaned the same way here.
 *
 * Strips dosage form / pack / quantity but KEEPS strength — strength disambiguates
 * compositions (ACITROM 2MG/3MG/4MG -> acitrom2/3/4). If you change one side, change
 * the other and re-run the cross-check (see smoke note in the build script).
 */

const TAB = ["TAB", "TABS", "TABLET", "TABLETS", "CAP", "CAPS", "CAPSULE", "CAPSULES"];
const LIQ = ["SYP", "SYRUP", "SUSP", "SUSPENSION", "SOLN", "SOLUTION", "LIQ", "LIQUID", "ELIXIR", "DROP", "DROPS", "DRP", "DROPLET"];
const INJ = ["INJ", "INJECTION", "VIAL", "VIALS", "AMP", "AMPULE", "AMPOULE", "PFS"];
const TOP = ["CREAM", "GEL", "OINT", "OINTMENT", "LOTION", "BALM", "PASTE", "SOAP", "WASH", "FACEWASH", "SHAMPOO", "SCRUB", "SERUM", "MASK", "FOAM"];
const OTH = ["SPRAY", "RESPULES", "ROTACAP", "ROTACAPS", "INHALER", "MDI", "PUFF", "PUFFS", "SACHET", "POWDER", "PWD", "GRANULES", "KIT", "PESSARY", "SUPPOSITORY", "ENEMA", "GARGLE", "MOUTHWASH", "PATCH", "OIL", "EXP", "CER", "REDIUSE", "REDIUSES", "CARTRIDGE", "CARTRIDGES", "SMARTULE", "SMARTULES", "COMBIPACK", "COMBIKIT"];

const CUT = new Set([...TAB, ...LIQ, ...INJ, ...TOP, ...OTH]); // a form/pack word ends the brand
const KEEP = new Set(["DT", "MD", "MT", "ODT", "SR", "XL", "CR", "ER", "OD", "LA", "HFA", "MR", "XR", "SL", "IR"]); // release modifiers
const ROUTE = new Set(["EYE", "EAR", "NASAL", "ORAL", "VAGINAL", "RECTAL", "SKIN", "FACE", "OTIC"]);
const STOP = new Set(["NEW", "MINI", "BABY", "DOMESTIC"]);
const UNITWORD = new Set(["MG", "MCG", "GM", "GMS", "G", "KG", "ML", "IU", "L"]);

const STRENGTH = /^(\d+(?:\.\d+)?)'?(?:MG|MCG|IU|G)$/; // mass dose: 2MG -> 2, 0.2MG -> 0.2 (kept)
const PACKUNIT = /^\d+(?:\.\d+)?(?:ML|GM|GMS|KG|L|MDI)$/; // volume/weight pack: 75GM, 100ML
const TABPACK = /^\d+(?:\.\d+)?'?(?:S|TAB|TABS|CAP|CAPS)$/; // 30'S, 10TAB
const XPACK = /^\d+X\d+(?:ML|GM|GMS|MG|MCG|KG|G|L)?$/; // 10X2, 5X2ML
const TAILFORM = new RegExp(`[-\\s]+(?:${[...CUT].sort((a, b) => b.length - a.length).join("|")})$`);

const stripQuoteDot = (t: string) => t.replace(/^['.]+|['.]+$/g, "");
const trimEdges = (s: string) => s.replace(/^[ '\-.]+|[ '\-.]+$/g, "");

/** Strip dosage form / pack / quantity from a raw SKU name; keep strength. */
export function cleanBrand(name: string): string {
  let s = name.toUpperCase().replace(/[«»®™]/g, " ").replace(/"/g, " ").replace(/’/g, "'");
  s = s.replace(/[()[\]{}]/g, " "); // unwrap brackets
  s = s.replace(/-(?=\d)/g, " "); // split a hyphen-glued strength: AMPANEL-2MG
  s = s.replace(/(?<=\D)\/|\/(?=\D)/g, " "); // slash between non-digits -> space (keep 10/2/500)
  s = s.replace(/(?<=\D)\.|\.(?=\D)/g, " "); // period between non-digits -> space (keep 0.5)

  const toks = s.split(/[\s,\\]+/).filter(Boolean);
  const out: string[] = [];
  for (const t of toks) {
    const base = stripQuoteDot(t);
    if (KEEP.has(base)) {
      out.push(base);
      continue;
    }
    if (CUT.has(base)) break; // a form word ends the brand
    const m = STRENGTH.exec(base);
    if (m) {
      out.push(m[1]); // 2MG -> 2 (kept)
      continue;
    }
    out.push(t);
  }

  const junk = (tok: string): boolean => {
    const u = stripQuoteDot(tok);
    if (u.includes("*")) return true; // pack notation: 1*5S, 1ML*5S, 5*3ML
    if (ROUTE.has(u) || STOP.has(u) || UNITWORD.has(u)) return true;
    if (PACKUNIT.test(u)) return true;
    if (TABPACK.test(u)) return true;
    if (XPACK.test(u)) return true;
    return false;
  };
  while (out.length && junk(out[out.length - 1])) out.pop();

  let brand = trimEdges(out.join(" ").replace(/\s+/g, " "));
  for (let i = 0; i < 2; i++) brand = brand.replace(TAILFORM, ""); // NUROKIND-INJ -> NUROKIND
  brand = brand.replace(/(\d)\s*'?\s*(?:MG|MCG|GM|GMS|ML|IU|KG|G|L)\b/g, "$1"); // 2/1'MG -> 2/1
  brand = brand.replace(/\s*-\s+|\s+-\s*/g, " "); // drop dangling hyphens: R- 2 -> R 2
  brand = trimEdges(brand.replace(/\s{2,}/g, " "));
  if (!brand) brand = name.toUpperCase().replace(/\s*\d+'?S?\s*$/, "").trim(); // last resort
  return brand;
}

/** Normalized join key for a brand name — matches `brand_aliases.brand_key`. */
export function brandKey(name: string): string {
  return cleanBrand(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

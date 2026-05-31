// Amount in words — a CGST Rules rule-46 expectation on a tax invoice. Indian
// numbering (crore / lakh / thousand), integer paise in, no floating point.

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–99 in words. */
function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
}

/** 0–999 in words. */
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return below100(r);
  return `${ONES[h]} Hundred${r ? ` ${below100(r)}` : ""}`;
}

/** A whole number in words using the Indian crore/lakh/thousand grouping. */
function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;
  let out = "";
  if (crore) out += `${below1000(crore)} Crore `;
  if (lakh) out += `${below100(lakh)} Lakh `;
  if (thousand) out += `${below100(thousand)} Thousand `;
  if (hundred) out += below1000(hundred);
  return out.trim();
}

/**
 * Format integer paise as a rupees-and-paise phrase, e.g. 76265 →
 * "Rupees Seven Hundred Sixty Two and Sixty Five Paise Only".
 */
export function rupeesInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const head = `Rupees ${numberToWords(rupees)}`;
  const tail = p > 0 ? ` and ${numberToWords(p)} Paise` : "";
  return `${head}${tail} Only`;
}

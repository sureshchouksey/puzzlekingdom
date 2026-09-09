// A small, deterministic calculator for the Study Buddy chat - see
// tutor.ts's own doc comment on where this fits in the message pipeline.
// Confirmed with the user 9 September 2026: a bare arithmetic expression
// like "25 + 20", "5*8", "8/2", or "1/4 + 2/4" should be answered
// instantly, computed locally, with no Gemini call at all - the same
// offline-first spirit as fun_content and tutorIntent.ts's keyword
// heuristic, just for a different kind of message.
//
// Deliberately narrow about what counts as "a bare arithmetic expression"
// (see PURE_EXPRESSION_PATTERN below): only a message that, once trimmed
// and stripped of a trailing "?", is ENTIRELY digits/operators/decimal
// points/whitespace is treated this way. A real sentence - "what is 5 x
// 8", "if I have 5 apples and buy 8 more, how many do I have?", "how do I
// add 3-digit numbers" - contains letters, so it's deliberately left to
// fall through to intent classification and, eventually, the retrieval ->
// Gemini pipeline, where it can actually be explained rather than just
// answered. This module only ever computes; it never decides whether a
// message SHOULD be computed rather than taught - that line is drawn
// entirely by the regex below.
//
// No operator precedence beyond the standard one taught in school
// (multiply/divide before add/subtract, evaluated left to right within
// each level) and no parentheses support - none of the examples this was
// built from used them, and a child typing something more complex than
// "25 + 20" is exactly the case that should fall through to a real
// explanation instead of a bare number.

export interface ArithmeticResult {
  // The expression as the child typed it (trimmed, trailing "?" removed) -
  // echoed back in the reply so "25 + 20 = 45" is unambiguous about what
  // was actually calculated.
  expression: string;
  // The computed answer, already formatted for display - either a plain
  // number ("45"), a decimal rounded to a few places ("0.75"), or a
  // reduced fraction ("3/4") when every operand in a +/- expression was
  // written as a fraction (see evaluateFractionChain below).
  resultText: string;
}

type Operator = "+" | "-" | "*" | "/";

interface FractionOperand {
  raw: string;
  isFraction: boolean;
  numerator: number;
  denominator: number; // 1 for a plain integer/decimal operand
  value: number;
}

// Only digits, arithmetic operators (including x/X/× for multiply and ÷
// for divide, since a child might type either), '.', '/', whitespace, and
// a trailing '?' - anything else (letters, words, parentheses) means this
// is NOT a bare expression and should fall through untouched.
const PURE_EXPRESSION_PATTERN = /^[\d\s+\-x×X*/÷.?]+$/;
const OPERATOR_TOKEN = /[+\-x×X*/÷]/;
const TOKEN_PATTERN = /\d+\/\d+|\d+\.\d+|\d+|[+\-x×X*/÷]/g;

function normalizeOperator(raw: string): Operator {
  if (raw === "+") return "+";
  if (raw === "-") return "-";
  if (raw === "/" || raw === "÷") return "/";
  return "*"; // *, x, X, ×
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function formatDecimal(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Round to 4 decimal places and trim trailing zeros, rather than
  // printing long floating-point noise for something like 1/3.
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

function parseOperand(token: string): FractionOperand {
  const slash = token.indexOf("/");
  if (slash > 0) {
    const numerator = Number(token.slice(0, slash));
    const denominator = Number(token.slice(slash + 1));
    return { raw: token, isFraction: true, numerator, denominator, value: numerator / denominator };
  }
  const value = Number(token);
  return { raw: token, isFraction: false, numerator: value, denominator: 1, value };
}

// Fraction-aware addition/subtraction with a common denominator, reduced
// to lowest terms - used only when EVERY operand in the expression was
// written as a literal fraction (e.g. "1/4 + 2/4") and every operator is
// + or -, so "1/4 + 2/4" reads as "a quarter plus a quarter" (answer:
// 3/4) rather than being silently flattened to the decimal 0.75, which is
// mathematically equivalent but not how a child learning fractions would
// expect to see it.
function evaluateFractionChain(operands: FractionOperand[], operators: Operator[]): string | null {
  let numerator = operands[0].numerator;
  let denominator = operands[0].denominator;
  for (let i = 0; i < operators.length; i++) {
    const next = operands[i + 1];
    if (denominator === 0 || next.denominator === 0) return null;
    const commonDenominator = (denominator * next.denominator) / gcd(denominator, next.denominator);
    const a = numerator * (commonDenominator / denominator);
    const b = next.numerator * (commonDenominator / next.denominator);
    numerator = operators[i] === "+" ? a + b : a - b;
    denominator = commonDenominator;
  }
  if (denominator === 0) return null;
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (denominator < 0) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}

// Standard multiply/divide-before-add/subtract evaluation over plain
// numbers (a fraction operand like "1/4" is first collapsed to its
// decimal value 0.25) - used for everything evaluateFractionChain above
// doesn't apply to: mixed fraction/whole-number expressions, and any
// expression using * or /.
function evaluateNumeric(operands: FractionOperand[], operators: Operator[]): string | null {
  const values: number[] = [operands[0].value];
  const pendingAddSub: Operator[] = [];
  for (let i = 0; i < operators.length; i++) {
    const op = operators[i];
    const next = operands[i + 1].value;
    if (op === "*" || op === "/") {
      if (op === "/" && next === 0) return null; // no dividing by zero
      const prev = values.pop()!;
      values.push(op === "*" ? prev * next : prev / next);
    } else {
      values.push(next);
      pendingAddSub.push(op);
    }
  }
  let result = values[0];
  for (let i = 0; i < pendingAddSub.length; i++) {
    result = pendingAddSub[i] === "+" ? result + values[i + 1] : result - values[i + 1];
  }
  return formatDecimal(result);
}

/**
 * Returns the computed result if `message` is (once trimmed and stripped
 * of a trailing "?") a bare arithmetic expression this module can
 * confidently evaluate, or null if it isn't - in which case the caller
 * (tutor.ts) should fall through to intent classification exactly as
 * before. Never throws.
 */
export function tryEvaluateArithmetic(message: string): ArithmeticResult | null {
  const expression = message.trim().replace(/\?+\s*$/, "").trim();
  if (!expression) return null;
  if (!PURE_EXPRESSION_PATTERN.test(message.trim())) return null;
  if (!/\d/.test(expression)) return null;
  if (!OPERATOR_TOKEN.test(expression)) return null; // a bare number alone (e.g. an answer guess) is not a calculation request

  const rawTokens = expression.match(TOKEN_PATTERN);
  if (!rawTokens || rawTokens.length < 3 || rawTokens.length % 2 === 0) return null;

  const operands: FractionOperand[] = [];
  const operators: Operator[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    const expectOperand = i % 2 === 0;
    if (expectOperand) {
      if (OPERATOR_TOKEN.test(token) && token.length === 1) return null; // two operators/operands in a row - not a valid expression
      operands.push(parseOperand(token));
    } else {
      if (!OPERATOR_TOKEN.test(token)) return null;
      operators.push(normalizeOperator(token));
    }
  }
  if (operands.some((o) => o.denominator === 0)) return null;

  const allFractionsAddSub = operands.every((o) => o.isFraction) && operators.every((op) => op === "+" || op === "-");
  const resultText = allFractionsAddSub ? evaluateFractionChain(operands, operators) : evaluateNumeric(operands, operators);
  if (resultText === null) return null;

  return { expression, resultText };
}

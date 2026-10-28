/**
 * Safe, pure formula and condition evaluator for MIRA payroll.
 * Supports:
 *   - Arithmetic: + - * /
 *   - Comparisons: <= >= < > == !=
 *   - Logical: AND, OR, NOT
 *   - Functions: MIN(a, b), MAX(a, b), ROUND(val, decimals?), FLOOR(val), CEIL(val), IF(cond, thenVal, elseVal)
 *   - Variables: extracted from context dictionary
 *
 * No `eval()` or `Function()` constructor is ever used.
 */

export interface EvaluationContext {
  [variableName: string]: number | boolean;
}

export class FormulaEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaEvaluationError';
  }
}

type TokenType =
  | 'NUMBER'
  | 'IDENTIFIER'
  | 'PLUS'
  | 'MINUS'
  | 'MULTIPLY'
  | 'DIVIDE'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'LTE'
  | 'GTE'
  | 'LT'
  | 'GT'
  | 'EQ'
  | 'NEQ'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();

  while (i < s.length) {
    const c = s[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && i + 1 < s.length && /[0-9]/.test(s[i + 1]))) {
      const start = i;
      let hasDot = false;
      while (i < s.length && (/[0-9]/.test(s[i]) || (s[i] === '.' && !hasDot))) {
        if (s[i] === '.') hasDot = true;
        i++;
      }
      tokens.push({ type: 'NUMBER', value: s.slice(start, i), pos: start });
      continue;
    }

    if (/[a-zA-Z_]/.test(c)) {
      const start = i;
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        i++;
      }
      const val = s.slice(start, i);
      const upper = val.toUpperCase();
      if (upper === 'AND') tokens.push({ type: 'AND', value: upper, pos: start });
      else if (upper === 'OR') tokens.push({ type: 'OR', value: upper, pos: start });
      else if (upper === 'NOT') tokens.push({ type: 'NOT', value: upper, pos: start });
      else tokens.push({ type: 'IDENTIFIER', value: val, pos: start });
      continue;
    }

    // Two-character operators
    if (c === '<' && s[i + 1] === '=') {
      tokens.push({ type: 'LTE', value: '<=', pos: i });
      i += 2;
      continue;
    }
    if (c === '>' && s[i + 1] === '=') {
      tokens.push({ type: 'GTE', value: '>=', pos: i });
      i += 2;
      continue;
    }
    if (c === '=' && s[i + 1] === '=') {
      tokens.push({ type: 'EQ', value: '==', pos: i });
      i += 2;
      continue;
    }
    if (c === '!' && s[i + 1] === '=') {
      tokens.push({ type: 'NEQ', value: '!=', pos: i });
      i += 2;
      continue;
    }

    // Single-character operators
    switch (c) {
      case '+': tokens.push({ type: 'PLUS', value: '+', pos: i }); break;
      case '-': tokens.push({ type: 'MINUS', value: '-', pos: i }); break;
      case '*': tokens.push({ type: 'MULTIPLY', value: '*', pos: i }); break;
      case '/': tokens.push({ type: 'DIVIDE', value: '/', pos: i }); break;
      case '(': tokens.push({ type: 'LPAREN', value: '(', pos: i }); break;
      case ')': tokens.push({ type: 'RPAREN', value: ')', pos: i }); break;
      case ',': tokens.push({ type: 'COMMA', value: ',', pos: i }); break;
      case '<': tokens.push({ type: 'LT', value: '<', pos: i }); break;
      case '>': tokens.push({ type: 'GT', value: '>', pos: i }); break;
      case '=': tokens.push({ type: 'EQ', value: '=', pos: i }); break; // Allow single '=' as equality in formulas
      default:
        throw new FormulaEvaluationError(`Unexpected character '${c}' at position ${i} in expression "${input}"`);
    }
    i++;
  }

  tokens.push({ type: 'EOF', value: '', pos: i });
  return tokens;
}

export class FormulaParser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private advance(): Token {
    const t = this.tokens[this.current];
    if (t.type !== 'EOF') this.current++;
    return t;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new FormulaEvaluationError(`${message} at position ${this.peek().pos}`);
  }

  public parse(context: EvaluationContext): number | boolean {
    const result = this.parseExpression(context);
    if (!this.check('EOF')) {
      throw new FormulaEvaluationError(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
    }
    return result;
  }

  private parseExpression(ctx: EvaluationContext): number | boolean {
    return this.parseLogicalOr(ctx);
  }

  private parseLogicalOr(ctx: EvaluationContext): number | boolean {
    let left = this.parseLogicalAnd(ctx);

    while (this.match('OR')) {
      const right = this.parseLogicalAnd(ctx);
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseLogicalAnd(ctx: EvaluationContext): number | boolean {
    let left = this.parseEquality(ctx);

    while (this.match('AND')) {
      const right = this.parseEquality(ctx);
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseEquality(ctx: EvaluationContext): number | boolean {
    let left = this.parseRelational(ctx);

    while (this.check('EQ') || this.check('NEQ')) {
      const op = this.advance().type;
      const right = this.parseRelational(ctx);
      if (op === 'EQ') left = (left === right);
      else left = (left !== right);
    }
    return left;
  }

  private parseRelational(ctx: EvaluationContext): number | boolean {
    let left: number | boolean = this.parseAdditive(ctx);

    while (this.check('LT') || this.check('LTE') || this.check('GT') || this.check('GTE')) {
      const op = this.advance().type;
      const right = this.parseAdditive(ctx);
      const l = Number(left);
      const r = Number(right);
      switch (op) {
        case 'LT': left = l < r; break;
        case 'LTE': left = l <= r; break;
        case 'GT': left = l > r; break;
        case 'GTE': left = l >= r; break;
      }
    }
    return left;
  }

  private parseAdditive(ctx: EvaluationContext): number {
    let left = this.parseMultiplicative(ctx);

    while (this.check('PLUS') || this.check('MINUS')) {
      const op = this.advance().type;
      const right = this.parseMultiplicative(ctx);
      if (op === 'PLUS') left = left + right;
      else left = left - right;
    }
    return left;
  }

  private parseMultiplicative(ctx: EvaluationContext): number {
    let left = this.parseUnary(ctx);

    while (this.check('MULTIPLY') || this.check('DIVIDE')) {
      const op = this.advance().type;
      const right = this.parseUnary(ctx);
      if (op === 'MULTIPLY') left = left * right;
      else {
        if (right === 0) throw new FormulaEvaluationError('Division by zero');
        left = left / right;
      }
    }
    return left;
  }

  private parseUnary(ctx: EvaluationContext): number {
    if (this.match('MINUS')) {
      return -this.parseUnary(ctx);
    }
    if (this.match('PLUS')) {
      return this.parseUnary(ctx);
    }
    if (this.match('NOT')) {
      return !this.parseExpression(ctx) ? 1 : 0;
    }
    return this.parsePrimary(ctx);
  }

  private parsePrimary(ctx: EvaluationContext): number {
    if (this.match('NUMBER')) {
      return parseFloat(this.tokens[this.current - 1].value);
    }

    if (this.match('LPAREN')) {
      const expr = this.parseExpression(ctx);
      this.consume('RPAREN', "Expect ')' after expression");
      return typeof expr === 'boolean' ? (expr ? 1 : 0) : expr;
    }

    if (this.match('IDENTIFIER')) {
      const id = this.tokens[this.current - 1].value;
      const upper = id.toUpperCase();

      // Check if it's a function call: NAME(...)
      if (this.match('LPAREN')) {
        const args: (number | boolean)[] = [];
        if (!this.check('RPAREN')) {
          do {
            args.push(this.parseExpression(ctx));
          } while (this.match('COMMA'));
        }
        this.consume('RPAREN', `Expect ')' after function arguments for ${id}`);

        switch (upper) {
          case 'MIN':
            if (args.length === 0) throw new FormulaEvaluationError('MIN requires at least 1 argument');
            return Math.min(...args.map(Number));
          case 'MAX':
            if (args.length === 0) throw new FormulaEvaluationError('MAX requires at least 1 argument');
            return Math.max(...args.map(Number));
          case 'ROUND':
            if (args.length === 0) throw new FormulaEvaluationError('ROUND requires at least 1 argument');
            const decimals = args.length > 1 ? Number(args[1]) : 0;
            const factor = Math.pow(10, decimals);
            return Math.round(Number(args[0]) * factor) / factor;
          case 'FLOOR':
            return Math.floor(Number(args[0]));
          case 'CEIL':
            return Math.ceil(Number(args[0]));
          case 'IF':
            if (args.length !== 3) throw new FormulaEvaluationError('IF requires exactly 3 arguments (condition, thenVal, elseVal)');
            return Boolean(args[0]) ? Number(args[1]) : Number(args[2]);
          default:
            throw new FormulaEvaluationError(`Unknown function '${id}'`);
        }
      }

      // Variable reference
      if (id in ctx) {
        const val = ctx[id];
        return typeof val === 'boolean' ? (val ? 1 : 0) : val;
      }
      if (upper in ctx) {
        const val = ctx[upper];
        return typeof val === 'boolean' ? (val ? 1 : 0) : val;
      }

      throw new FormulaEvaluationError(`Unknown variable or component '${id}' in expression`);
    }

    throw new FormulaEvaluationError(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
  }
}

/** Evaluates an expression or formula given a variables context. */
export function evaluateFormula(formula: string, context: EvaluationContext = {}): number {
  if (!formula || !formula.trim()) return 0;
  const tokens = tokenize(formula);
  const parser = new FormulaParser(tokens);
  const res = parser.parse(context);
  return typeof res === 'boolean' ? (res ? 1 : 0) : res;
}

/** Evaluates a boolean condition expression (e.g. "BASIC <= ESI_LIMIT"). */
export function evaluateCondition(condition: string, context: EvaluationContext = {}): boolean {
  if (!condition || !condition.trim()) return true;
  const tokens = tokenize(condition);
  const parser = new FormulaParser(tokens);
  const res = parser.parse(context);
  return Boolean(res);
}

/** Statically extract all identifier/variable names referenced in a formula or condition. */
export function extractVariableReferences(expr: string): string[] {
  if (!expr || !expr.trim()) return [];
  const tokens = tokenize(expr);
  const BUILTIN_NAMES = new Set(['MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'IF', 'AND', 'OR', 'NOT']);
  const vars: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'IDENTIFIER') {
      const upper = t.value.toUpperCase();
      // Skip function calls: if next token is '(', check if it's a known function
      if (tokens[i + 1]?.type === 'LPAREN' && BUILTIN_NAMES.has(upper)) {
        continue;
      }
      if (!BUILTIN_NAMES.has(upper) && !vars.includes(t.value)) {
        vars.push(t.value);
      }
    }
  }
  return vars;
}

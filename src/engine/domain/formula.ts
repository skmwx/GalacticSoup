/**
 * A calculation the interface can show rather than assert
 * (Functional Specification 4.4, 19.6).
 *
 * A derived number travels with the operands that produced it and the formula
 * it came from, so a screen can substitute current values into the rule the
 * player is reading about. The shape is deliberately flat and transport-safe:
 * the same record crosses the worker boundary today and a network boundary
 * later.
 *
 * @implements FUNC-4.4, FUNC-19.6
 */

export interface FormulaOperand {
  readonly key: string;
  readonly value: number;
}

export interface FormulaTrace {
  /** Message key of the authored formula this trace explains. */
  readonly formulaKey: string;
  readonly operands: readonly FormulaOperand[];
  /** The result before any display rounding (Functional Specification 4.1). */
  readonly unroundedResult: number;
  readonly displayResult: number;
}

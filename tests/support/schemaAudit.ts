/**
 * A static audit of a published JSON Schema
 * (MVP Implementation Plan phase 20; Technical Specification 7.1, 11.2, 14).
 *
 * A closed contract has no field a reader may skip. For every place a schema
 * describes an object or an array this checks that:
 *
 *   - a record with named properties refuses any other property;
 *   - every named property is required, unless the caller lists it as one the
 *     specification makes optional;
 *   - a keyed map says what its values are;
 *   - an array says what its items are;
 *   - no value is left wholly undescribed.
 *
 * Conditional refinements (`if`, `then`, `else`, `not`) restate part of a
 * record that is already closed where it is declared, so they are not audited
 * as declarations of their own.
 */

export interface SchemaFinding {
  /** JSON pointer of the offending subschema. */
  readonly pointer: string;
  readonly problem: string;
}

type Node = Record<string, unknown>;

const REFINEMENTS = new Set(['if', 'then', 'else', 'not']);
/** Keywords whose value is a map of names to subschemas. */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas']);
/** Keywords whose value is a subschema or a list of them. */
const SCHEMA_VALUES = new Set([
  'items', 'prefixItems', 'additionalProperties', 'propertyNames', 'contains',
  'allOf', 'anyOf', 'oneOf', 'unevaluatedProperties',
]);
/** Any of these makes a subschema say something about its value. */
const DESCRIBING = [
  'type', 'enum', 'const', '$ref', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'properties', 'items', 'pattern',
];

export interface SchemaAuditOptions {
  /** `pointer#property` entries the specification declares optional. */
  readonly optional?: readonly string[];
  /**
   * Pointers of values another schema describes, chosen by a discriminator at
   * run time: a request's payload by its type, a response's data by its request.
   */
  readonly deferred?: readonly string[];
}

export function auditSchema(schema: unknown, options: SchemaAuditOptions = {}): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  const optional = new Set(options.optional ?? []);
  const deferred = new Set(options.deferred ?? []);
  visit(schema, '', findings, optional);
  return findings.filter((finding) => !deferred.has(finding.pointer));
}

function visit(value: unknown, pointer: string, findings: SchemaFinding[], optional: ReadonlySet<string>): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const node = value as Node;
  const add = (problem: string): void => {
    findings.push({ pointer: pointer === '' ? '/' : pointer, problem });
  };

  if (!DESCRIBING.some((keyword) => keyword in node) && !('$defs' in node)) {
    add('describes nothing about its value');
  }

  const types = node['type'] === undefined ? [] : [node['type']].flat();
  const properties = node['properties'];
  if (isNode(properties)) {
    if (node['additionalProperties'] !== false && node['unevaluatedProperties'] !== false) {
      add('a record that accepts properties it does not name');
    }
    const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);
    for (const name of Object.keys(properties)) {
      if (!required.has(name) && !optional.has(`${pointer === '' ? '/' : pointer}#${name}`)) {
        add(`property "${name}" is not required`);
      }
    }
  } else if (types.includes('object')) {
    const values = node['additionalProperties'];
    const patterned = isNode(node['patternProperties']);
    if (!isNode(values) && !(patterned && values === false)) {
      add('a keyed map that does not describe its values');
    }
  }
  if (types.includes('array') && !isNode(node['items']) && !Array.isArray(node['prefixItems'])) {
    add('an array that does not describe its items');
  }

  for (const [keyword, child] of Object.entries(node)) {
    if (REFINEMENTS.has(keyword)) continue;
    if (SCHEMA_MAPS.has(keyword) && isNode(child)) {
      for (const [name, entry] of Object.entries(child)) {
        visit(entry, `${pointer}/${keyword}/${name}`, findings, optional);
      }
    } else if (SCHEMA_VALUES.has(keyword)) {
      if (Array.isArray(child)) {
        child.forEach((entry, index) => {
          // A member of `allOf` that only refines is a conditional, not a declaration.
          if (isNode(entry) && !('if' in entry && !('type' in entry))) {
            visit(entry, `${pointer}/${keyword}/${String(index)}`, findings, optional);
          }
        });
      } else {
        visit(child, `${pointer}/${keyword}`, findings, optional);
      }
    }
  }
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

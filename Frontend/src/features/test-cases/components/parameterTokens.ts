/**
 * Parameter tokens inside step values. Steps store a parameter as `{{data.name}}` (a case parameter) or
 * `{{input.name}}` (a custom step's input); the worker swaps them for the value when the step runs. The step editor
 * never asks a tester to type that syntax: it reads values with these helpers and shows each token as a chip.
 */
import type { TokenKind } from './StepEditor.js';

/** A token inside a value, matching what `dataNamesIn` and the worker accept (spaces inside the braces allowed). */
const TOKEN = /\{\{\s*(data|input)\.([A-Za-z][\w-]*)\s*\}\}/g;

/** One piece of a value: plain text, or a parameter. */
export type ValuePart = string | { kind: TokenKind; name: string };

/** The stored form of a parameter, for example `{{data.roleName}}`. */
export const tokenOf = (kind: TokenKind, name: string): string => `{{${kind}.${name}}}`;

/** Splits a value into text and parameters, in order. Empty text between tokens is left out. */
export function splitTokens(value: string): ValuePart[] {
  const parts: ValuePart[] = [];
  let last = 0;
  for (const m of value.matchAll(TOKEN)) {
    if (m.index > last) parts.push(value.slice(last, m.index));
    parts.push({ kind: m[1] as TokenKind, name: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return parts;
}

/** The parameter when the whole value is exactly one token (the usual case), else undefined. */
export function singleToken(value: string): { kind: TokenKind; name: string } | undefined {
  const parts = splitTokens(value.trim());
  const only = parts.length === 1 ? parts[0] : undefined;
  return typeof only === 'object' ? only : undefined;
}

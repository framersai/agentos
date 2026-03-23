/**
 * @file schema-lowering.test.ts
 * @description Unit tests for the minimal Zod-to-JSON-Schema converter.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { lowerZodToJsonSchema } from '../compiler/SchemaLowering.js';

describe('SchemaLowering', () => {
  it('converts z.string()', () => {
    expect(lowerZodToJsonSchema(z.string())).toEqual({ type: 'string' });
  });

  it('converts z.number()', () => {
    expect(lowerZodToJsonSchema(z.number())).toEqual({ type: 'number' });
  });

  it('converts z.boolean()', () => {
    expect(lowerZodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
  });

  it('converts z.object() with required fields', () => {
    const schema = lowerZodToJsonSchema(z.object({ name: z.string(), age: z.number() }));
    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('name', { type: 'string' });
    expect(schema.properties).toHaveProperty('age', { type: 'number' });
    expect(schema.required).toEqual(['name', 'age']);
  });

  it('converts z.array()', () => {
    const schema = lowerZodToJsonSchema(z.array(z.string()));
    expect(schema.type).toBe('array');
    expect(schema.items).toEqual({ type: 'string' });
  });

  it('converts z.enum()', () => {
    const schema = lowerZodToJsonSchema(z.enum(['a', 'b', 'c']));
    expect(schema.enum).toEqual(['a', 'b', 'c']);
  });

  it('handles z.optional() — field excluded from required', () => {
    const schema = lowerZodToJsonSchema(
      z.object({ name: z.string(), age: z.number().optional() }),
    );
    expect(schema.required).toEqual(['name']);
    // Optional field still appears in properties with its inner type
    expect((schema.properties as Record<string, unknown>).age).toEqual({ type: 'number' });
  });

  it('handles z.default() — field excluded from required', () => {
    const schema = lowerZodToJsonSchema(
      z.object({ name: z.string(), count: z.number().default(0) }),
    );
    expect(schema.required).toEqual(['name']);
    expect((schema.properties as Record<string, unknown>).count).toEqual({ type: 'number' });
  });

  it('converts nested z.object()', () => {
    const schema = lowerZodToJsonSchema(
      z.object({ outer: z.object({ inner: z.boolean() }) }),
    );
    const outerProp = (schema.properties as Record<string, unknown>).outer as Record<string, unknown>;
    expect(outerProp.type).toBe('object');
    expect((outerProp.properties as Record<string, unknown>).inner).toEqual({ type: 'boolean' });
  });

  it('converts z.array() of objects', () => {
    const schema = lowerZodToJsonSchema(z.array(z.object({ id: z.string() })));
    expect(schema.type).toBe('array');
    const items = schema.items as Record<string, unknown>;
    expect(items.type).toBe('object');
  });

  it('returns empty object for unsupported types', () => {
    // z.any() is not handled — should return {}
    expect(lowerZodToJsonSchema(z.any())).toEqual({});
  });

  it('produces no required key when all fields are optional', () => {
    const schema = lowerZodToJsonSchema(
      z.object({ a: z.string().optional(), b: z.number().optional() }),
    );
    expect(schema).not.toHaveProperty('required');
  });
});

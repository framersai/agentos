/**
 * @file errors.spec.ts
 * @description Unit tests for error utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  GMIError,
  GMIErrorCode,
  AppError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  createGMIErrorFromError,
} from '../../src/utils/errors';

describe('Error Utilities', () => {
  describe('GMIError', () => {
    it('should create error with message and code', () => {
      const error = new GMIError('Test error', GMIErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(GMIErrorCode.INTERNAL_ERROR);
      expect(error.name).toBe('GMIError');
    });

    it('should create error with details', () => {
      const details = { key: 'value', nested: { a: 1 } };
      const error = new GMIError('Test error', GMIErrorCode.INTERNAL_ERROR, details);
      expect(error.details).toEqual(details);
    });

    it('should be an instance of Error', () => {
      const error = new GMIError('Test', GMIErrorCode.INTERNAL_ERROR);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof GMIError).toBe(true);
    });

    it('should have a stack trace', () => {
      const error = new GMIError('Test', GMIErrorCode.INTERNAL_ERROR);
      expect(error.stack).toBeDefined();
    });

    it('should serialize to plain object', () => {
      const error = new GMIError('Test', GMIErrorCode.RATE_LIMIT_EXCEEDED, { limit: 100 });
      const obj = error.toPlainObject();
      expect(obj.message).toBe('Test');
      expect(obj.code).toBe(GMIErrorCode.RATE_LIMIT_EXCEEDED);
      expect(obj.details).toEqual({ limit: 100 });
    });

    it('should serialize to JSON', () => {
      const error = new GMIError('Test', GMIErrorCode.INTERNAL_ERROR);
      const json = JSON.stringify(error);
      const parsed = JSON.parse(json);
      expect(parsed.message).toBe('Test');
      expect(parsed.code).toBe(GMIErrorCode.INTERNAL_ERROR);
    });

    it('should provide HTTP status code', () => {
      const error = new GMIError('Test', GMIErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.getHttpStatusCode()).toBe(429);
    });

    it('should provide user-friendly message', () => {
      const error = new GMIError('Technical error', GMIErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.getUserFriendlyMessage()).toBe('You are sending requests too quickly. Please slow down.');
    });
  });

  describe('GMIErrorCode', () => {
    it('should have all expected error codes', () => {
      expect(GMIErrorCode.CONFIG_ERROR).toBeDefined();
      expect(GMIErrorCode.INTERNAL_ERROR).toBeDefined();
      expect(GMIErrorCode.RATE_LIMIT_EXCEEDED).toBeDefined();
      expect(GMIErrorCode.NOT_INITIALIZED).toBeDefined();
      expect(GMIErrorCode.TOOL_EXECUTION_FAILED).toBeDefined();
      expect(GMIErrorCode.PROVIDER_ERROR).toBeDefined();
    });
  });

  describe('AppError', () => {
    it('should create error with message and status code', () => {
      const error = new AppError('App error', 400);
      expect(error.message).toBe('App error');
      expect(error.statusCode).toBe(400);
    });

    it('should be an instance of Error', () => {
      const error = new AppError('Test', 500);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof AppError).toBe(true);
    });

    it('should default status code to 500', () => {
      const error = new AppError('Test');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid input');
      expect(error.message).toBe('Invalid input');
      expect(error.statusCode).toBe(400);
    });

    it('should be an instance of AppError', () => {
      const error = new ValidationError('Test');
      expect(error instanceof AppError).toBe(true);
    });
  });

  describe('AuthenticationError', () => {
    it('should create authentication error', () => {
      const error = new AuthenticationError('Unauthorized');
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
    });

    it('should have default message', () => {
      const error = new AuthenticationError();
      expect(error.message).toBe('Authentication failed');
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.message).toBe('Resource not found');
      expect(error.statusCode).toBe(404);
    });

    it('should have default message', () => {
      const error = new NotFoundError();
      expect(error.message).toBe('Resource not found');
    });
  });

  describe('createGMIErrorFromError', () => {
    it('should create GMIError from existing GMIError', () => {
      const original = new GMIError('Original', GMIErrorCode.INTERNAL_ERROR);
      const result = createGMIErrorFromError(original, GMIErrorCode.INTERNAL_ERROR);
      expect(result instanceof GMIError).toBe(true);
      expect(result.message).toBe('Original');
    });

    it('should wrap regular Error in GMIError', () => {
      const original = new Error('Original error');
      const wrapped = createGMIErrorFromError(original, GMIErrorCode.INTERNAL_ERROR);
      expect(wrapped instanceof GMIError).toBe(true);
      expect(wrapped.message).toContain('Original error');
    });

    it('should wrap string in GMIError', () => {
      const wrapped = createGMIErrorFromError('String error', GMIErrorCode.INTERNAL_ERROR);
      expect(wrapped instanceof GMIError).toBe(true);
      expect(wrapped.message).toContain('String error');
    });

    it('should handle unknown error types', () => {
      const wrapped = createGMIErrorFromError({ custom: 'object' }, GMIErrorCode.INTERNAL_ERROR);
      expect(wrapped instanceof GMIError).toBe(true);
    });

    it('should apply override message when provided', () => {
      const original = new Error('Original');
      const wrapped = createGMIErrorFromError(original, GMIErrorCode.INTERNAL_ERROR, undefined, 'Override');
      expect(wrapped.message).toBe('Override: Original');
    });
  });

  describe('GMIError.isGMIError', () => {
    it('should return true for GMIError instances', () => {
      const error = new GMIError('Test', GMIErrorCode.INTERNAL_ERROR);
      expect(GMIError.isGMIError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Test');
      expect(GMIError.isGMIError(error)).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(GMIError.isGMIError('string')).toBe(false);
      expect(GMIError.isGMIError(null)).toBe(false);
      expect(GMIError.isGMIError(undefined)).toBe(false);
    });
  });

  describe('GMIError.wrap', () => {
    it('should wrap error with code and message', () => {
      const original = new Error('Original');
      const wrapped = GMIError.wrap(original, GMIErrorCode.INTERNAL_ERROR, 'Wrapped');
      expect(wrapped instanceof GMIError).toBe(true);
      expect(wrapped.message).toBe('Wrapped: Original');
    });
  });
});


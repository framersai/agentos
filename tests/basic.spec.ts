import { describe, it, expect } from 'vitest';
import { GMIErrorCode, GMIError } from '../src/utils/errors';

describe('AgentOS error helpers', () => {
  it('exposes GMIError utilities', () => {
    const err = new GMIError('boom', GMIErrorCode.INTERNAL_SERVER_ERROR);
    expect(err.getHttpStatusCode()).toBe(500);
  });
});

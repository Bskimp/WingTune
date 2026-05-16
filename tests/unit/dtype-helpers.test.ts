import { describe, expect, it } from 'vitest';

import {
  concatFloat32,
  float32ArrayBytes,
  secondsFromMicros,
} from '../../src/lib/dtype';

describe('Float32 sanity', () => {
  it('typed-array constructor preserves length and integer values exactly', () => {
    const src = [0, 1, -1, 65535];
    const arr = Float32Array.from(src);
    expect(arr.length).toBe(src.length);
    expect(arr[0]).toBe(0);
    expect(arr[1]).toBe(1);
    expect(arr[2]).toBe(-1);
    expect(arr[3]).toBe(65535);
  });

  it('Math.PI in f32 differs from f64 by less than 1e-6', () => {
    const arr = Float32Array.from([Math.PI]);
    expect(Math.abs(arr[0] - Math.PI)).toBeLessThan(1e-6);
  });
});

describe('concatFloat32', () => {
  it('returns an empty Float32Array for empty input', () => {
    const out = concatFloat32([]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(0);
  });

  it('concatenates two arrays end-to-end preserving values', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([4, 5]);
    const out = concatFloat32([a, b]);
    expect(out.length).toBe(5);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles many chunks', () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      Float32Array.from([i, i + 0.5]),
    );
    const out = concatFloat32(chunks);
    expect(out.length).toBe(20);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0.5);
    expect(out[18]).toBe(9);
    expect(out[19]).toBe(9.5);
  });
});

describe('secondsFromMicros', () => {
  it('divides a number by 1_000_000', () => {
    expect(secondsFromMicros(1_500_000)).toBe(1.5);
    expect(secondsFromMicros(0)).toBe(0);
  });

  it('handles bigint without losing the seconds-integer part', () => {
    // 1.0e15 µs = 1.0e9 s — well past f64 microsecond precision
    expect(secondsFromMicros(1_000_000_000_000_000n)).toBe(1_000_000_000);
  });

  it('preserves sub-second remainder on bigint input', () => {
    expect(secondsFromMicros(1_500_500n)).toBeCloseTo(1.5005, 6);
  });
});

describe('float32ArrayBytes', () => {
  it('reports 4 bytes per element', () => {
    expect(float32ArrayBytes(new Float32Array(0))).toBe(0);
    expect(float32ArrayBytes(new Float32Array(1024))).toBe(4096);
  });
});

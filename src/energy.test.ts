import { describe, it, expect } from 'vitest';
import { EnergyField, coverageRadius, generateBolt } from './energy';

describe('continuous energy field', () => {
  it('smooths towards a hand without teleporting', () => {
    const field = new EnergyField();
    field.setTarget({ x: .1, y: .1, expansion: 1 });
    const result = field.update(1 / 60);
    expect(result.x).toBeGreaterThan(.1);
    expect(result.x).toBeLessThan(.55);
    expect(result.expansion).toBeGreaterThan(.28);
    expect(result.expansion).toBeLessThan(1);
  });
  it('converges equally over different frame rates', () => {
    const a = new EnergyField(), b = new EnergyField();
    a.setTarget({ expansion: 1 }); b.setTarget({ expansion: 1 });
    for (let i=0; i<60; i++) a.update(1/60);
    for (let i=0; i<30; i++) b.update(1/30);
    expect(a.current.expansion).toBeCloseTo(b.current.expansion, 5);
  });
  it('clamps extreme target input and rejects non finite values', () => {
    const field = new EnergyField();
    field.setTarget({ x: -4, y: 99, expansion: 40 }); field.update(1);
    expect(field.current.x).toBeGreaterThanOrEqual(0);
    expect(field.current.y).toBeLessThanOrEqual(1);
    expect(field.current.expansion).toBeLessThanOrEqual(1);
    field.setTarget({ x: NaN, expansion: Infinity }); field.update(1/60);
    expect(Number.isFinite(field.current.x)).toBe(true);
    expect(Number.isFinite(field.current.expansion)).toBe(true);
  });
});

describe('lightning geometry', () => {
  it('maximum radius reaches every corner even with an off-center hand', () => {
    const width=1440, height=900, x=.12, y=.2;
    const radius=coverageRadius(width,height,x,y,1);
    for (const [cx,cy] of [[0,0],[width,0],[0,height],[width,height]]) {
      expect(radius).toBeGreaterThanOrEqual(Math.hypot(cx-x*width,cy-y*height));
    }
  });
  it('a fist contracts to a small palm-size radius', () => {
    expect(coverageRadius(1440,900,.5,.5,0)).toBeLessThan(70);
    expect(coverageRadius(1440,900,.5,.5,.6)).toBeGreaterThan(300);
  });
  it('generates repeatable, jagged bolts with exact endpoints', () => {
    const bolt=generateBolt(0,0,500,100,42);
    expect(bolt[0]).toEqual({x:0,y:0});
    expect(bolt.at(-1)).toEqual({x:500,y:100});
    expect(bolt.length).toBeGreaterThan(20);
    expect(bolt).toEqual(generateBolt(0,0,500,100,42));
    expect(bolt).not.toEqual(generateBolt(0,0,500,100,41));
  });
});

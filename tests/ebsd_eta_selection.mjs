import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync, readSync, closeSync } from 'node:fs';
import { File } from 'node:buffer';
import { transform } from 'esbuild';

async function load(file) {
  const {code} = await transform(await fs.readFile(file, 'utf8'), {loader:'ts',format:'esm'});
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const {smartSelect, paintStroke} = await load('src/apps/ebsd/etaSelection.ts');
const iq = Float32Array.from([10,10,100,10,10,10, 10,10,100,10,10,10, 10,10,100,10,10,10]);
const valid = new Uint8Array(18).fill(1), mask = new Uint8Array(18);
smartSelect(mask,iq,valid,6,3,0,0,2);
assert.equal(mask.reduce((a,b)=>a+b),6,'Smart selection must stop at the IQ barrier');
smartSelect(mask,iq,valid,6,3,4,1,2);
assert.equal(mask.reduce((a,b)=>a+b),15);
smartSelect(mask,iq,valid,6,3,0,0,2,true);
assert.equal(mask.reduce((a,b)=>a+b),9,'Smart eraser must preserve a disconnected selected region');
smartSelect(mask,iq,valid,6,3,0,0,95);
assert.equal(mask.reduce((a,b)=>a+b),18,'Sensitivity must change the accepted IQ range');
const wrapped = new Uint8Array(6);
smartSelect(wrapped,Float32Array.from([100,100,10,10,100,100]),new Uint8Array(6).fill(1),3,2,2,0,1);
assert.equal(wrapped.reduce((a,b)=>a+b),1,'Rows must not wrap during region growth');
const brush = new Uint8Array(25), brushValid = new Uint8Array(25).fill(1); brushValid[12]=0;
paintStroke(brush,brushValid,5,5,[0,0],[4,4],1,false);
assert.equal(brush[0],1); assert.equal(brush[24],1); assert.equal(brush[12],0);
paintStroke(brush,brushValid,5,5,[0,0],[4,4],1,true);
assert.equal(brush.reduce((a,b)=>a+b),0);
console.log('PASS: smart selection barriers/connectivity, sensitivity, smart erase, brush/erase strokes and invalid sites');

const {readSourcePhases} = await load('src/apps/ebsd/phaseMetadata.ts');
const header='# Phase 7\n# MaterialName W C\n# Symmetry 62\n# Phase 2\n# MaterialName Co (Cobalt, beta - cubic)\n# Symmetry 43\n0 0 0\n';
const phases=await readSourcePhases(new File([header],'sample.ang'));
assert.deepEqual(phases.map(phase=>[phase.id,phase.suggested]),[[7,'WC'],[2,'Co']]);
if (process.argv[2]) {
  const file=openSync(process.argv[2],'r');
  const chunk=Buffer.alloc(1024*1024); const bytesRead=readSync(file,chunk,0,chunk.length,0); closeSync(file);
  const phases=await readSourcePhases(new File([chunk.subarray(0,bytesRead)],'actual.osc'));
  assert.ok(phases.some(phase=>phase.suggested==='WC'));
  console.log('PASS: actual OSC Phase header:',phases.map(phase=>`${phase.id}:${phase.name}`).join(' / '));
}
console.log('PASS: local ANG/OSC header reading preserves source IDs and suggested roles');

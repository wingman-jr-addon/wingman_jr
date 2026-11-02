const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('processor.js', 'utf8');
const start = source.indexOf('function procCreateEventLoopDelayAccumulator');
const end = source.indexOf('function procStartEventLoopDelayProbe');
assert.ok(start >= 0 && end > start, 'event-loop probe helpers must remain discoverable');

const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + `
this.eventLoopProbeTestApi = {
    create: procCreateEventLoopDelayAccumulator,
    observe: procObserveEventLoopDelay
};`, context);

const accumulator = context.eventLoopProbeTestApi.create(100, 25);
context.eventLoopProbeTestApi.observe(accumulator, 125); // on time
context.eventLoopProbeTestApi.observe(accumulator, 190); // 40ms late
context.eventLoopProbeTestApi.observe(accumulator, 220); // 5ms late

assert.strictEqual(accumulator.totalDelayMs, 45);
assert.strictEqual(accumulator.maxDelayMs, 40);
assert.strictEqual(accumulator.maxGapMs, 65);
assert.strictEqual(accumulator.sampleCount, 3);

console.log('processor event-loop probe tests passed');

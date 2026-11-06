import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Download, createRecord } from '../src/index';
import { startFakeServer, type FakeServerOptions } from '../test/helpers/fakeServer';

const MIB = 1_048_576;
const SIZE = 32 * MIB;

type Scenario = { name: string; maxSegments: number; workStealing: boolean; server: FakeServerOptions };

const capped: FakeServerOptions = { size: SIZE, bytesPerSecPerConnection: MIB };
// One connection is much slower than the rest, which is where work stealing earns its keep.
const lopsided: FakeServerOptions = { ...capped, slowRangeStart: 0, slowBytesPerSec: 256 * 1024 };

const scenarios: Scenario[] = [
  { name: '1 segment', maxSegments: 1, workStealing: false, server: capped },
  { name: '8 segments, no stealing', maxSegments: 8, workStealing: false, server: capped },
  { name: '8 segments, stealing', maxSegments: 8, workStealing: true, server: capped },
  { name: '8 segments, slow first, no stealing', maxSegments: 8, workStealing: false, server: lopsided },
  { name: '8 segments, slow first, stealing', maxSegments: 8, workStealing: true, server: lopsided },
];

const run = async (scenario: Scenario): Promise<number> => {
  const server = await startFakeServer(scenario.server);
  const dir = await mkdtemp(join(tmpdir(), 'bench-'));
  try {
    const download = new Download(createRecord(`${server.url}/file`, join(dir, 'out')), {
      recordPath: join(dir, 'record.json'),
      maxSegments: scenario.maxSegments,
      workStealing: scenario.workStealing,
    });
    const started = performance.now();
    await download.start();
    if (download.record.status !== 'done') throw new Error(`download ended as ${download.record.status}`);
    return (performance.now() - started) / 1000;
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
};

console.log(`| Scenario | Seconds | MB/s |\n|---|---|---|`);
for (const scenario of scenarios) {
  const seconds = await run(scenario);
  console.log(`| ${scenario.name} | ${seconds.toFixed(1)} | ${(SIZE / MIB / seconds).toFixed(1)} |`);
}

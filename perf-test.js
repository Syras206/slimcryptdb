/*
  SlimCryptDB Performance Benchmark
  - Warm-up + multiple iterations
  - High-resolution timers
  - Reports: mean, median, p95, p99, ops/sec
  - Config via env vars:
      PERF_ITERATIONS (default 3)
      PERF_TABLE_SIZE (default 2000)
      PERF_WARMUP (default true)
      PERF_READS_PER_ITER (default 1000)
      PERF_UPDATES_RATIO (default 0.1)
      PERF_DELETES_RATIO (default 0.5)
*/

const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { SlimCryptDB, generateEncryptionKey } = require('./SlimCryptDB.js');

function hrNowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

function stats(samples) {
  if (!samples.length)
    return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0 };
  const count = samples.length;
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const sum = samples.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const median = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  return { count, min, max, mean, median, p95, p99 };
}

function createDeterministicRng(seedHex = 'deadbeefcafebabe') {
  const seed = Buffer.from(seedHex, 'hex');
  let counter = 0;
  return () => {
    const h = crypto.createHash('sha256');
    h.update(seed);
    h.update(Buffer.from(String(counter++)));
    return h.digest();
  };
}

async function rmSafe(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (_) {
    void _; // intentionally ignore errors during cleanup
  }
}

async function benchmark() {
  const ITERATIONS = parseInt(process.env.PERF_ITERATIONS || '3', 10);
  const TABLE_SIZE = parseInt(process.env.PERF_TABLE_SIZE || '2000', 10);
  const WARMUP = (process.env.PERF_WARMUP || 'true').toLowerCase() !== 'false';
  const READS_PER_ITER = parseInt(
    process.env.PERF_READS_PER_ITER || '1000',
    10
  );
  const UPDATES_RATIO = Math.max(
    0,
    Math.min(1, parseFloat(process.env.PERF_UPDATES_RATIO || '0.1'))
  );
  const DELETES_RATIO = Math.max(
    0,
    Math.min(1, parseFloat(process.env.PERF_DELETES_RATIO || '0.5'))
  );

  const testDir = path.join(__dirname, `perf-data-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });

  const db = new SlimCryptDB(testDir, generateEncryptionKey(), {
    encrypt: true,
    compression: true,
    walEnabled: true,
    syncWrites: true,
  });
  await db.ready();

  const rng = createDeterministicRng();

  const schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      age: { type: 'number', minimum: 0 },
      score: { type: 'number' },
    },
    required: ['name', 'email'],
  };

  const insertTimes = [];
  const queryTimes = [];
  const updateTimes = [];
  const deleteTimes = [];

  function makeUser(i) {
    const r = rng();
    const name = `User_${i}_${r.subarray(0, 2).toString('hex')}`;
    const email = `user_${i}_${r.subarray(2, 4).toString('hex')}@example.com`;
    const age = (r[4] % 70) + 18;
    const score = ((r[5] << 8) + r[6]) % 1000;
    return { name, email, age, score };
  }

  if (WARMUP) {
    const warmTable = `warm_${crypto.randomBytes(3).toString('hex')}`;
    await db.createTable(warmTable, schema);
    for (
      let i = 0;
      i < Math.min(500, Math.max(50, Math.floor(TABLE_SIZE / 4)));
      i++
    ) {
      await db.addData(warmTable, makeUser(i));
    }
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const tName = `bench_${iter}_${crypto.randomBytes(3).toString('hex')}`;
    await db.createTable(tName, schema);

    // INSERT benchmark
    let t0 = hrNowMs();
    for (let i = 0; i < TABLE_SIZE; i++) {
      await db.addData(tName, makeUser(i));
    }
    let t1 = hrNowMs();
    insertTimes.push(t1 - t0);

    // QUERY benchmark (mixed filters and full scans)
    t0 = hrNowMs();
    for (let i = 0; i < READS_PER_ITER; i++) {
      const threshold = 18 + (i % 50);
      // alternate between readData and queryData
      if (i % 2 === 0) {
        await db.queryData(tName, {
          filter: {
            operator: 'and',
            conditions: [{ column: 'age', operator: '>=', value: threshold }],
          },
          sort: { column: 'score', direction: 'desc' },
          limit: 50,
        });
      } else {
        await db.readData(tName, { age: threshold });
      }
    }
    t1 = hrNowMs();
    queryTimes.push(t1 - t0);

    // UPDATE benchmark (update ~ratio of rows)
    const updates = Math.floor(TABLE_SIZE * UPDATES_RATIO);
    t0 = hrNowMs();
    for (let i = 0; i < updates; i++) {
      // simulate lookup then update by unique email
      const email = `user_${i}_${rng().subarray(2, 4).toString('hex')}@example.com`;
      const rows = await db.readData(tName, { email });
      if (rows.length) {
        const row = rows[0];
        await db.updateData(
          tName,
          { id: row.id },
          { score: (row.score || 0) + 1 }
        );
      }
    }
    t1 = hrNowMs();
    updateTimes.push(t1 - t0);

    // DELETE benchmark (delete ~ratio of rows)
    const deletes = Math.floor(TABLE_SIZE * DELETES_RATIO);
    t0 = hrNowMs();
    let deleted = 0;
    // delete by age threshold and then by limit if needed
    const threshold = 18 + (iter % 50);
    deleted += await db.deleteData(tName, { age: threshold });
    // if not enough, delete by reading and deleting individually
    let offset = 0;
    while (deleted < deletes) {
      const batch = await db.queryData(tName, {
        limit: 100,
        offset,
        sort: { column: 'name', direction: 'asc' },
      });
      if (!batch.length) break;
      for (const row of batch) {
        await db.deleteData(tName, { id: row.id });
        deleted++;
        if (deleted >= deletes) break;
      }
      offset += batch.length;
    }
    t1 = hrNowMs();
    deleteTimes.push(t1 - t0);
  }

  await db.close();

  const insertStats = stats(insertTimes);
  const queryStats = stats(queryTimes);
  const updateStats = stats(updateTimes);
  const deleteStats = stats(deleteTimes);

  const opsPerSec = (ops, ms) =>
    ms > 0 ? (ops / (ms / 1000)).toFixed(1) : 'inf';

  console.log('\n=== SlimCryptDB Performance Results ===');
  console.log(
    `Config: iterations=${ITERATIONS}, tableSize=${TABLE_SIZE}, readsPerIter=${READS_PER_ITER}, updatesRatio=${UPDATES_RATIO}, deletesRatio=${DELETES_RATIO}, warmup=${WARMUP}`
  );

  function print(name, s, opsCountPerIter) {
    const meanOpsPerSec = opsPerSec(opsCountPerIter, s.mean);
    console.log(`\n${name}:`);
    console.log(`  samples: ${s.count}`);
    console.log(
      `  min/mean/median/p95/p99/max (ms): ${s.min.toFixed(2)} / ${s.mean.toFixed(2)} / ${s.median.toFixed(2)} / ${s.p95.toFixed(2)} / ${s.p99.toFixed(2)} / ${s.max.toFixed(2)}`
    );
    console.log(`  approx ops/sec (based on mean): ${meanOpsPerSec}`);
  }

  print('Insert', insertStats, TABLE_SIZE);
  print('Query', queryStats, READS_PER_ITER);
  print('Update', updateStats, Math.floor(TABLE_SIZE * UPDATES_RATIO));
  print('Delete', deleteStats, Math.floor(TABLE_SIZE * DELETES_RATIO));

  // Cleanup test data dir
  await rmSafe(testDir);
}

benchmark().catch(async (err) => {
  console.error('Performance benchmark failed:', err);
  process.exitCode = 1;
});

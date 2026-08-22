import { formatBenchmarkSummary, runBenchmark } from '../services/exportBenchmark';

const sampleJobCount = Number(process.env.BENCHMARK_SAMPLE_SIZE ?? 50);
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? 4);

const createSyntheticExportWork = async (jobId: number) => {
  const delayMs = 15 + (jobId % 5) * 10;
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  if (jobId % 17 === 0) {
    throw new Error(`synthetic failure for ${jobId}`);
  }
};

async function main() {
  const jobs = Array.from({ length: sampleJobCount }, (_, index) => ({ id: index }));

  const result = await runBenchmark(jobs, {
    concurrency,
    onProgress: (index, total) => {
      if (index % 10 === 0 || index + 1 === total) {
        console.log(`[benchmark] processed ${index + 1}/${total}`);
      }
    },
    worker: async (job) => {
      await createSyntheticExportWork(job.id);
    },
  });

  console.log('Benchmark report:');
  console.log(formatBenchmarkSummary(result.summary));
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});

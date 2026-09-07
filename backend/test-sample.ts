import * as fs from 'fs';
const data = JSON.parse(fs.readFileSync('../scraper/out_jobs/jobs_full.json', 'utf-8'));
const sample = data.slice(0, 1);
sample[0].candidates = sample[0].candidates.slice(0, 2); // just 2 candidates
fs.writeFileSync('sample_jobs.json', JSON.stringify(sample, null, 2));

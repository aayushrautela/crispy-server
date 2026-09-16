import type { AiInsightsJob } from '../../lib/queue.js';
import { generateInsightsIntoCache } from '../../modules/ai/ai-insights-generation.js';

export async function runAiInsightsJob(payload: AiInsightsJob): Promise<void> {
  await generateInsightsIntoCache(payload);
}
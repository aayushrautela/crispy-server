import type {
  RecommendationAiPlanRequest,
  RecommendationAiPlanCandidate,
  RecommendationAiPlanMediaItem,
} from './recommendation-ai-plan.types.js';

export function buildRecommendationAiPlanPrompt(request: RecommendationAiPlanRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = buildSystemPrompt(request);
  const userPrompt = buildUserPrompt(request);
  return { systemPrompt, userPrompt };
}

function buildSystemPrompt(request: RecommendationAiPlanRequest): string {
  const { profile, constraints } = request;

  return `You are a recommendation engine that generates personalized content plans.

Your task is to analyze user signals and select the best items from a provided candidate pool.

CRITICAL RULES:
1. You MUST ONLY select items from the candidate pool provided. Do not invent titles or IDs.
2. Output ONLY valid JSON matching the exact schema specified.
3. Select up to ${constraints.maxItems} items maximum.
4. Respect maturity rating: ${profile.maturityRating}
5. Consider preferred languages: ${profile.preferredLanguages.join(', ')}
6. Consider user location: ${profile.country}
${constraints.excludeWatched ? '7. Avoid items the user has already watched.' : ''}
${constraints.excludeWatchlisted ? '8. Avoid items already in the watchlist.' : ''}

OUTPUT SCHEMA:
{
  "summary": "Brief strategy summary (1-2 sentences)",
  "items": [
    {
      "mediaKey": "exact mediaKey from candidate pool",
      "score": 0.0-1.0,
      "confidence": 0.0-1.0,
      "reason": "Concise human-readable reason (max 100 chars)",
      "reasonCodes": ["genre_match", "tone_match", "director_match", etc.]
    }
  ]
}

REASON CODES (use relevant ones):
- genre_match: matches preferred genres
- tone_match: matches preferred tone/style
- director_match: matches preferred directors
- actor_match: matches preferred actors
- theme_match: matches preferred themes
- popularity: high popularity score
- critical_acclaim: highly rated
- similar_to_watched: similar to watched content
- trending: currently trending
- new_release: recent release
- hidden_gem: lesser-known quality content

Prioritize items with confidence >= ${constraints.minimumConfidence}.
Order items by descending score.`;
}

function buildUserPrompt(request: RecommendationAiPlanRequest): string {
  const { profile, signals, candidatePool, constraints } = request;

  let prompt = `Generate a recommendation plan for ${profile.displayName}.\n\n`;

  if (signals.watchHistory.length > 0) {
    prompt += `WATCH HISTORY (${signals.watchHistory.length} items):\n`;
    signals.watchHistory.slice(0, 20).forEach((item) => {
      prompt += formatMediaItem(item);
    });
    if (signals.watchHistory.length > 20) {
      prompt += `... and ${signals.watchHistory.length - 20} more items\n`;
    }
    prompt += '\n';
  }

  if (signals.ratings.length > 0) {
    prompt += `RATINGS (${signals.ratings.length} items):\n`;
    signals.ratings.slice(0, 10).forEach((item) => {
      prompt += formatMediaItem(item);
    });
    if (signals.ratings.length > 10) {
      prompt += `... and ${signals.ratings.length - 10} more items\n`;
    }
    prompt += '\n';
  }

  if (signals.watchlist.length > 0) {
    prompt += `WATCHLIST (${signals.watchlist.length} items):\n`;
    signals.watchlist.slice(0, 10).forEach((item) => {
      prompt += formatMediaItem(item);
    });
    if (signals.watchlist.length > 10) {
      prompt += `... and ${signals.watchlist.length - 10} more items\n`;
    }
    prompt += '\n';
  }

  if (signals.negativeSignals.length > 0) {
    prompt += `NEGATIVE SIGNALS (avoid similar content):\n`;
    signals.negativeSignals.slice(0, 10).forEach((item) => {
      prompt += formatMediaItem(item);
    });
    prompt += '\n';
  }

  prompt += `CANDIDATE POOL (${candidatePool.length} items - SELECT ONLY FROM THESE):\n`;
  candidatePool.forEach((candidate) => {
    prompt += formatCandidate(candidate);
  });

  prompt += `\nCONSTRAINTS:\n`;
  prompt += `- Max items: ${constraints.maxItems}\n`;
  prompt += `- Media types: ${constraints.mediaTypes.join(', ')}\n`;
  prompt += `- Minimum confidence: ${constraints.minimumConfidence}\n`;

  prompt += `\nGenerate the recommendation plan as JSON following the schema exactly.`;

  return prompt;
}

function formatMediaItem(item: RecommendationAiPlanMediaItem): string {
  let line = `- ${item.title} (${item.year || 'N/A'}) [${item.mediaKey}]`;
  if (item.overview) {
    line += ` - ${item.overview.slice(0, 100)}`;
  }
  if (item.genres && item.genres.length > 0) {
    line += ` | Genres: ${item.genres.join(', ')}`;
  }
  line += '\n';
  return line;
}

function formatCandidate(candidate: RecommendationAiPlanCandidate): string {
  let line = `- ${candidate.title} (${candidate.year || 'N/A'}) [${candidate.mediaKey}]`;
  if (candidate.overview) {
    line += ` - ${candidate.overview.slice(0, 100)}`;
  }
  if (candidate.genres && candidate.genres.length > 0) {
    line += ` | Genres: ${candidate.genres.join(', ')}`;
  }
  if (candidate.popularity) {
    line += ` | Popularity: ${candidate.popularity}`;
  }
  line += '\n';
  return line;
}

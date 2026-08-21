export type TitleInsightsContext = {
  itemId: string;
  mediaType: 'movie' | 'show';
  title: string;
  year: string | null;
  description: string | null;
  rating: string | null;
  genres: string[];
  reviews: Array<{
    author: string;
    rating: number | null;
    content: string;
  }>;
};

export function buildSearchPrompt(query: string, locale: string): string {
  return [
    'Return recommendations for the following query. Focus heavily on tonal and thematic accuracy.',
    `User Query: "${query}"`,
    '',
    'Recommendation Rules:',
    'Return between 5 and 15 titles. If the query is highly specific, return fewer, higher-quality matches rather than forcing a longer list.',
    'Mixed results from movies and TV shows are allowed.',
    'Suggest real, released titles only. Use the commonly accepted English title.',
    "Include at most ONE title from the same franchise, cinematic universe, or direct sequel/prequel line as the query's anchor. Use the rest of the list for similar genres, worlds, or vibes.",
    'Do not include the exact title the user is asking about.',
    `Preferred locale: ${locale}`,
    '',
    'JSON Schema Requirement:',
    'Output a JSON object exactly matching this structure. For year, use a 4-digit integer if known, or omit the field if unsure. mediaType must be "movie" or "show".',
    '{"items":[{"title":"Title One","mediaType":"movie","year":1982}]}',
  ].join('\n');
}

export function buildInsightsPrompt(context: TitleInsightsContext): string {
  const plot = context.description?.trim() || 'N/A';
  const rating = context.rating?.trim() || 'N/A';
  const genres = context.genres.join(', ') || 'N/A';
  const formattedReviews = context.reviews.length === 0
    ? 'No user reviews available.'
    : context.reviews
      .map((review) => {
        const author = review.author || 'Unknown';
        const authorRating = review.rating == null ? 'N/A' : String(review.rating);
        const content = review.content
          .replace(/\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500);
        return `(Author: ${author}, Rating: ${authorRating}) "${content}"`;
      })
      .join('\n---\n');

  return [
    'Be an enthusiastic screen-story fan, not a critic. Use simple, conversational, and exciting English.',
    'Avoid complex words, academic jargon, or flowery prose. Write like you\'re talking to a friend.',
    mediaTypeVoiceInstruction(context.mediaType),
    'Do NOT use generic headings.',
    'Focus on what the title feels like to watch, what kind of story energy it has, and why fans connect with it.',
    'Keep each insight specific to this title. Avoid filler that could fit anything.',
    'Context:',
    `Media type: ${context.mediaType}`,
    `Title: ${context.title} (${context.year ?? 'N/A'})`,
    `Plot: ${plot}`,
    `Rating: ${rating}`,
    `Genres: ${genres}`,
    'User Reviews:',
    formattedReviews,
    'Task:',
    'Generate a JSON object with:',
    '- insights: an array of 3 objects. Each object must include:',
    '  - category: a short uppercase label (e.g. CONSENSUS, VIBE, STYLE)',
    '  - title: a punchy, short headline',
    '  - content: 2-3 sentences',
    '  - type: one of ["consensus","performance","theme","vibe","style","controversy","character"]',
    'Use a varied mix of insight types. Prefer theme, vibe, character, or style when they fit the title better than consensus.',
    'For shows, you may talk about momentum, episode hooks, character arcs, ensemble chemistry, or worldbuilding.',
    'For movies, you may talk about pacing, performances, craft, tension, spectacle, or emotional payoff.',
    '- trivia: one "Did you know?" fact (1-2 sentences)',
    'If you are not confident about a hard production fact, keep the trivia broad and safe instead of inventing details.',
    'Return ONLY valid JSON.',
  ].join('\n\n');
}

function mediaTypeVoiceInstruction(mediaType: TitleInsightsContext['mediaType']): string {
  if (mediaType === 'show') {
    return 'Treat shows as ongoing stories. It is good to mention momentum, episode-to-episode pull, long-form arcs, and ensemble chemistry when relevant.';
  }
  return 'Treat movies as a complete single-story experience. It is good to mention pacing, craft, performances, tension, or payoff when relevant.';
}

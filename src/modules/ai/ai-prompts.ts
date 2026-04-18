export type SearchQueryAnalysis = {
  isRecommendation: boolean;
  anchorHint: string | null;
};

export type SearchPromptCandidateShape = {
  title: string;
  mediaType?: 'movie' | 'show';
};

export type TitleInsightsContext = {
  mediaKey: string;
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

const RAW_SUGGESTION_LIMIT = 16;

export function buildSearchPrompt(query: string, locale: string, analysis: SearchQueryAnalysis): string {
  const lines = [
    'You help a streaming app answer what-to-watch questions like a smart friend.',
    `User query: ${query}`,
    'Catalog scope: You may suggest movies or TV shows.',
    'Mixed results can come from the movie and TV catalogs.',
    `Preferred locale: ${locale}`,
    'Suggest real released titles only.',
    'Prefer the commonly used catalog title for each result so it can be matched reliably.',
  ];

  if (analysis.isRecommendation) {
    lines.push('This is a recommendation query, not a direct title lookup.');
    if (analysis.anchorHint) {
      lines.push(`Anchor phrase: ${analysis.anchorHint}`);
    }
      lines.push('The anchor can come from any franchise or medium.');
    lines.push(`Return up to ${RAW_SUGGESTION_LIMIT} genuinely diverse titles.`);
    lines.push('Do not include the exact title or closest obvious match the user already asked about.');
    lines.push('Include at most one title from the same franchise, collection, series, or shared universe.');
    lines.push('Avoid sequels, prequels, spinoffs, reboots, or multiple entries from the same property unless the user explicitly asks for that property.');
    lines.push('If you include one franchise-adjacent pick, use the rest of the list for broader nearby recommendations with similar tone, audience, world, genre, or premise.');
  } else {
    lines.push('If the query sounds like a direct title lookup, include that title first.');
    lines.push(`Return up to ${RAW_SUGGESTION_LIMIT} distinct titles.`);
  }

  lines.push('Use short JSON objects so the app can validate each suggestion against the right catalog.');
  lines.push('Every item must include `title` and should include `mediaType` when you know it.');
  lines.push('Allowed mediaType values: `movie`, `show`.');
  lines.push('Do not include years, numbering, commentary, or markdown.');
  lines.push('Return ONLY a JSON object with this shape:');
  lines.push('{"items":[{"title":"Title One","mediaType":"movie"},{"title":"Title Two","mediaType":"show"}]}');
  return lines.join('\n\n');
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

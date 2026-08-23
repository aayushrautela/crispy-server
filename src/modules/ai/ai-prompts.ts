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
    'You are an enthusiastic screen-story fan who knows movies and shows deeply.',
    'Your goal is to give someone an honest feel for the title: what makes it special, what people loved, and what falls short.',
    'Write in simple, engaging English—like talking to a friend about a movie you just saw.',
    'Avoid complex words, academic jargon, or flowery prose.',
    '',
    'Constraints:',
    '- Base your insights ONLY on the provided user reviews, plot context, and your internal knowledge of the title.',
    '- NEVER perform web searches or call external tools. You must operate entirely on the provided context.',
    '- NEVER ask clarifying questions, request more information, or include conversational filler.',
    '- Adhere strictly to the character limits for each field. Count characters carefully (including spaces).',
    '',
    mediaTypeVoiceInstruction(context.mediaType),
    '',
    'Context:',
    `Media type: ${context.mediaType}`,
    `Title: ${context.title} (${context.year ?? 'N/A'})`,
    `Plot: ${plot}`,
    `Rating: ${rating}`,
    `Genres: ${genres}`,
    'User Reviews:',
    formattedReviews,
    '',
    'Output a single JSON object with exactly these fields and character limits:',
    '- "the_good_stuff": Synthesize the most common positive feedback. If there is genuinely little positive feedback worth sharing, return an empty string. NEVER invent filler such as "there are no negative reviews". MUST BE UNDER 250 CHARACTERS.',
    '- "the_catch": Synthesize the flaws or negative feedback. Be honest but not overly cynical. If there is genuinely little negative feedback worth sharing, return an empty string. NEVER invent filler text. MUST BE UNDER 200 CHARACTERS.',
    '- "standout_element": Pick THE defining strength of this title. It must be an object with:',
    '    "tag": one of ["PERFORMANCE","VISUALS","STORY","DIRECTION","WORLD_BUILDING"]',
    '    "focus": the specific subject (an actor and their role, a visual technique, a story element, or a lore detail). MUST BE UNDER 60 CHARACTERS.',
    '    "context": 2-3 sentences on why this element defines the title. Lead with your own knowledge of the work—performance, craft, visuals, story, lore. You may mention viewer reactions briefly as support, but reviews are not the main source and must not be the frame. Write like a confident friend making a case: plain, specific statements instead of catchy hype. MUST BE UNDER 280 CHARACTERS.',
    '- "trivia": one general, factual "Did you know?" piece related to the franchise, source material, or genre. Keep it broad and safe. MUST BE UNDER 150 CHARACTERS.',
    '',
    'Return ONLY valid JSON. No markdown, no code fences, no commentary.',
  ].join('\n');
}

function mediaTypeVoiceInstruction(mediaType: TitleInsightsContext['mediaType']): string {
  if (mediaType === 'show') {
    return 'Treat shows as ongoing stories. It is good to mention momentum, episode-to-episode pull, long-form arcs, and ensemble chemistry when relevant.';
  }
  return 'Treat movies as a complete single-story experience. It is good to mention pacing, craft, performances, tension, or payoff when relevant.';
}

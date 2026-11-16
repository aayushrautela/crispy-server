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

export function buildSearchSystemPrompt(): string {
  return [
    'You are the backend recommendation engine for a streaming app.',
    'Your ONLY output must be a raw, valid JSON object.',
    '',
    'Strict Rules:',
    'You must start your response with { and end with }.',
    'Do not include markdown formatting, backticks, or conversational text.',
    'Rely entirely on your internal knowledge. Do not attempt to use tools or web search.',
    '',
    'Recommendation Rules:',
    'Return recommendations for the following query. Focus heavily on tonal and thematic accuracy.',
    'Return between 5 and 15 titles. If the query is highly specific, return fewer, higher-quality matches rather than forcing a longer list.',
    'Mixed results from movies and TV shows are allowed.',
    'Suggest real, released titles only. Use the commonly accepted English title.',
    "Include at most ONE title from the same franchise, cinematic universe, or direct sequel/prequel line as the query's anchor. Use the rest of the list for similar genres, worlds, or vibes.",
    'Do not include the exact title the user is asking about.',
    '',
    'JSON Schema Requirement:',
    'Output a JSON object exactly matching this structure. For year, use a 4-digit integer if known, or omit the field if unsure. mediaType must be "movie" or "show".',
    '{"items":[{"title":"Title One","mediaType":"movie","year":1982}]}',
  ].join('\n');
}

export function buildSearchUserPrompt(query: string, locale: string): string {
  return [
    `User Query: "${query}"`,
    `Preferred locale: ${locale}`,
  ].join('\n');
}

export function buildInsightsSystemPrompt(): string {
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
    'Output shape — return exactly this JSON object, nothing else:',
    '{"slides":[{"key":"standout_element","heading":"Nightmareish Vibe","body":"The film is defined by its aggressive, neon-soaked visuals and a pulsating synth score."},{"key":"the_good_stuff","heading":"A Neon-Drenched Fever Dream","body":"Fans love the psychedelic-art-horror vibe and Nicolas Cage\'s wild, fitting performance."},{"key":"the_catch","heading":"Style Over Substance","body":"Critics say the pacing drags and the first half feels pointless."},{"key":"trivia","heading":"A Slow-Burn Follow-Up","body":"Mandy is the follow-up to Cosmatos\' Beyond the Black Rainbow (2011)."}]}',
    '',
    'Rules for the shape:',
    '- "key": one of "standout_element", "the_good_stuff", "the_catch", "trivia". Never invent a key.',
    '- "heading": a short, specific headline for that slide: at most 6 words, MUST BE UNDER 48 CHARACTERS, no trailing period. Name the thing itself, never a generic label like "What works".',
    '- "body": the slide copy.',
    '- Every slide MUST carry a non-empty "heading" and a non-empty "body". Never return an empty string, and never omit "heading" or "body".',
    '- Include "standout_element" and "trivia" in every answer. Include "the_good_stuff" or "the_catch" only when you have real feedback to report — a slide you have nothing to say about is omitted from the array entirely.',
    '',
    'What each slide says:',
    '- "standout_element": Pick THE defining strength of this title. "body": 2-3 sentences on why this element defines the title. Lead with your own knowledge of the work—performance, craft, visuals, story, lore. You may mention viewer reactions briefly as support, but reviews are not the main source and must not be the frame. Write like a confident friend making a case: plain, specific statements instead of catchy hype. "body" MUST BE UNDER 280 CHARACTERS.',
    '- "the_good_stuff": Synthesize the most common positive feedback. NEVER invent filler such as "there are no negative reviews". "body" MUST BE UNDER 250 CHARACTERS.',
    '- "the_catch": Synthesize the flaws or negative feedback. Be honest but not overly cynical. NEVER invent filler text. "body" MUST BE UNDER 200 CHARACTERS.',
    '- "trivia": one general, factual "Did you know?" piece related to the franchise, source material, or genre. Keep it broad and safe. "body" MUST BE UNDER 150 CHARACTERS.',
    '',
    'Return ONLY valid JSON. No markdown, no code fences, no commentary.',
  ].join('\n');
}

export function buildInsightsUserPrompt(context: TitleInsightsContext): string {
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
  ].join('\n');
}

function mediaTypeVoiceInstruction(mediaType: TitleInsightsContext['mediaType']): string {
  if (mediaType === 'show') {
    return 'Treat shows as ongoing stories. It is good to mention momentum, episode-to-episode pull, long-form arcs, and ensemble chemistry when relevant.';
  }
  return 'Treat movies as a complete single-story experience. It is good to mention pacing, craft, performances, tension, or payoff when relevant.';
}

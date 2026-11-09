const REVIEW_LINK_PATTERN = /(?:https?:\/\/|www\.)\S+/i;

export function containsReviewLink(content: string): boolean {
  return REVIEW_LINK_PATTERN.test(content);
}

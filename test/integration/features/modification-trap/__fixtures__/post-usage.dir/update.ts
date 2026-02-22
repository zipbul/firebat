import type { Post } from './post-types';

export function updatePost(existing: Post, title: string): Post {
  return { ...existing, title };
}

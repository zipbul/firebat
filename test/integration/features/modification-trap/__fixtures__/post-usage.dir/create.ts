import type { Post } from './post-types';

export function createPost(title: string, body: string): Post {
  return { title, body };
}

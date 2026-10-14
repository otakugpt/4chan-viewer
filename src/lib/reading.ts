import type { Reading } from "./library";
export function readBoundary(posts: PostInfo[], reading?: Reading): number {
  if (!reading) return -1;
  if (reading.postId !== null && reading.postId !== undefined) {
    // A deleted anchor is unknown, not permission to mark later posts as read.
    return posts.findIndex(post => post.postId === reading.postId);
  }
  const firstUnread = posts.findIndex(post => post.no > reading.post);
  return firstUnread === -1 ? posts.length - 1 : firstUnread - 1;
}

import type { FigmaComment } from "../fetch";
import type { Comment, CommentReply } from "../types";

export interface NodeCommentsMap {
  [nodeId: string]: Comment[];
}

export function transformComments(comments: FigmaComment[]): NodeCommentsMap {
  const unresolved = comments.filter((c) => c.resolved_at === null);

  const parents: FigmaComment[] = [];
  const repliesByParentId: Record<string, FigmaComment[]> = {};

  for (const comment of unresolved) {
    if (comment.parent_id === "") {
      parents.push(comment);
    } else {
      if (!repliesByParentId[comment.parent_id]) {
        repliesByParentId[comment.parent_id] = [];
      }
      repliesByParentId[comment.parent_id].push(comment);
    }
  }

  const sortedParents = [...parents].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const result: NodeCommentsMap = {};

  for (const parent of sortedParents) {
    const replies = repliesByParentId[parent.id] ?? [];
    const sortedReplies = [...replies].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const commentObj: Comment = {
      message: parent.message,
      createdAt: parent.created_at,
    };

    if (sortedReplies.length > 0) {
      commentObj.replies = sortedReplies.map(
        (r): CommentReply => ({
          message: r.message,
          createdAt: r.created_at,
        }),
      );
    }

    if (parent.client_meta?.node_id) {
      const nodeId = parent.client_meta.node_id;
      if (!result[nodeId]) {
        result[nodeId] = [];
      }
      result[nodeId].push(commentObj);
    }
  }

  return result;
}

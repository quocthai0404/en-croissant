import type { GeneratedCommentMetadata } from "@/utils/treeReducer";

const GENERATED_COMMENT_MARKER = /\[\[%en-croissant-generated-v1:([^\]]*)\]\]/g;

/** Encode generated prose inside an ordinary PGN comment without altering user prose. */
export function mergeGeneratedComment(
  comment: string,
  generatedComment?: GeneratedCommentMetadata,
): string {
  if (!generatedComment?.text) return comment;
  const marker = `[[%en-croissant-generated-v1:${encodeURIComponent(JSON.stringify(generatedComment))}]]`;
  const visibleGeneratedText = `[Chess Reviewer: Bình luận tự động]\n${generatedComment.text}`;
  const generatedSegment = `${visibleGeneratedText}\n\n${marker}`;
  return comment ? `${comment}\n\n${generatedSegment}` : generatedSegment;
}

/** Split our export marker back into separate persisted fields when importing a PGN. */
export function extractGeneratedComment(value: string, fallbackPly = 0): {
  comment: string;
  generatedComment?: GeneratedCommentMetadata;
} {
  const matches = [...value.matchAll(GENERATED_COMMENT_MARKER)];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return { comment: value };

  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]!);
  } catch {
    return { comment: value };
  }
  if (!decoded) return { comment: value };

  let generatedComment: GeneratedCommentMetadata;
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "schemaVersion" in parsed &&
      parsed.schemaVersion === 1 &&
      "gameId" in parsed &&
      typeof parsed.gameId === "string" &&
      "ply" in parsed &&
      typeof parsed.ply === "number" &&
      Number.isInteger(parsed.ply) &&
      "text" in parsed &&
      typeof parsed.text === "string" &&
      parsed.text.length > 0
    ) {
      generatedComment = parsed as GeneratedCommentMetadata;
    } else {
      generatedComment = {
        schemaVersion: 1,
        gameId: "pgn-import",
        ply: fallbackPly,
        text: decoded,
      };
    }
  } catch {
    // Backward-compatible import for the initial text-only marker format.
    generatedComment = {
      schemaVersion: 1,
      gameId: "pgn-import",
      ply: fallbackPly,
      text: decoded,
    };
  }
  if (!generatedComment.text) return { comment: value };

  let before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  const visibleGeneratedText = `[Chess Reviewer: Bình luận tự động]\n${generatedComment.text}`;
  const generatedTail = `${visibleGeneratedText}\n\n`;
  const generatedWithSeparator = `\n\n${generatedTail}`;
  if (before.endsWith(generatedWithSeparator)) {
    before = before.slice(0, -generatedWithSeparator.length);
  } else if (before === generatedTail) {
    before = "";
  }
  const comment = `${before.endsWith("\n\n") ? before.slice(0, -2) : before}${after}`;
  return { comment, generatedComment };
}

import type { SelectedLineRange } from "@pierre/diffs";
import { File, Virtualizer } from "@pierre/diffs/react";
import {
  WorkflowArtifactComment,
  type EnvironmentId,
  type WorkflowArtifact,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Check, FileText, MessageSquare } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { randomUUID } from "../../lib/utils";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useTheme } from "../../hooks/useTheme";
import { DIFF_SURFACE_THEME_UNSAFE_CSS, resolveDiffThemeName } from "../../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";
import { resolvePathLinkTarget } from "../../terminal-links";
import ChatMarkdown from "../ChatMarkdown";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { DiffCommentAnnotation } from "../diffs/DiffCommentAnnotation";
import { formatFileCommentRange, normalizeFileCommentRange } from "../files/fileCommentAnnotations";

const ReviewDraft = Schema.Struct({
  artifactRevision: Schema.NullOr(Schema.String),
  comments: Schema.Array(Schema.Struct({ ...WorkflowArtifactComment.fields, id: Schema.String })),
  draft: Schema.NullOr(
    Schema.Struct({
      startLine: Schema.Number,
      endLine: Schema.Number,
      text: Schema.String,
      editingId: Schema.NullOr(Schema.String),
    }),
  ),
});
const EMPTY_REVIEW: typeof ReviewDraft.Type = { artifactRevision: null, comments: [], draft: null };

interface WorkflowArtifactSourceProps {
  artifact: typeof WorkflowArtifact.Type;
  reviewKey: string;
  comments: typeof ReviewDraft.Type.comments;
  canComment: boolean;
  selectedStartLine: number | null;
  selectedEndLine: number | null;
  onBeginComment: (range: SelectedLineRange | null) => void;
}

// Draft persistence decodes fresh comment objects on each keystroke. Only changes
// visible in the source view should rebuild Pierre's annotations and layout.
const WorkflowArtifactSource = memo(
  function WorkflowArtifactSource({
    artifact,
    reviewKey,
    comments,
    canComment,
    selectedStartLine,
    selectedEndLine,
    onBeginComment,
  }: WorkflowArtifactSourceProps) {
    const { resolvedTheme } = useTheme();
    const annotations = useMemo(() => {
      const byLine = new Map<number, (typeof comments)[number][]>();
      for (const comment of comments) {
        const entries = byLine.get(comment.endLine) ?? [];
        entries.push(comment);
        byLine.set(comment.endLine, entries);
      }
      return Array.from(byLine, ([lineNumber, metadata]) => ({ lineNumber, metadata }));
    }, [comments]);

    return (
      <DiffWorkerPoolProvider>
        <Virtualizer className="file-preview-virtualizer min-h-0 flex-1 overflow-auto">
          <File
            file={{
              name: artifact.path,
              contents: artifact.content,
              cacheKey: `${reviewKey}:${artifact.revision}`,
            }}
            options={{
              disableFileHeader: true,
              enableGutterUtility: canComment,
              enableLineSelection: canComment,
              onGutterUtilityClick: onBeginComment,
              onLineSelectionEnd: onBeginComment,
              overflow: "wrap",
              theme: resolveDiffThemeName(resolvedTheme),
              preferredHighlighter: PREFERRED_HIGHLIGHTER,
              themeType: resolvedTheme,
              unsafeCSS: DIFF_SURFACE_THEME_UNSAFE_CSS,
            }}
            selectedLines={
              selectedStartLine !== null && selectedEndLine !== null
                ? { start: selectedStartLine, end: selectedEndLine }
                : null
            }
            lineAnnotations={annotations}
            renderAnnotation={({ metadata }) => (
              <div>
                {metadata.map((comment) => (
                  <DiffCommentAnnotation
                    key={comment.id}
                    kind="comment"
                    rangeLabel={formatFileCommentRange(comment.startLine, comment.endLine)}
                    text={comment.text}
                    onCancel={() => undefined}
                    onComment={() => undefined}
                  />
                ))}
              </div>
            )}
            className="min-h-full"
          />
        </Virtualizer>
      </DiffWorkerPoolProvider>
    );
  },
  (previous, next) =>
    previous.artifact.path === next.artifact.path &&
    previous.artifact.revision === next.artifact.revision &&
    previous.artifact.content === next.artifact.content &&
    previous.reviewKey === next.reviewKey &&
    previous.canComment === next.canComment &&
    previous.selectedStartLine === next.selectedStartLine &&
    previous.selectedEndLine === next.selectedEndLine &&
    previous.onBeginComment === next.onBeginComment &&
    previous.comments.length === next.comments.length &&
    previous.comments.every((comment, index) => {
      const other = next.comments[index];
      return (
        other !== undefined &&
        comment.id === other.id &&
        comment.startLine === other.startLine &&
        comment.endLine === other.endLine &&
        comment.text === other.text
      );
    }),
);

export function WorkflowArtifactReview({
  artifact,
  environmentId,
  cwd,
  reviewKey,
  canReview,
  busy,
  onClose,
  onApprove,
  onRequestRevision,
}: {
  artifact: typeof WorkflowArtifact.Type;
  environmentId: EnvironmentId;
  cwd: string | undefined;
  reviewKey: string;
  canReview: boolean;
  busy: boolean;
  onClose: () => void;
  onApprove: () => Promise<boolean>;
  onRequestRevision: (
    comments: readonly (typeof WorkflowArtifactComment.Type)[],
  ) => Promise<boolean>;
}) {
  const [source, setSource] = useState(false);
  // Keep unfinished feedback tied to the exact version the user reviewed.
  const [review, setReview] = useLocalStorage(reviewKey, EMPTY_REVIEW, ReviewDraft);
  const draft = review.draft;
  const hasFeedback = review.comments.length > 0 || draft !== null;
  const stale = hasFeedback && review.artifactRevision !== artifact.revision;
  const beginComment = useCallback(
    (range: SelectedLineRange | null) => {
      if (!range || busy || !canReview) return;
      setReview((current) => {
        if (
          current.draft ||
          (current.comments.length > 0 && current.artifactRevision !== artifact.revision)
        )
          return current;
        return {
          ...current,
          artifactRevision: artifact.revision,
          draft: { ...normalizeFileCommentRange(range), text: "", editingId: null },
        };
      });
    },
    [artifact.revision, busy, canReview, setReview],
  );
  const cancelDraft = () => setReview({ ...review, draft: null });
  const saveComment = (text: string) => {
    if (!draft || busy || stale) return;
    const comment = {
      id: draft.editingId ?? randomUUID(),
      startLine: draft.startLine,
      endLine: draft.endLine,
      text,
    };
    setReview({
      ...review,
      comments:
        draft.editingId === null
          ? [...review.comments, comment]
          : review.comments.map((entry) => (entry.id === draft.editingId ? comment : entry)),
      draft: null,
    });
  };
  const lastSeparator = Math.max(artifact.path.lastIndexOf("/"), artifact.path.lastIndexOf("\\"));
  const imageBaseDir =
    lastSeparator >= 0 && cwd
      ? resolvePathLinkTarget(artifact.path.slice(0, lastSeparator), cwd)
      : cwd;

  return (
    <section className="workflow-file-view" aria-label={artifact.path}>
      <header className="workflow-file-heading">
        <FileText size={16} />
        <span>{artifact.path}</span>
        <button
          className="workflow-button"
          aria-pressed={source}
          onClick={() => setSource(!source)}
        >
          {source ? "Rendered Markdown" : canReview ? "Comment on lines" : "View source"}
        </button>
        <button className="workflow-button" disabled={busy} onClick={onClose}>
          Close file
        </button>
      </header>
      {source ? (
        <>
          {canReview && (
            <p className="workflow-file-help">
              Select a line number or drag across line numbers to leave a comment.
            </p>
          )}
          <WorkflowArtifactSource
            artifact={artifact}
            reviewKey={reviewKey}
            comments={stale ? EMPTY_REVIEW.comments : review.comments}
            canComment={canReview && !draft && !busy && !stale}
            selectedStartLine={draft && !stale ? draft.startLine : null}
            selectedEndLine={draft && !stale ? draft.endLine : null}
            onBeginComment={beginComment}
          />
        </>
      ) : (
        <div className="workflow-file-document">
          <ChatMarkdown
            text={artifact.content}
            cwd={cwd}
            imageBaseDir={imageBaseDir}
            environmentId={environmentId}
          />
        </div>
      )}
      {canReview && (
        <footer className="workflow-file-review">
          {stale && (
            <div className="workflow-stale-review" role="alert">
              <p>
                The file changed since you wrote this feedback. Copy any comments you want to keep,
                then start a new review of the current lines.
              </p>
              {draft && (
                <p>
                  Unfinished comment on {formatFileCommentRange(draft.startLine, draft.endLine)}:{" "}
                  {draft.text || "(empty)"}
                </p>
              )}
              <button
                className="workflow-button"
                disabled={busy}
                onClick={() => setReview(EMPTY_REVIEW)}
              >
                Clear old feedback and start new review
              </button>
            </div>
          )}
          {draft && !stale && (
            <div>
              <p className="workflow-file-help">
                Comment on {formatFileCommentRange(draft.startLine, draft.endLine)}
              </p>
              <DiffCommentAnnotation
                kind="draft"
                rangeLabel={formatFileCommentRange(draft.startLine, draft.endLine)}
                text={draft.text}
                onTextChange={(text) => setReview({ ...review, draft: { ...draft, text } })}
                onCancel={cancelDraft}
                onComment={saveComment}
                submitLabel={draft.editingId === null ? "Add comment" : "Save comment"}
                pending={busy}
              />
            </div>
          )}
          {review.comments.length > 0 && (
            <div className="workflow-review-comments" aria-label="Revision comments">
              {review.comments.map((comment) => (
                <div className="workflow-review-comment" key={comment.id}>
                  <strong>{formatFileCommentRange(comment.startLine, comment.endLine)}</strong>
                  <p>{comment.text}</p>
                  <button
                    className="workflow-button"
                    disabled={busy || draft !== null || stale}
                    onClick={() =>
                      setReview({ ...review, draft: { ...comment, editingId: comment.id } })
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="workflow-button"
                    disabled={busy || draft !== null || stale}
                    onClick={() =>
                      setReview({
                        ...review,
                        comments: review.comments.filter((entry) => entry.id !== comment.id),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="workflow-review-actions">
            <p className="workflow-help">
              {hasFeedback
                ? "Request revision to send your comments back to the author."
                : "Approve the document or comment on lines to request changes."}
            </p>
            <button
              className="workflow-button"
              disabled={busy || hasFeedback}
              onClick={async () => {
                if (await onApprove()) setReview(EMPTY_REVIEW);
              }}
            >
              <Check size={14} />
              Approve
            </button>
            <button
              className="workflow-button is-primary"
              disabled={busy || draft !== null || stale || review.comments.length === 0}
              onClick={async () => {
                if (
                  await onRequestRevision(
                    review.comments.map(({ startLine, endLine, text }) => ({
                      startLine,
                      endLine,
                      text,
                    })),
                  )
                )
                  setReview(EMPTY_REVIEW);
              }}
            >
              <MessageSquare size={14} />
              Request revision{review.comments.length > 0 ? ` (${review.comments.length})` : ""}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

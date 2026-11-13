/** Bind a missing session only on explicit product entry to ask, never after
 * native archive/close operations. Deferred workspace readiness keeps one intent. */
export function createLearningSpaceBinding(ctx, isAskActive) {
  let requested = false;
  const attempt = () => {
    if (!requested || !isAskActive()) return;
    const panel = ctx.layout.panelInfo.getSnapshot().activePanelId;
    if (panel !== null && panel !== 'conversation') { requested = false; return; }
    const workspace = ctx.workspaces.list.getSnapshot();
    const sessions = ctx.sessions.list.getSnapshot();
    if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return;
    if (ctx.uiWorkspace.selection.getSnapshot().sessionId !== undefined) {
      requested = false;
      return;
    }
    const learningSpace = ctx.get('zhiyunLearningSpace');
    const target = learningSpace?.pickLearningWorkspace(workspace.items, learningSpace.title);
    if (target === undefined) return;
    requested = false;
    ctx.uiWorkspace.startSession(target.workspaceId);
  };
  ctx.effect(() => ctx.workspaces.list.subscribe(attempt), 'zhiyun: bind learning space (workspaces)');
  ctx.effect(() => ctx.sessions.list.subscribe(attempt), 'zhiyun: bind learning space (sessions)');
  return {
    enter() { requested = true; attempt(); },
    reset() { requested = false; },
  };
}

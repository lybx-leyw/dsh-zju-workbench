/** Dependency-free persisted contract for project-based learning content. */
/** Cheap structural guard aligned with the app's persisted-project check. */
export function isPBLProject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const project = value;
    return (['hero', 'generating', 'workspace', 'completed'].includes(project.uiPhase) &&
        typeof project.title === 'string' &&
        typeof project.description === 'string' &&
        Array.isArray(project.tags) &&
        typeof project.language === 'string' &&
        typeof project.proficiency === 'string' &&
        ['designing', 'review', 'active', 'completed', 'archived'].includes(project.status) &&
        Array.isArray(project.milestones) &&
        Array.isArray(project.roles) &&
        Array.isArray(project.submissions) &&
        Array.isArray(project.evaluations) &&
        Array.isArray(project.threads) &&
        Array.isArray(project.engagementEvents) &&
        typeof project.createdAt === 'string' &&
        typeof project.updatedAt === 'string');
}
/** Cheap structural guard for current and legacy {@link PBLContent}. */
export function isPBLContent(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const content = value;
    if (content.type !== 'pbl')
        return false;
    if (content.projectV2 !== undefined && !isPBLProject(content.projectV2))
        return false;
    if (content.projectConfig !== undefined &&
        (typeof content.projectConfig !== 'object' ||
            content.projectConfig === null ||
            Array.isArray(content.projectConfig)))
        return false;
    return true;
}
//# sourceMappingURL=pbl.js.map
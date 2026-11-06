/** Dependency-free persisted contract for project-based learning content. */
export type PBLProjectStatus = 'designing' | 'review' | 'active' | 'completed' | 'archived';
export type PBLMilestoneStatus = 'locked' | 'active' | 'completed';
export type PBLMicrotaskStatus = 'todo' | 'in_progress' | 'completed' | 'skipped';
export type PBLRoleType = 'user' | 'instructor' | 'evaluator' | 'mentor' | 'collaborator' | 'simulator' | 'system';
export type PBLProficiency = '' | 'beginner' | 'intermediate' | 'advanced';
export type PBLAssignee = 'user';
export type PBLUiPhase = 'hero' | 'generating' | 'workspace' | 'completed';
export interface PBLRole {
    id: string;
    type: PBLRoleType;
    name: string;
    description?: string;
    systemPrompt?: string;
}
/**
 * Documents written before the design-template strip may carry app runtime
 * fields; the contract tolerates unknown members on the project tree for that
 * reason and does not interpret them.
 */
export interface PBLMicrotask {
    id: string;
    title: string;
    description?: string;
    /** Seeded to the canonical `todo` value in stored documents. */
    status: PBLMicrotaskStatus;
    /** Seeded to the canonical `user` value in stored documents. */
    assignee: PBLAssignee;
    hints: string[];
    order: number;
    completionCriteria?: string;
    successWhen?: string;
    characterObjective?: string;
    skillFocus?: string;
    narration?: string;
    learnerBrief?: string;
}
export interface PBLDocument {
    id: string;
    title: string;
    content: string;
    docType: 'markdown' | 'reference' | 'starter_file';
}
/**
 * Documents written before the design-template strip may carry app runtime
 * fields; the contract tolerates unknown members on the project tree for that
 * reason and does not interpret them.
 */
export interface PBLMilestone {
    id: string;
    title: string;
    description?: string;
    /** Seeded to `active` for the first milestone and `locked` for the rest. */
    status: PBLMilestoneStatus;
    order: number;
    microtasks: PBLMicrotask[];
    documents?: PBLDocument[];
    briefing?: string;
    completionCriteria?: string;
    debrief?: string;
    synthesisCheck?: {
        coreConcept: string;
    };
    scenarioStage?: 'prep' | 'roleplay' | 'wrapup';
}
export interface PBLScenarioCharacter {
    id: string;
    name: string;
    persona: string;
    situation?: string;
    boundaries?: string;
    avatar?: string;
    openingLine?: string;
}
export interface PBLSceneVisual {
    caption?: string;
    bg1?: string;
    bg2?: string;
    accent?: string;
    motifs?: string[];
}
export interface PBLScenarioConfig {
    setting: string;
    sceneVisual?: PBLSceneVisual;
    goal?: string;
    rules?: string;
    learnerRole?: string;
    characters: PBLScenarioCharacter[];
}
/**
 * Persisted seat for an agent chat thread. `messages` is seeded empty in
 * stored documents; message contents belong to the app domain and are not
 * interpreted by this contract. Documents written before the design-template
 * strip may carry app runtime fields; the contract tolerates unknown members on
 * the project tree for that reason and does not interpret them.
 */
export interface PBLThreadSeat {
    agentId: string;
    messages: unknown[];
}
/**
 * Design-time PBL definition plus the canonical planner-seeded initial
 * skeleton. Documents written before the design-template strip may carry app
 * runtime fields; the contract tolerates unknown members on the project tree
 * for that reason and does not interpret them.
 */
export interface PBLProject {
    /** Seeded to the canonical `hero` value in stored documents. */
    uiPhase: PBLUiPhase;
    title: string;
    description: string;
    learningObjective?: string;
    gains?: string[];
    tags: string[];
    language: string;
    languageDirective?: string;
    scenario?: PBLScenarioConfig;
    schemaVersion?: number;
    proficiency: PBLProficiency;
    /** Seeded to the canonical `active` value in stored documents. */
    status: PBLProjectStatus;
    roles: PBLRole[];
    milestones: PBLMilestone[];
    /** Seeded to an empty array in stored documents; elements are app domain. */
    submissions: unknown[];
    /** Seeded to an empty array in stored documents; elements are app domain. */
    evaluations: unknown[];
    /** Seeded to canonical thread seats with empty `messages` arrays. */
    threads: PBLThreadSeat[];
    /** Seeded to an empty array in stored documents; elements are app domain. */
    engagementEvents: unknown[];
    createdAt: string;
    updatedAt: string;
}
export interface PBLContent {
    type: 'pbl';
    projectV2?: PBLProject;
    /**
     * Pre-v2 scenes carry the legacy payload; current code still writes a
     * compatibility mirror alongside `projectV2`, and #1058 retires that write
     * path, after which the field is read-only history. The contract records its
     * existence and does not interpret it.
     * @deprecated
     */
    projectConfig?: Record<string, unknown>;
}
/** Cheap structural guard aligned with the app's persisted-project check. */
export declare function isPBLProject(value: unknown): value is PBLProject;
/** Cheap structural guard for current and legacy {@link PBLContent}. */
export declare function isPBLContent(value: unknown): value is PBLContent;
//# sourceMappingURL=pbl.d.ts.map
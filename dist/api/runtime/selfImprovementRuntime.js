export function buildSelfImprovementSessionRuntimeKey(sessionId) {
    const trimmed = sessionId.trim();
    return trimmed ? `session:${trimmed}` : 'global';
}
export function getSelfImprovementSessionRuntimeState(store, sessionKey, createIfMissing = true) {
    const existing = store.get(sessionKey);
    if (existing) {
        return existing;
    }
    const emptyState = {
        modelOptions: {},
        userPreferences: {},
        enabledSkills: new Map(),
        disabledSkillIds: new Set(),
    };
    if (createIfMissing) {
        store.set(sessionKey, emptyState);
    }
    return emptyState;
}
export function getSelfImprovementRuntimeParam(store, sessionKey, param) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey, false);
    return state.modelOptions[param] ?? state.userPreferences[param];
}
export function setSelfImprovementRuntimeParam(store, sessionKey, param, value) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey);
    if (param === 'temperature' && typeof value === 'number' && Number.isFinite(value)) {
        state.modelOptions.temperature = value;
        return;
    }
    if (param === 'verbosity' && typeof value === 'string') {
        const normalizedVerbosity = value.trim();
        if (normalizedVerbosity) {
            state.userPreferences.verbosity = normalizedVerbosity;
        }
        return;
    }
    state.userPreferences[param] = value;
}
export function applySelfImprovementSessionOverrides(store, input) {
    const sessionKey = buildSelfImprovementSessionRuntimeKey(input.sessionId);
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey, false);
    const hasModelOptions = Object.keys(state.modelOptions).length > 0;
    const hasUserPreferences = Object.keys(state.userPreferences).length > 0;
    if (!hasModelOptions && !hasUserPreferences) {
        return input;
    }
    const mergedOptions = hasModelOptions
        ? { ...state.modelOptions, ...(input.options ?? {}) }
        : input.options;
    const mergedUserContextOverride = hasUserPreferences
        ? {
            ...(input.userContextOverride ?? {}),
            preferences: {
                ...state.userPreferences,
                ...(input.userContextOverride?.preferences ?? {}),
            },
        }
        : input.userContextOverride;
    return {
        ...input,
        ...(mergedOptions ? { options: mergedOptions } : {}),
        ...(mergedUserContextOverride ? { userContextOverride: mergedUserContextOverride } : {}),
    };
}
export function enableSelfImprovementSessionSkill(store, sessionKey, skill) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey);
    for (const disabledSkillId of Array.from(state.disabledSkillIds.values())) {
        if (matchesSelfImprovementSkillIdentifier(skill, disabledSkillId)) {
            state.disabledSkillIds.delete(disabledSkillId);
        }
    }
    state.enabledSkills.set(skill.skillId, skill);
}
export function disableSelfImprovementSessionSkill(store, sessionKey, skillId) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey);
    const normalizedSkillId = skillId.trim();
    if (!normalizedSkillId) {
        return;
    }
    for (const [enabledSkillId, enabledSkill] of Array.from(state.enabledSkills.entries())) {
        if (matchesSelfImprovementSkillIdentifier(enabledSkill, normalizedSkillId)) {
            state.enabledSkills.delete(enabledSkillId);
        }
    }
    state.disabledSkillIds.add(normalizedSkillId);
}
export function listSelfImprovementSessionSkills(store, sessionKey) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey, false);
    return Array.from(state.enabledSkills.values()).filter((skill) => !Array.from(state.disabledSkillIds.values()).some((disabledSkillId) => matchesSelfImprovementSkillIdentifier(skill, disabledSkillId)));
}
export function listSelfImprovementDisabledSkillIds(store, sessionKey) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey, false);
    return Array.from(state.disabledSkillIds.values());
}
export function filterCapabilityDiscoveryResultByDisabledSkills(result, disabledSkillIds) {
    const normalizedDisabledSkillIds = Array.from(new Set(disabledSkillIds
        .map(normalizeSelfImprovementSkillIdentifier)
        .filter((skillId) => skillId.length > 0)));
    if (normalizedDisabledSkillIds.length === 0) {
        return result;
    }
    const filteredTier1Base = result.tier1.filter((item) => !matchesDisabledCapability(item.capability, normalizedDisabledSkillIds));
    const filteredTier2 = result.tier2.filter((item) => !matchesDisabledCapability(item.capability, normalizedDisabledSkillIds));
    if (filteredTier1Base.length === result.tier1.length &&
        filteredTier2.length === result.tier2.length) {
        return result;
    }
    const filteredTier1 = filteredTier1Base.map((item, index) => ({
        ...item,
        summaryText: renumberTier1Summary(item.summaryText, index + 1),
    }));
    const filteredTier0 = buildTier0FromFilteredResults(filteredTier1, filteredTier2);
    const tokenEstimate = {
        tier0Tokens: estimateDiscoveryTokens(filteredTier0),
        tier1Tokens: filteredTier1.length > 0
            ? estimateDiscoveryTokens('Relevant capabilities:\n') +
                filteredTier1.reduce((sum, item) => sum + estimateDiscoveryTokens(item.summaryText), 0)
            : 0,
        tier2Tokens: filteredTier2.reduce((sum, item) => sum + estimateDiscoveryTokens(item.fullText), 0),
        totalTokens: 0,
    };
    tokenEstimate.totalTokens =
        tokenEstimate.tier0Tokens + tokenEstimate.tier1Tokens + tokenEstimate.tier2Tokens;
    return {
        ...result,
        tier0: filteredTier0,
        tier1: filteredTier1,
        tier2: filteredTier2,
        tokenEstimate,
        diagnostics: {
            ...result.diagnostics,
            capabilitiesRetrieved: filteredTier1.length + filteredTier2.length,
        },
    };
}
export function buildSelfImprovementSkillPromptContext(store, sessionKey) {
    const state = getSelfImprovementSessionRuntimeState(store, sessionKey, false);
    const enabledSkills = listSelfImprovementSessionSkills(store, sessionKey);
    const disabledSkillIds = Array.from(state.disabledSkillIds.values());
    if (enabledSkills.length === 0 && disabledSkillIds.length === 0) {
        return undefined;
    }
    const lines = [
        'Session Skill Modules',
        'Use enabled skills below as additional task guidance when relevant.',
    ];
    const maxSkills = 3;
    for (const skill of enabledSkills.slice(0, maxSkills)) {
        lines.push('');
        lines.push(`### ${skill.name} (${skill.category})`);
        if (skill.description) {
            lines.push(`Description: ${skill.description}`);
        }
        if (skill.content) {
            lines.push(truncateSkillContent(skill.content, 1200));
        }
    }
    if (enabledSkills.length > maxSkills) {
        lines.push('');
        lines.push(`Additional enabled skills not expanded: ${enabledSkills.length - maxSkills}`);
    }
    if (disabledSkillIds.length > 0) {
        lines.push('');
        lines.push(`Disabled session skills: ${disabledSkillIds.join(', ')}`);
        lines.push('Do not rely on disabled skills when planning or responding.');
    }
    return lines.join('\n').trim();
}
function truncateSkillContent(content, maxChars) {
    const trimmed = content.trim();
    if (trimmed.length <= maxChars) {
        return trimmed;
    }
    return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
function normalizeSelfImprovementSkillIdentifier(value) {
    return value.trim().toLowerCase();
}
function getSelfImprovementSkillAliases(skill) {
    return Array.from(new Set([skill.skillId, skill.name, `skill:${skill.skillId}`, `skill:${skill.name}`]
        .map((value) => normalizeSelfImprovementSkillIdentifier(value))
        .filter((value) => value.length > 0)));
}
function matchesSelfImprovementSkillIdentifier(skill, candidate) {
    const normalizedCandidate = normalizeSelfImprovementSkillIdentifier(candidate);
    if (!normalizedCandidate) {
        return false;
    }
    return getSelfImprovementSkillAliases(skill).includes(normalizedCandidate);
}
function matchesDisabledCapability(capability, normalizedDisabledSkillIds) {
    if (capability.kind !== 'skill') {
        return false;
    }
    const aliases = Array.from(new Set([
        capability.id,
        capability.name,
        capability.displayName,
        capability.sourceRef.type === 'skill' ? capability.sourceRef.skillName : '',
    ]
        .map((value) => normalizeSelfImprovementSkillIdentifier(value))
        .filter((value) => value.length > 0)));
    return normalizedDisabledSkillIds.some((disabledSkillId) => aliases.includes(disabledSkillId));
}
function renumberTier1Summary(summaryText, index) {
    return `${index}. ${summaryText.replace(/^\d+\.\s*/, '')}`;
}
function estimateDiscoveryTokens(text) {
    return Math.ceil(text.length / 4);
}
function buildTier0FromFilteredResults(tier1, tier2) {
    const uniqueCapabilities = new Map();
    for (const item of tier1) {
        uniqueCapabilities.set(item.capability.id, item.capability);
    }
    for (const item of tier2) {
        uniqueCapabilities.set(item.capability.id, item.capability);
    }
    const groupedByCategory = new Map();
    for (const capability of uniqueCapabilities.values()) {
        const category = capability.category || 'other';
        const displayName = capability.name || capability.displayName || capability.id;
        const names = groupedByCategory.get(category) ?? [];
        names.push(displayName);
        groupedByCategory.set(category, names);
    }
    const lines = ['Available capability categories:'];
    for (const [category, names] of Array.from(groupedByCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
        lines.push(`- ${capitalizeDiscoveryCategory(category)}: ${names.slice(0, 4).join(', ')} (${names.length})`);
    }
    lines.push('Use discover_capabilities tool to get details on any capability.');
    return lines.join('\n');
}
function capitalizeDiscoveryCategory(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
//# sourceMappingURL=selfImprovementRuntime.js.map
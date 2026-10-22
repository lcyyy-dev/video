// @ts-check
/** The advertising client's supported surface. Shared by the UI and desktop process. */
export const CLIENT_AGENTS = Object.freeze(['codex']);
export const CLIENT_SKILLS = Object.freeze(['ad-editing']);
export const CLIENT_EXPORTS = Object.freeze(['video', 'nle', 'project']);

/** Keep this client's workflow separate from the general-purpose command-line package. */
export const CLIENT_PROFILE = 'advertising';

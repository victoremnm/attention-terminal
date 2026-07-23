import type { ApiClientConfiguration } from "@trigger.dev/sdk";

// Preview deployments do not automatically have a matching Trigger.dev
// preview branch. An explicit empty value prevents the SDK from falling back
// to VERCEL_GIT_COMMIT_REF and keeps the app on the default dev environment.
// Set TRIGGER_PREVIEW_BRANCH only after the corresponding Trigger preview
// branch has been created and deployed.
const configuredPreviewBranch = process.env.TRIGGER_PREVIEW_BRANCH?.trim();

export const attentionTriggerApiClient: ApiClientConfiguration = {
  previewBranch: configuredPreviewBranch ?? "",
};

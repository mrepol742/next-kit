import "server-only";
import { RecaptchaEnterpriseServiceClient } from "@google-cloud/recaptcha-enterprise";

export interface RecaptchaOptions {
  projectId: string;
  siteKey: string;
  minimumScore?: number;
  credentials?: { client_email?: string; private_key?: string };
  /** Optional seam for testing or supplying an existing Google client. */
  client?: Pick<
    RecaptchaEnterpriseServiceClient,
    "projectPath" | "createAssessment"
  >;
  onError?: (error: unknown) => void;
}

export function createRecaptchaVerifier(options: RecaptchaOptions) {
  const minimumScore = options.minimumScore ?? 0.5;
  if (!options.projectId || !options.siteKey)
    throw new Error("reCAPTCHA requires projectId and siteKey.");
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error("minimumScore must be between 0 and 1.");
  }
  // Without explicit credentials, the Google SDK uses Application Default Credentials.
  const client =
    options.client ??
    new RecaptchaEnterpriseServiceClient({ credentials: options.credentials });
  return async (token: string, action: string): Promise<boolean> => {
    if (!token || !action) return false;
    try {
      const [assessment] = await client.createAssessment({
        parent: client.projectPath(options.projectId),
        assessment: {
          event: { token, siteKey: options.siteKey, expectedAction: action },
        },
      });
      return (
        assessment.tokenProperties?.valid === true &&
        assessment.tokenProperties.action === action &&
        (assessment.riskAnalysis?.score ?? 0) >= minimumScore
      );
    } catch (error) {
      options.onError?.(error);
      return false;
    }
  };
}

import "server-only";

export interface UpStatusProps {
  appName?: string;
}

/**
 * A liveness page, not a database or external-service readiness check.
 *
 * @param appName The name of the application.
 * @returns The rendered liveness page.
 */
export function UpStatus({ appName = "Application" }: UpStatusProps) {
  return (
    <main className="next-kit-up">
      <div>
        <span className="next-kit-up-icon" aria-hidden="true">
          ✓
        </span>
        <h1>{appName} Up</h1>
        <p>The application is responding.</p>
        <dl>
          <dt>Status</dt>
          <dd>UP</dd>
          <dt>Environment</dt>
          <dd>{process.env.NODE_ENV}</dd>
        </dl>
      </div>
    </main>
  );
}

/** Has no custom page props so it can be re-exported directly as a Next.js route. */
export function UpPage() {
  return <UpStatus />;
}

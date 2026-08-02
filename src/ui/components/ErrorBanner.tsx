import { toAppError } from '../../lib/errors';
import { Button } from './Button';
import { Callout } from './Callout';

type Props = {
  error: unknown;
  onRetry?: () => void;
  onReconnect?: () => void;
  onManageAccess?: () => void;
};

/**
 * Renders any thrown value as a message plus the one action that actually helps,
 * chosen from the error's own classification rather than by the calling screen.
 */
export function ErrorBanner({ error, onRetry, onReconnect, onManageAccess }: Props) {
  const appError = toAppError(error);
  const tone = appError.code === 'offline' ? 'warning' : 'danger';

  return (
    <Callout tone={tone} message={appError.message}>
      {appError.action === 'reconnect' && onReconnect ? (
        <Button title="Reconnect to GitHub" onPress={onReconnect} variant="secondary" />
      ) : null}
      {appError.action === 'manage_access' && onManageAccess ? (
        <Button title="Manage access on GitHub" onPress={onManageAccess} variant="secondary" />
      ) : null}
      {appError.retryable && onRetry ? (
        <Button title="Try again" onPress={onRetry} variant="secondary" />
      ) : null}
    </Callout>
  );
}

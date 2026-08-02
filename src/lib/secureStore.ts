import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * The ONLY module in the app that imports expo-secure-store.
 *
 * Secrets live in the iOS Keychain / Android Keystore. WHEN_UNLOCKED_THIS_DEVICE_ONLY
 * means they are readable only while the device is unlocked and never sync to
 * iCloud Keychain or encrypted backups.
 *
 * Note `keychainAccessible` is iOS-only; on Android protection comes from the
 * Keystore, and excluding the value from Android Auto Backup requires
 * `android.allowBackup: false` in a native build (not configurable in Expo Go).
 *
 * We deliberately do NOT set `requireAuthentication: true` — it would trigger a
 * biometric prompt on every silent read, including ones fired mid-scroll by a
 * 401 retry, and it is unsupported in Expo Go on Android.
 *
 * This is raw storage only. Validating what comes back — shape, version, whether
 * it still belongs to the current account — is the caller's job, because only
 * the caller knows what a valid record looks like.
 */

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'quizbot',
};

export function isSecureStoreAvailable(): boolean {
  return Platform.OS !== 'web';
}

/**
 * Fails loudly rather than silently storing nothing. `feature` names what the
 * user was trying to do, so the message says which thing is unavailable.
 */
export function assertSecureStore(feature: string): void {
  if (!isSecureStoreAvailable()) {
    throw new Error(
      `expo-secure-store has no web implementation, so ${feature} is not supported on web. Run on iOS or Android.`,
    );
  }
}

/**
 * Reads a secret, deleting it if the read itself fails.
 *
 * A throw here means the entry is unreadable rather than absent — Android
 * Keystore invalidation after a biometric enrollment change is the usual cause.
 * Leaving it in place would produce the same failure on every launch, so it is
 * removed and reported as "no secret", which routes the user into a normal
 * re-entry flow.
 */
export async function readSecret(key: string): Promise<string | null> {
  assertSecureStore('this feature');
  try {
    return await SecureStore.getItemAsync(key, SECURE_OPTIONS);
  } catch {
    await deleteSecret(key).catch(() => undefined);
    return null;
  }
}

export async function writeSecret(key: string, value: string): Promise<void> {
  assertSecureStore('this feature');
  await SecureStore.setItemAsync(key, value, SECURE_OPTIONS);
}

export async function deleteSecret(key: string): Promise<void> {
  if (!isSecureStoreAvailable()) return;
  await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
}

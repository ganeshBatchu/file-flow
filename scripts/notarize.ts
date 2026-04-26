/**
 * electron-builder afterSign hook — submits the .dmg / .app to Apple's
 * notary service for stapling.
 *
 * WHEN THIS RUNS
 *
 *   electron-builder calls afterSign once per macOS target after the
 *   bundle has been code-signed but before it's wrapped into the final
 *   .dmg. We're invoked twice: once for the dmg target (sign with
 *   Developer-ID Application; THIS hook needs to notarize), once for
 *   the mas target (sign with 3rd Party Mac Developer Application;
 *   MUST NOT be sent to notarytool — App Store has its own scanner).
 *
 *   The check for `electronPlatformName === 'darwin'` and
 *   `appOutDir` not containing 'mas' is what disambiguates.
 *
 * WHY NOTARIZE
 *
 *   Since macOS Catalina (10.15), Gatekeeper refuses to launch any
 *   app downloaded from the web that isn't notarized — even if it's
 *   Developer-ID-signed. The error is the cryptic "FileFlow can't be
 *   opened because Apple cannot check it for malicious software."
 *   Notarization is the fix: Apple scans the binary, signs a ticket,
 *   and we staple that ticket into the bundle so Gatekeeper sees it
 *   offline.
 *
 *   The MAS .pkg goes through Apple's separate App Store ingestion
 *   pipeline, which has its own equivalent step. Sending a MAS bundle
 *   to notarytool is harmless but wastes ~2 minutes of CI per build.
 *
 * REQUIRED ENV VARS
 *
 *   APPLE_ID                 — Apple ID email used to log in to App
 *                              Store Connect.
 *   APPLE_APP_SPECIFIC_PASSWORD
 *                            — App-specific password generated at
 *                              appleid.apple.com/account/manage. NOT
 *                              your real Apple password — that won't
 *                              work because notarytool requires 2FA-
 *                              compatible credentials.
 *   APPLE_TEAM_ID            — 10-character Team ID from
 *                              developer.apple.com/account#MembershipDetailsCard.
 *
 *   If any of the three is missing we SKIP notarization with a warning
 *   instead of failing the build. This is intentional: developers
 *   running `npm run dist` locally for a smoke test shouldn't need to
 *   load Apple credentials, and CI sets these via repository secrets.
 *   The unstapled .dmg is still a valid signed bundle — it just can't
 *   be distributed to end users until it's notarized in a separate
 *   step.
 */
import { notarize } from '@electron/notarize';
import path from 'path';

interface AfterSignContext {
  electronPlatformName: string;
  appOutDir: string;
  packager: { appInfo: { productFilename: string } };
}

export default async function afterSign(context: AfterSignContext): Promise<void> {
  const { electronPlatformName, appOutDir } = context;

  // Only macOS bundles need notarization. Windows / Linux builds skip.
  if (electronPlatformName !== 'darwin') return;

  // The MAS pipeline (target=mas) signs with a different cert and goes
  // through App Store ingestion, not the notary service. electron-builder
  // puts MAS output in a directory whose name contains "mas" — easiest
  // fingerprint without requiring electron-builder to pass us the target.
  if (appOutDir.includes('mas')) {
    console.log('[notarize] Skipping MAS bundle (App Store handles its own scan)');
    return;
  }

  const appleId = process.env['APPLE_ID'];
  const appleIdPassword = process.env['APPLE_APP_SPECIFIC_PASSWORD'];
  const teamId = process.env['APPLE_TEAM_ID'];

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      '[notarize] Skipping notarization — APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, ' +
        'or APPLE_TEAM_ID is missing. The .dmg will be signed but NOT notarized; ' +
        "Gatekeeper will refuse to launch it on a fresh macOS until you " +
        'notarize it in a separate step (`xcrun notarytool submit`).',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Submitting ${appPath} to Apple's notary service…`);
  console.log('[notarize] This typically takes 2–10 minutes. Be patient.');

  try {
    await notarize({
      // tool: 'notarytool' is required since November 2023 — Apple
      // retired the legacy altool path. The discriminated-union type
      // for NotarizeOptions in @electron/notarize requires this field
      // to be set explicitly so TypeScript knows we're using the
      // notarytool credentials shape (which needs teamId; legacy didn't).
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log('[notarize] Success. Ticket has been stapled into the bundle.');
  } catch (err) {
    // Re-throw so the build fails loudly. A silently-unnotarized .dmg
    // that ships to users is the worst outcome — every install would
    // hit a Gatekeeper wall on first launch.
    console.error('[notarize] Notarization FAILED:', (err as Error).message);
    throw err;
  }
}

// Which app this build is. "release" is Logcadence as published on GitHub; "dev" is LogcadenceDev, the preview
// build of the dev branch (pnpm preview): its own name, settings, library and port, so both run side by side,
// and no auto-update. Set at bundle time by scripts/build-electron.ts (--channel, --label).

declare const __CHANNEL__: string | undefined
declare const __BUILD_LABEL__: string | undefined

export const IS_DEV_CHANNEL = typeof __CHANNEL__ !== 'undefined' && __CHANNEL__ === 'dev'
export const APP_NAME = IS_DEV_CHANNEL ? 'LogcadenceDev' : 'Logcadence'
/** The dev version as tagged (0.2.0.3), shown in the title bar; empty for release builds. */
export const BUILD_LABEL = typeof __BUILD_LABEL__ !== 'undefined' ? __BUILD_LABEL__ : ''
// 3002 is fixed for the release app because Spotify's login redirect is registered for it; LogcadenceDev needs
// http://127.0.0.1:3003/api/spotify/callback added to the Spotify app to log in.
export const PORT = IS_DEV_CHANNEL ? 3003 : 3002

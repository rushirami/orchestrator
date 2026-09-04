import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import * as AppActivationIpc from "./methods/appActivation.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import * as PreviewIpc from "./methods/preview.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import {
  getAppBranding,
  getLocalEnvironmentBearerToken,
  getLocalEnvironmentBootstraps,
  getSystemLocale,
  getWindowFullscreenState,
  openExternal,
  pickFolder,
  pickProjectFavicon,
  pickThemeFiles,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";
import { getWslState, setWslBackendEnabled, setWslDistro, setWslOnly } from "./methods/wsl.ts";

export const installDesktopIpcHandlers = Effect.fn("desktop.ipc.installHandlers")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* PreviewIpc.installPreviewEventForwarding();

  yield* ipc.handle(AppActivationIpc.setReady);
  yield* ipc.handle(AppActivationIpc.complete);

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getSystemLocale);
  yield* ipc.handleSync(getWindowFullscreenState);
  yield* ipc.handleSync(getLocalEnvironmentBootstraps);
  yield* ipc.handle(getLocalEnvironmentBearerToken);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);

  yield* ipc.handle(getWslState);
  yield* ipc.handle(setWslBackendEnabled);
  yield* ipc.handle(setWslDistro);
  yield* ipc.handle(setWslOnly);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(pickProjectFavicon);
  yield* ipc.handle(pickThemeFiles);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  for (const previewMethod of PreviewIpc.methods) {
    yield* ipc.handle(previewMethod);
  }
  yield* ipc.handle(PreviewIpc.listBrowserImportSources);
  yield* ipc.handle(PreviewIpc.importBrowserCookies);
});

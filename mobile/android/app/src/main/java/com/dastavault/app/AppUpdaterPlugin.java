package com.dastavault.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * In-app updates: tells the web app which version is installed, downloads a
 * new APK and opens Android's installer for it (Android asks the user to
 * confirm; an app cannot update itself silently).
 *
 * Used from the web app as window.Capacitor.Plugins.AppUpdater
 * (frontend/src/components/common/AppUpdate.jsx).
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
            JSObject result = new JSObject();
            result.put("versionName", info.versionName);
            result.put("versionCode", code);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not read the app version", e);
        }
    }

    /** Android 8+: the user must allow DastaVault to install apps once, in Settings. */
    private boolean mayInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", mayInstall());
        call.resolve(result);
    }

    /** Opens the "Install unknown apps" switch for DastaVault. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
                : new Intent(Settings.ACTION_SECURITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the setting", e);
        }
    }

    /** Opens an address in the phone's browser (Chrome downloads the APK itself). */
    @PluginMethod
    public void openInBrowser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Invalid address");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No browser found", e);
        }
    }

    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String APK_NAME = "DastaVault-update.apk";
    private static final String PREFS = "app_updater";

    private DownloadManager downloads() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File apkFile() {
        return new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), APK_NAME);
    }

    /**
     * Downloads the APK with Android's download manager, so it goes on when the
     * app is in the background or closed, and after the connection comes back
     * (progress in the notification). Then Android's installer is opened: right
     * away when the app is on screen, otherwise when it is opened again (or from
     * the notification). A download of the same address that is running or
     * done is reused.
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Invalid download address");
            return;
        }
        if (!mayInstall()) {
            call.reject("NOT_ALLOWED");
            return;
        }
        try {
            DownloadManager dm = downloads();
            long id = prefs().getLong("id", -1);
            if (id != -1 && url.equals(prefs().getString("url", ""))) {
                int status = statusOf(dm, id);
                if (status == DownloadManager.STATUS_SUCCESSFUL && apkFile().exists()) {
                    install();
                    call.resolve();
                    return;
                }
                if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                    watch(call, id);
                    return;
                }
            }
            if (id != -1) dm.remove(id);
            File file = apkFile();
            if (file.exists() && !file.delete()) throw new IllegalStateException("Cannot replace " + file);

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle("DastaVault update")
                .setDescription("Downloading the new version")
                .setMimeType(APK_MIME)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
                .setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, APK_NAME);
            id = dm.enqueue(request);
            prefs().edit().putLong("id", id).putString("url", url).putBoolean("ready", false).apply();
            watch(call, id);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
        }
    }

    private static int statusOf(DownloadManager dm, long id) {
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (c == null || !c.moveToFirst()) return -1;
            return c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
        }
    }

    /** Reports the progress of download `id` until it ends, then installs. */
    private void watch(PluginCall call, long id) {
        new Thread(() -> {
            DownloadManager dm = downloads();
            double lastProgress = -1;
            try {
                while (true) {
                    int status;
                    long done;
                    long total;
                    int reason;
                    try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
                        if (c == null || !c.moveToFirst()) {
                            call.reject("The download was cancelled");
                            return;
                        }
                        status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                    }
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        prefs().edit().putBoolean("ready", true).apply();
                        install();
                        call.resolve();
                        return;
                    }
                    if (status == DownloadManager.STATUS_FAILED) {
                        call.reject("Download failed (" + reason + ")");
                        return;
                    }
                    if (total > 0) {
                        double progress = (double) done / total;
                        if (progress - lastProgress >= 0.01) {
                            lastProgress = progress;
                            JSObject event = new JSObject();
                            event.put("progress", progress);
                            event.put("waiting", status == DownloadManager.STATUS_PAUSED);
                            notifyListeners("downloadProgress", event);
                        }
                    }
                    Thread.sleep(500);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
            }
        }).start();
    }

    /** Opens Android's installer for the downloaded APK when it is newer than this app. */
    private void install() {
        File file = apkFile();
        if (!file.exists()) return;
        try {
            PackageInfo apk = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
            PackageInfo self = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long apkCode = apk == null ? 0 : (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? apk.getLongVersionCode() : apk.versionCode);
            long selfCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? self.getLongVersionCode() : self.versionCode;
            if (apk != null && apkCode <= selfCode) {
                // Already installed: nothing to do any more.
                prefs().edit().putBoolean("ready", false).apply();
                return;
            }
        } catch (Exception ignored) {
            // Cannot tell: let the installer decide.
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_MIME);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        // Opened once; when it was in the background the next resume opens it again.
        if (getActivity() != null && getActivity().hasWindowFocus()) prefs().edit().putBoolean("ready", false).apply();
    }

    /** An update that finished downloading while the app was away is installed now. */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (!prefs().getBoolean("ready", false)) return;
        long id = prefs().getLong("id", -1);
        if (id != -1 && statusOf(downloads(), id) == DownloadManager.STATUS_SUCCESSFUL) {
            prefs().edit().putBoolean("ready", false).apply();
            try {
                install();
            } catch (Exception ignored) {
                // The banner in the app offers the download again.
            }
        }
    }
}

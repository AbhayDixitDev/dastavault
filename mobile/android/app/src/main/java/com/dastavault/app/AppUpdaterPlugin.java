package com.dastavault.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

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

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Invalid download address");
            return;
        }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("Cannot create " + dir);
                }
                File file = new File(dir, "DastaVault-update.apk");

                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("Download answered " + status);
                }
                long total = connection.getContentLengthLong();
                long done = 0;
                long lastReported = 0;
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(file)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) > 0) {
                        out.write(buffer, 0, read);
                        done += read;
                        if (total > 0 && (done - lastReported) * 50 >= total) {
                            lastReported = done;
                            JSObject progress = new JSObject();
                            progress.put("progress", (double) done / total);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                }
                if (total > 0 && done != total) {
                    throw new IllegalStateException("Download incomplete: " + done + " of " + total + " bytes");
                }

                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }).start();
    }
}

package com.dastavault.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Files of documents inside the Android app, instead of handing links to the
 * browser: save to Downloads, open in an app on the phone, or share.
 *
 * Used from the web app as window.Capacitor.Plugins.Files
 * (frontend/src/lib/nativeFiles.js).
 */
@CapacitorPlugin(name = "Files")
public class FilesPlugin extends Plugin {

    private static String safeName(String name) {
        String clean = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\n\\r]", "_").trim();
        return clean.isEmpty() ? "document" : clean;
    }

    private static void copy(String url, OutputStream out) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("Download answered " + status);
            }
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    out.write(buffer, 0, read);
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Downloads into the app's cache and returns a content:// address other apps may read. */
    private Uri toCache(String url, String name) throws Exception {
        File dir = new File(getContext().getCacheDir(), "documents");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Cannot create " + dir);
        }
        File file = new File(dir, safeName(name));
        try (FileOutputStream out = new FileOutputStream(file)) {
            copy(url, out);
        }
        return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    private static boolean validUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("Invalid file address");
            return false;
        }
        return true;
    }

    /**
     * Saves a file to Downloads/DastaVault with Android's download manager: it
     * goes on in the background and when the app is closed, continues after a
     * lost connection, and shows its progress and the finished file in a
     * notification. Resolves once the download is queued.
     */
    @PluginMethod
    public void save(PluginCall call) {
        if (!validUrl(call)) return;
        String url = call.getString("url");
        String name = safeName(call.getString("name"));
        String mime = call.getString("mime", "application/octet-stream");
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle(name)
                .setDescription("DastaVault")
                .setMimeType(mime)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true);
            String where;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Public Downloads need no permission from Android 10 on.
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "DastaVault/" + name);
                where = "Downloads/DastaVault";
            } else {
                request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, "DastaVault/" + name);
                where = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "DastaVault").getAbsolutePath();
            }
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            long id = dm.enqueue(request);
            JSObject result = new JSObject();
            result.put("folder", where);
            result.put("id", id);
            result.put("queued", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        if (!validUrl(call)) return;
        String url = call.getString("url");
        String name = call.getString("name");
        String mime = call.getString("mime", "application/octet-stream");
        boolean share = Boolean.TRUE.equals(call.getBoolean("share", false));
        new Thread(() -> {
            try {
                Uri uri = toCache(url, name);
                Intent intent;
                if (share) {
                    intent = new Intent(Intent.ACTION_SEND);
                    intent.setType(mime);
                    intent.putExtra(Intent.EXTRA_STREAM, uri);
                } else {
                    intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, mime);
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(intent, share ? "Share" : "Open with");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getContext().startActivity(chooser);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Could not open the file", e);
            }
        }).start();
    }
}

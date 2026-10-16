package com.dastavault.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

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

    @PluginMethod
    public void save(PluginCall call) {
        if (!validUrl(call)) return;
        String url = call.getString("url");
        String name = safeName(call.getString("name"));
        String mime = call.getString("mime", "application/octet-stream");
        new Thread(() -> {
            try {
                String where;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DastaVault");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (item == null) throw new IllegalStateException("Cannot create the file in Downloads");
                    try (OutputStream out = resolver.openOutputStream(item)) {
                        if (out == null) throw new IllegalStateException("Cannot write to Downloads");
                        copy(url, out);
                    } catch (Exception e) {
                        resolver.delete(item, null, null);
                        throw e;
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(item, values, null, null);
                    where = "Downloads/DastaVault";
                } else {
                    File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "DastaVault");
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Cannot create " + dir);
                    try (FileOutputStream out = new FileOutputStream(new File(dir, name))) {
                        copy(url, out);
                    }
                    where = dir.getAbsolutePath();
                }
                JSObject result = new JSObject();
                result.put("folder", where);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
            }
        }).start();
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

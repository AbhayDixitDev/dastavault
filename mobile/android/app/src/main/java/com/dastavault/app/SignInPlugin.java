package com.dastavault.app;

import android.net.Uri;

import androidx.browser.customtabs.CustomTabsIntent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Google sign-in inside the app: Google does not allow signing in within a
 * WebView, so the sign-in page opens in a Custom Tab, a browser sheet on top
 * of the app. Supabase then sends the user back to
 * com.dastavault.app://auth/..., which brings MainActivity (singleTask) back
 * to the front and closes the sheet.
 *
 * Used from the web app as window.Capacitor.Plugins.SignIn
 * (frontend/src/components/common/GoogleButton.jsx).
 */
@CapacitorPlugin(name = "SignIn")
public class SignInPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Invalid sign-in address");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                CustomTabsIntent tab = new CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .setUrlBarHidingEnabled(true)
                    .build();
                tab.launchUrl(getActivity(), Uri.parse(url));
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not open the sign-in page", e);
            }
        });
    }
}

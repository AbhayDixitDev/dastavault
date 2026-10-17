package com.dastavault.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // In-app updates (AppUpdaterPlugin.java).
        registerPlugin(AppUpdaterPlugin.class);
        // Save, open and share document files (FilesPlugin.java).
        registerPlugin(FilesPlugin.class);
        // Google sign-in inside the app (SignInPlugin.java).
        registerPlugin(SignInPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

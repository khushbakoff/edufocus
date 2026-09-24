package com.edufocus.app;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int CAMERA_PERMISSION_CODE = 1001;
    private static final String APP_URL = "https://fundamentals-studied-barriers-pack.trycloudflare.com/student.html";

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;

    // Kiosk anti-exit state
    private boolean isKioskActive = false;
    private boolean isExternalToolActive = false;
    private Handler mainHandler;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        mainHandler = new Handler(Looper.getMainLooper());

        // Keep screen awake during class
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Turn screen on and show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        // Fullscreen immersive mode
        hideSystemUI();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                hideSystemUI();
            }
        });

        // Handle camera permissions for in-app QR scanning
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        pendingPermissionRequest = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_CODE);
                    }
                }
            }
        });

        // Register AndroidBridge JavaScript Interface
        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

        // Request camera permission on launch if not granted
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_CODE);
            }
        }

        webView.loadUrl(APP_URL);
    }

    private void hideSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
            isExternalToolActive = false;
        } else if (isKioskActive && !isExternalToolActive) {
            // If lost focus while class is active, immediately bring app back!
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (isKioskActive && !isExternalToolActive) {
                        bringAppToFront();
                    }
                }
            }, 200);
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        // Triggered when Home button or Recent Apps is pressed
        if (isKioskActive && !isExternalToolActive) {
            Toast.makeText(this, "⚠️ Dars vaqtida ilovadan chiqish taqiqlangan!", Toast.LENGTH_SHORT).show();
            bringAppToFront();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (isKioskActive && !isExternalToolActive) {
            bringAppToFront();
        }
    }

    private void bringAppToFront() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);

            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                am.moveTaskToFront(getTaskId(), ActivityManager.MOVE_TASK_WITH_HOME);
            }
        } catch (Exception e) {}
    }

    @Override
    public void onBackPressed() {
        if (isKioskActive) {
            Toast.makeText(this, "⚠️ Dars paytida ilovadan chiqish taqiqlangan!", Toast.LENGTH_SHORT).show();
            return; // Block Back button completely during class!
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (isKioskActive) {
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                Toast.makeText(this, "⚠️ Dars paytida ilovadan chiqish taqiqlangan!", Toast.LENGTH_SHORT).show();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                if (pendingPermissionRequest != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                    pendingPermissionRequest = null;
                }
            } else {
                Toast.makeText(this, "QR kodni skanerlash uchun kamera ruxsati kerak", Toast.LENGTH_SHORT).show();
            }
        }
    }

    /**
     * JavaScript Interface: AndroidBridge
     * Controls native screen pinning (Kiosk Mode) and launching permitted tools
     */
    public class WebAppInterface {

        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public void startKioskMode() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    isKioskActive = true;
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            startLockTask();
                        }
                    } catch (Exception e) {}
                    hideSystemUI();
                    Toast.makeText(MainActivity.this, "🔒 Dars rejimi: Ilovadan chiqish bloklandi", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void stopKioskMode() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    isKioskActive = false;
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            stopLockTask();
                        }
                    } catch (Exception e) {}
                    Toast.makeText(MainActivity.this, "🔓 Dars tugadi: Qulflash ochildi", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openCalculator() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    isExternalToolActive = true;
                    boolean opened = false;
                    try {
                        Intent intent = new Intent();
                        intent.setAction(Intent.ACTION_MAIN);
                        intent.addCategory(Intent.CATEGORY_APP_CALCULATOR);
                        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        opened = true;
                    } catch (Exception e) {}

                    if (!opened) {
                        String[] calcPackages = {
                            "com.google.android.calculator",
                            "com.sec.android.app.popupcalculator",
                            "com.miui.calculator",
                            "com.android.calculator2",
                            "com.coloros.calculator"
                        };
                        for (String pkg : calcPackages) {
                            try {
                                Intent intent = getPackageManager().getLaunchIntentForPackage(pkg);
                                if (intent != null) {
                                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(intent);
                                    opened = true;
                                    break;
                                }
                            } catch (Exception e) {}
                        }
                    }

                    if (!opened) {
                        Toast.makeText(MainActivity.this, "Kalkulyator ilovasi ochilmoqda", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void openBrowser(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    isExternalToolActive = true;
                    try {
                        String targetUrl = (url != null && !url.isEmpty()) ? url : "https://uz.wikipedia.org";
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Brauzerni ochishda xatolik", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void openApp(final String packageName) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    isExternalToolActive = true;
                    try {
                        Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
                        if (intent != null) {
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        } else {
                            Toast.makeText(MainActivity.this, "Ilova topilmadi: " + packageName, Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Ilovani ochib bo'lmadi", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }
}

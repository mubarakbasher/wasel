# ============================================================
# Wasel — ProGuard / R8 rules
# ============================================================

# Flutter / Dart VM entrypoints
-keep class io.flutter.** { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.**

# Flutter plugin registrar (needed for all platform channel plugins)
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.app.** { *; }

# ---- flutter_secure_storage ----
# Relies on Android KeyStore via reflection
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-dontwarn com.it_nomads.fluttersecurestorage.**

# ---- flutter_jailbreak_detection ----
-keep class com.chillibits.flutter_jailbreak_detection.** { *; }
-dontwarn com.chillibits.flutter_jailbreak_detection.**
# RootBeer (transitive dep used by jailbreak detection)
-keep class com.scottyab.rootbeer.** { *; }
-dontwarn com.scottyab.rootbeer.**

# ---- Dio / OkHttp (HTTP client) ----
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-keep class okio.** { *; }
-dontwarn okio.**

# ---- Firebase / FCM ----
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# ---- Kotlin metadata / reflection ----
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes Exceptions
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# ---- JSON serialization — keep model fields used by Gson / reflection ----
-keepclassmembers class ** {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ---- General: keep enum values ----
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

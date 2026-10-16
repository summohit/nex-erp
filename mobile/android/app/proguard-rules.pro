# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ── MIRA (R8 enabled for 2.5.3, 16 Oct 2026) ─────────────────────────────
# Our own native code: the field visit route recorder (foreground service,
# started by name from the manifest) and its React Native bridge module,
# which React Native looks up by name at runtime. Small, so kept whole.
-keep class com.cestech.nexerp.** { *; }

# Readable crash reports: keep line numbers, hide the original file names.
# Upload app/build/outputs/mapping/release/mapping.txt to Play Console with
# each release so stack traces can be de-obfuscated.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations React Native and Firebase read at runtime.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

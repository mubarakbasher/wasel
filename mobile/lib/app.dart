import 'package:flutter/material.dart';
import 'package:flutter_jailbreak_detection/flutter_jailbreak_detection.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'i18n/app_localizations.dart';
import 'navigation/app_router.dart';
import 'providers/auth_provider.dart';
import 'providers/locale_provider.dart';
import 'services/push_notification_service.dart';
import 'theme/app_theme.dart';

// Convenience: resolve a localized string without a local BuildContext.
String _tr(BuildContext ctx, String key) =>
    AppLocalizations.of(ctx).translate(key);

class WaselApp extends ConsumerStatefulWidget {
  const WaselApp({super.key});

  @override
  ConsumerState<WaselApp> createState() => _WaselAppState();
}

class _WaselAppState extends ConsumerState<WaselApp> {
  bool _pushAttached = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(localeProvider.notifier).loadSavedLocale();
      ref.read(authProvider.notifier).tryRestoreSession();
    });
    _checkDeviceIntegrity();
  }

  /// Warn-but-allow root/jailbreak detection (v1 policy: no hard block).
  ///
  /// We resolve a context from [appNavigatorKey], which is scoped below the
  /// [Localizations] ancestor, guaranteeing that [AppLocalizations.of()] works.
  /// The jailbreak check is async, so by the time it resolves the first frame
  /// has rendered and that context is available — show directly. Only if it is
  /// somehow not yet mounted do we fall back to the next post-frame callback.
  Future<void> _checkDeviceIntegrity() async {
    bool isCompromised = false;
    try {
      isCompromised = await FlutterJailbreakDetection.jailbroken;
    } catch (_) {
      // Detection failure is non-fatal — proceed normally.
    }
    if (!isCompromised) return;

    // The navigator is normally mounted by the time the async check resolves —
    // show immediately. If not, retry on the next frame. Context is resolved
    // synchronously inside the helper, so there's no async-gap on a BuildContext.
    if (!_trySecurityWarning()) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _trySecurityWarning());
    }
  }

  /// Shows the security warning if a Localizations-scoped context is available.
  /// Returns false (without showing) when the navigator isn't mounted yet.
  bool _trySecurityWarning() {
    final navCtx = appNavigatorKey.currentContext;
    if (navCtx == null) return false;
    showDialog<void>(
      context: navCtx,
      barrierDismissible: false,
      builder: (dialogCtx) => AlertDialog(
        title: Text(_tr(navCtx, 'security.warningTitle')),
        content: Text(_tr(navCtx, 'security.warningBody')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: Text(_tr(navCtx, 'security.understandContinue')),
          ),
        ],
      ),
    );
    return true;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_pushAttached) {
      _pushAttached = true;
      PushNotificationService()
          .attachRiverpod(ProviderScope.containerOf(context, listen: false));
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(appRouterProvider);
    final locale = ref.watch(localeProvider);

    return MaterialApp.router(
      title: 'Wasel',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      locale: locale,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
    );
  }
}

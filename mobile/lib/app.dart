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
  Future<void> _checkDeviceIntegrity() async {
    bool isCompromised = false;
    try {
      isCompromised = await FlutterJailbreakDetection.jailbroken;
    } catch (_) {
      // Detection failure is non-fatal — proceed normally.
    }
    if (isCompromised && mounted) {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogCtx) => AlertDialog(
          title: const Text('Security Warning'),
          content: const Text(
            'This device appears to be rooted or jailbroken. '
            'Using Wasel on a compromised device may put your account '
            'and voucher data at risk.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogCtx).pop(),
              child: const Text('I understand, continue'),
            ),
          ],
        ),
      );
    }
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

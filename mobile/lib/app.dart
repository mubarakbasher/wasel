import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'theme/app_theme.dart';
import 'navigation/app_router.dart';
import 'i18n/app_localizations.dart';
import 'providers/auth_provider.dart';
import 'providers/locale_provider.dart';
import 'services/push_notification_service.dart';

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

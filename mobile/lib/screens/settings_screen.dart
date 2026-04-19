import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/secure_window.dart';
import 'package:go_router/go_router.dart';

import '../i18n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../providers/locale_provider.dart';
import '../providers/subscription_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../theme/app_typography.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen>
    with WidgetsBindingObserver {
  bool _obscured = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (Platform.isAndroid) {
      SecureWindow.enable();
    }
    Future.microtask(
        () => ref.read(subscriptionProvider.notifier).loadSubscription());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (Platform.isAndroid) {
      SecureWindow.disable();
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!Platform.isIOS) return;
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      if (mounted) setState(() => _obscured = true);
    } else if (state == AppLifecycleState.resumed) {
      if (mounted) setState(() => _obscured = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final subState = ref.watch(subscriptionProvider);
    final user = authState.user;
    final sub = subState.subscription;

    return Stack(
      children: [
        Scaffold(
          appBar: AppBar(title: Text(context.tr('settings.title'))),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        children: [
          // User info header
          if (user != null)
            Container(
              margin: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.sm,
              ),
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.primaryLight,
                    child: Text(
                      user.name.isNotEmpty
                          ? user.name[0].toUpperCase()
                          : '?',
                      style: AppTypography.title2.copyWith(
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user.name, style: AppTypography.headline),
                        Text(user.email, style: AppTypography.footnote),
                      ],
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: AppSpacing.sm),

          // Subscription section
          _SectionHeader(title: context.tr('settings.subscriptionSection')),
          _SettingsTile(
            icon: Icons.card_membership,
            title: context.tr('settings.subscriptionSection'),
            subtitle: sub != null
                ? '${sub.planName} — ${sub.status.toUpperCase()}'
                : context.tr('settings.noActiveSubscription'),
            trailing: sub != null && sub.isActive
                ? Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.successLight,
                      borderRadius:
                          BorderRadius.circular(AppSpacing.radiusSm),
                    ),
                    child: Text(
                      context.tr('settings.daysLeft', [sub.daysRemaining.toString()]),
                      style: AppTypography.caption1.copyWith(
                        color: AppColors.success,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  )
                : null,
            onTap: () => context.push('/subscription'),
          ),
          _SettingsTile(
            icon: Icons.receipt_long,
            title: context.tr('payments.title'),
            subtitle: context.tr('payments.subtitle'),
            onTap: () => context.push('/settings/payments'),
          ),

          const SizedBox(height: AppSpacing.sm),

          // Account section
          _SectionHeader(title: context.tr('settings.account')),
          _SettingsTile(
            icon: Icons.person_outline,
            title: context.tr('settings.editProfile'),
            subtitle: context.tr('settings.profileSubtitle'),
            onTap: () => context.push('/settings/profile'),
          ),
          _SettingsTile(
            icon: Icons.lock_outline,
            title: context.tr('settings.changePassword'),
            subtitle: context.tr('settings.changePasswordSubtitle'),
            onTap: () => context.push('/settings/change-password'),
          ),

          const SizedBox(height: AppSpacing.sm),

          // App section
          _SectionHeader(title: context.tr('settings.appSection')),
          _SettingsTile(
            icon: Icons.notifications_outlined,
            title: context.tr('settings.notifications'),
            subtitle: context.tr('settings.notificationsSubtitle'),
            onTap: () => context.push('/notification-preferences'),
          ),
          _SettingsTile(
            icon: Icons.support_agent,
            title: context.tr('settings.contact'),
            subtitle: context.tr('settings.contactSubtitle'),
            onTap: () => context.push('/settings/contact'),
          ),
          _LanguageTile(),
          _SettingsTile(
            icon: Icons.info_outline,
            title: context.tr('settings.about'),
            subtitle: context.tr('settings.version', ['1.0.0']),
            onTap: () {
              showAboutDialog(
                context: context,
                applicationName: context.tr('common.appName'),
                applicationVersion: '1.0.0',
                applicationIcon: const Icon(
                  Icons.wifi_tethering,
                  size: 48,
                  color: AppColors.primary,
                ),
                children: [
                  Text(
                    context.tr('settings.aboutDescription'),
                  ),
                ],
              );
            },
          ),

          const SizedBox(height: AppSpacing.xxl),

          // Logout
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: () async {
                  final nav = GoRouter.of(context);
                  await ref.read(authProvider.notifier).logout();
                  if (mounted) nav.go('/login');
                },
                icon: const Icon(Icons.logout, color: AppColors.error),
                label: Text(
                  context.tr('settings.logout'),
                  style: TextStyle(color: AppColors.error),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: AppColors.error),
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xxxl),
        ],
      ),
        ),
        // iOS: blur screen content in the app-switcher / inactive state.
        if (_obscured)
          Positioned.fill(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(color: Colors.black.withValues(alpha: 0.4)),
            ),
          ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xs),
      child: Text(
        title.toUpperCase(),
        style: AppTypography.caption1.copyWith(
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _LanguageTile extends ConsumerWidget {
  const _LanguageTile();

  static const _languages = [
    (code: null, label: 'System Default', native: 'System Default'),
    (code: 'en', label: 'English', native: 'English'),
    (code: 'ar', label: 'Arabic', native: 'العربية'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentLocale = ref.watch(localeProvider);
    final currentLabel = currentLocale == null
        ? context.tr('settings.systemDefault')
        : _languages
            .firstWhere(
              (l) => l.code == currentLocale.languageCode,
              orElse: () => _languages.first,
            )
            .native;

    return ListTile(
      leading: const Icon(Icons.language, color: AppColors.primary),
      title: Text(context.tr('settings.language'), style: AppTypography.body),
      subtitle: Text(currentLabel, style: AppTypography.footnote),
      trailing: const Icon(Icons.chevron_right, color: AppColors.textTertiary),
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      minVerticalPadding: AppSpacing.md,
      onTap: () => _showLanguagePicker(context, ref, currentLocale),
    );
  }

  void _showLanguagePicker(
      BuildContext context, WidgetRef ref, Locale? currentLocale) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
              child: Text(context.tr('settings.selectLanguage'), style: AppTypography.title3),
            ),
            const Divider(),
            RadioGroup<String?>(
              groupValue: currentLocale?.languageCode,
              onChanged: (code) {
                if (code == null) {
                  ref.read(localeProvider.notifier).clearLocale();
                } else {
                  ref
                      .read(localeProvider.notifier)
                      .setLocale(Locale(code));
                }
                Navigator.pop(context);
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final lang in _languages)
                    RadioListTile<String?>(
                      value: lang.code,
                      title: Text(lang.label, style: AppTypography.body),
                      subtitle: lang.code != null && lang.native != lang.label
                          ? Text(lang.native, style: AppTypography.footnote)
                          : null,
                      activeColor: AppColors.primary,
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title, style: AppTypography.body),
      subtitle: Text(subtitle, style: AppTypography.footnote),
      trailing: trailing ??
          const Icon(Icons.chevron_right, color: AppColors.textTertiary),
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      minVerticalPadding: AppSpacing.md,
    );
  }
}
